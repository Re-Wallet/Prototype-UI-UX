/**
 * Security header tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { NextFunction, Request, Response } from 'express';

import { buildContentSecurityPolicy, securityHeaders } from './headers';

function fakeResponse(): { res: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return res;
    },
  } as unknown as Response;
  return { res, headers };
}

test('the policy forbids framing', () => {
  assert.match(buildContentSecurityPolicy(), /frame-ancestors 'none'/);
});

test('the policy allows the origins the app talks to', () => {
  const csp = buildContentSecurityPolicy();

  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /api\.devnet\.solana\.com/);
  assert.match(csp, /wss:\/\/\*\.aws\.neon\.tech/);
  assert.match(csp, /frame-src https:\/\/\*\.dynamic\.xyz/);
  assert.match(csp, /img-src 'self' data: blob:/);
});

test('an extra connect source can be added', () => {
  const csp = buildContentSecurityPolicy({ extraConnectSources: ['https://rpc.example'] });
  assert.match(csp, /https:\/\/rpc\.example/);
});

test('the middleware sets the headers that stop the obvious attacks', () => {
  const { res, headers } = fakeResponse();
  let continued = false;

  const next: NextFunction = () => {
    continued = true;
  };
  securityHeaders()({} as Request, res, next);

  assert.equal(continued, true);
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(headers['strict-transport-security'], /max-age=31536000/);
});

test('HSTS can be turned off for a plain-HTTP dev server', () => {
  const { res, headers } = fakeResponse();
  const next: NextFunction = () => {};
  securityHeaders({ hsts: false })({} as Request, res, next);

  assert.equal(headers['strict-transport-security'], undefined);
});
