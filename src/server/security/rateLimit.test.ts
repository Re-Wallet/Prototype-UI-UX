/**
 * Rate limiter tests.
 *
 * The clock is injected, so the window behaviour is asserted exactly instead
 * of being waited for.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { NextFunction, Request, Response } from 'express';

import { clientIp, createRateLimiter } from './rateLimit';

interface Recorder {
  res: Response;
  headers: Record<string, string>;
  statusCode: number;
  continued: number;
}

function fakeRequest(ip: string): Request {
  return { headers: {}, ip, socket: {} } as unknown as Request;
}

function fakeResponse(): Recorder {
  const headers: Record<string, string> = {};
  const recorder: Recorder = { res: null as unknown as Response, headers, statusCode: 200, continued: 0 };
  const res = {
    status(code: number) {
      recorder.statusCode = code;
      return res;
    },
    json() {
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return res;
    },
  } as unknown as Response;
  recorder.res = res;
  return recorder;
}

test('a caller inside the limit continues', () => {
  const recorder = fakeResponse();
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => 0 });

  const next: NextFunction = () => {
    recorder.continued += 1;
  };

  limiter(fakeRequest('1.1.1.1'), recorder.res, next);
  limiter(fakeRequest('1.1.1.1'), recorder.res, next);
  limiter(fakeRequest('1.1.1.1'), recorder.res, next);

  assert.equal(recorder.continued, 3);
  assert.equal(recorder.statusCode, 200);
});

test('a caller beyond the limit is answered 429 with a retry hint', () => {
  const recorder = fakeResponse();
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => 0 });

  const next: NextFunction = () => {};
  limiter(fakeRequest('1.1.1.1'), recorder.res, next);
  limiter(fakeRequest('1.1.1.1'), recorder.res, next);
  limiter(fakeRequest('1.1.1.1'), recorder.res, next);

  assert.equal(recorder.statusCode, 429);
  assert.equal(recorder.headers['retry-after'], '1');
});

test('the limit is counted per caller', () => {
  const recorder = fakeResponse();
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });

  const next: NextFunction = () => {
    recorder.continued += 1;
  };

  limiter(fakeRequest('1.1.1.1'), recorder.res, next);
  limiter(fakeRequest('2.2.2.2'), recorder.res, next);

  assert.equal(recorder.continued, 2);
});

test('the window slides: an old hit stops counting', () => {
  let now = 0;
  const recorder = fakeResponse();
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });

  const next: NextFunction = () => {};
  limiter(fakeRequest('1.1.1.1'), recorder.res, next);
  limiter(fakeRequest('1.1.1.1'), recorder.res, next);

  now = 1500;
  limiter(fakeRequest('1.1.1.1'), recorder.res, next);

  assert.equal(recorder.statusCode, 200);
});

test('the Cloudflare header identifies the caller, not the proxy', () => {
  const req = { headers: { 'cf-connecting-ip': '203.0.113.7' }, ip: '10.0.0.1' } as unknown as Request;
  assert.equal(clientIp(req), '203.0.113.7');
});

test('without the Cloudflare header the socket address is used', () => {
  const req = { headers: {}, ip: '10.0.0.1' } as unknown as Request;
  assert.equal(clientIp(req), '10.0.0.1');
});
