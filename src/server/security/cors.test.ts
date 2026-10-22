/**
 * CORS policy tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Request, Response } from 'express';

import {
  createCorsMiddleware,
  defaultAllowedOrigins,
  isOriginAllowed,
  originMatches,
  parseOriginPatterns,
} from './cors';

interface Recorder {
  res: Response;
  headers: Record<string, string>;
  statusCode: number;
  continued: boolean;
}

function fakeRequest(overrides: Partial<Request> = {}): Request {
  return { headers: {}, method: 'GET', ...overrides } as unknown as Request;
}

function fakeResponse(): Recorder {
  const headers: Record<string, string> = {};
  const recorder: Recorder = { res: null as unknown as Response, headers, statusCode: 200, continued: false };
  const res = {
    header(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      recorder.statusCode = code;
      return res;
    },
    end() {
      return res;
    },
    sendStatus(code: number) {
      recorder.statusCode = code;
      return res;
    },
  } as unknown as Response;
  recorder.res = res;
  return recorder;
}

test('a wildcard pattern matches exactly one host label', () => {
  assert.equal(originMatches('https://abc.trycloudflare.com', 'https://*.trycloudflare.com'), true);
  assert.equal(originMatches('https://a.b.trycloudflare.com', 'https://*.trycloudflare.com'), false);
  assert.equal(originMatches('https://trycloudflare.com', 'https://*.trycloudflare.com'), false);
});

test('a wildcard host does not match another scheme or port', () => {
  assert.equal(originMatches('http://abc.trycloudflare.com', 'https://*.trycloudflare.com'), false);
  assert.equal(originMatches('https://abc.trycloudflare.com:8443', 'https://*.trycloudflare.com'), false);
});

test('an exact pattern matches only itself', () => {
  assert.equal(originMatches('http://127.0.0.1:3000', 'http://127.0.0.1:3000'), true);
  assert.equal(originMatches('http://127.0.0.1:3001', 'http://127.0.0.1:3000'), false);
});

test('the local dev origins are allowed by default', () => {
  const origins = defaultAllowedOrigins();
  assert.equal(isOriginAllowed('http://127.0.0.1:3000', origins), true);
  assert.equal(isOriginAllowed('https://abc.trycloudflare.com', origins), true);
  assert.equal(isOriginAllowed('https://evil.example', origins), false);
});

test('the origin list is parsed from a comma separated value', () => {
  assert.deepEqual(parseOriginPatterns('https://a.example, https://b.example'), [
    'https://a.example',
    'https://b.example',
  ]);
  assert.deepEqual(parseOriginPatterns(undefined), []);
});

test('an allowed origin receives the exact origin, never a wildcard', () => {
  const recorder = fakeResponse();
  createCorsMiddleware({ allowedOrigins: ['https://app.example'] })(
    fakeRequest({ headers: { origin: 'https://app.example' } }),
    recorder.res,
    () => {}
  );

  assert.equal(recorder.headers['access-control-allow-origin'], 'https://app.example');
  assert.equal(recorder.headers['vary'], 'Origin');
});

test('a disallowed origin receives no allow-origin header', () => {
  const recorder = fakeResponse();
  createCorsMiddleware({ allowedOrigins: ['https://app.example'] })(
    fakeRequest({ headers: { origin: 'https://evil.example' } }),
    recorder.res,
    () => {}
  );

  assert.equal(recorder.headers['access-control-allow-origin'], undefined);
});

test('the authorization header is allowed in a preflight', () => {
  const recorder = fakeResponse();
  createCorsMiddleware({ allowedOrigins: ['https://app.example'] })(
    fakeRequest({ method: 'OPTIONS', headers: { origin: 'https://app.example' } }),
    recorder.res,
    () => {}
  );

  assert.match(recorder.headers['access-control-allow-headers'], /Authorization/);
});

test('a preflight from an allowed origin is answered 204', () => {
  const recorder = fakeResponse();
  createCorsMiddleware({ allowedOrigins: ['https://app.example'] })(
    fakeRequest({ method: 'OPTIONS', headers: { origin: 'https://app.example' } }),
    recorder.res,
    () => {
      recorder.continued = true;
    }
  );

  assert.equal(recorder.statusCode, 204);
  assert.equal(recorder.continued, false);
});

test('a preflight from a disallowed origin is refused', () => {
  const recorder = fakeResponse();
  createCorsMiddleware({ allowedOrigins: ['https://app.example'] })(
    fakeRequest({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } }),
    recorder.res,
    () => {
      recorder.continued = true;
    }
  );

  assert.equal(recorder.statusCode, 403);
  assert.equal(recorder.continued, false);
});

test('a request without an origin is not blocked', () => {
  const recorder = fakeResponse();
  createCorsMiddleware({ allowedOrigins: ['https://app.example'] })(
    fakeRequest(),
    recorder.res,
    () => {
      recorder.continued = true;
    }
  );

  assert.equal(recorder.continued, true);
  assert.equal(recorder.statusCode, 200);
});
