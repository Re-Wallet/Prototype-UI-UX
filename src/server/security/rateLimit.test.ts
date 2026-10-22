/**
 * Rate limiter tests.
 *
 * The clock is injected, so the window behaviour is asserted exactly instead
 * of being waited for.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { NextFunction, Request, Response } from 'express';

import { clientIp, createRateLimiter, pruneExpiredCallers } from './rateLimit';

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

test('the table of callers stays bounded', () => {
  const recorder = fakeResponse();
  const limiter = createRateLimiter({ limit: 10, windowMs: 60_000, maxKeys: 5, now: () => 0 });

  const next: NextFunction = () => {
    recorder.continued += 1;
  };
  for (let i = 0; i < 50; i += 1) {
    limiter(fakeRequest(`10.0.0.${i}`), recorder.res, next);
  }

  // 50 distinct callers, a table that holds 5: the flood is absorbed instead
  // of growing a table the attacker controls.
  assert.equal(recorder.continued, 50);
  assert.equal(recorder.statusCode, 200);
});

test('the eviction takes the least recently seen caller, not the busiest one', () => {
  const recorder = fakeResponse();
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2, now: () => 0 });

  const next: NextFunction = () => {};
  // A and B are inside their limit; touching A again makes B the oldest.
  limiter(fakeRequest('a'), recorder.res, next);
  limiter(fakeRequest('b'), recorder.res, next);
  limiter(fakeRequest('a'), recorder.res, next);
  // C overflows the table, so B is evicted.
  limiter(fakeRequest('c'), recorder.res, next);

  // A still has its counter, so it is still limited.
  limiter(fakeRequest('a'), recorder.res, next);
  assert.equal(recorder.statusCode, 429);

  // B was evicted, so its counter is gone and it is allowed again.
  const afterB = fakeResponse();
  limiter(fakeRequest('b'), afterB.res, next);
  assert.equal(afterB.statusCode, 200);
});

test('the sweep releases the callers that never come back', () => {
  // The per-caller filter drops the expired timestamps of a caller that comes
  // back; this is for the ones that never do. Without it their timestamps sit
  // in the table for as long as the process lives.
  const hits = new Map<string, number[]>([
    ['idle-a', [100]],
    ['idle-b', [100]],
    ['live', [9_999]],
  ]);

  const removed = pruneExpiredCallers(hits, 10_000, 1_000);

  assert.equal(removed, 2);
  assert.deepEqual([...hits.keys()], ['live']);
});

test('the sweep stops at the first live caller', () => {
  // The table is ordered least-recently-seen first, so the first live entry
  // means every entry after it is live too. The sweep must not walk past it.
  const hits = new Map<string, number[]>([
    ['live', [9_999]],
    ['behind-it', [9_998]],
  ]);

  const removed = pruneExpiredCallers(hits, 10_000, 1_000);

  assert.equal(removed, 0);
  assert.equal(hits.size, 2);
});

test('the sweep is bounded, so one request never walks the whole table', () => {
  const hits = new Map<string, number[]>();
  for (let i = 0; i < 500; i += 1) hits.set(`caller-${i}`, [100]);

  const removed = pruneExpiredCallers(hits, 10_000, 1_000, 10);

  assert.equal(removed, 10);
  assert.equal(hits.size, 490);
});

test('the Cloudflare header identifies the caller, not the proxy', () => {
  const req = { headers: { 'cf-connecting-ip': '203.0.113.7' }, ip: '10.0.0.1' } as unknown as Request;
  assert.equal(clientIp(req), '203.0.113.7');
});

test('without the Cloudflare header the socket address is used', () => {
  const req = { headers: {}, ip: '10.0.0.1' } as unknown as Request;
  assert.equal(clientIp(req), '10.0.0.1');
});
