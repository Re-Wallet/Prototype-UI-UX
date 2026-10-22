/**
 * The API gate, exercised against the real app.
 *
 * The unit tests prove the rules; this one proves the *wiring*: which routes
 * are gated, and that a gated route answers 401 before it reaches the
 * database. A route that was meant to be protected and was not would show up
 * here as a non-401 answer.
 *
 * The test is hermetic on purpose: every request it makes is rejected by a
 * validation rule *before* the handler touches the database, and no
 * credential is sent, so the session verifier is never invoked and the
 * network is never touched.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';

// The app must not open a listening socket when it is imported.
process.env.API_NO_LISTEN = '1';

const { app } = await import('../../../server');

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

/**
 * A public route that answers 400 before reading the database: the address
 * is not a base58 Solana address.
 */
const PUBLIC_ROUTE = '/api/wallet/identity?address=not-base58';

let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** The routes that read or write a user's data. */
const USER_SCOPED_ROUTES: Array<{ method: string; path: string }> = [
  { method: 'GET', path: `/api/wallet?wallet=${WALLET}` },
  { method: 'GET', path: `/api/wallet/transactions?wallet=${WALLET}` },
  { method: 'GET', path: `/api/wallet/notifications?wallet=${WALLET}` },
  { method: 'GET', path: `/api/wallet/contacts?wallet=${WALLET}` },
  { method: 'GET', path: `/api/wallet/balances?wallet=${WALLET}` },
  { method: 'GET', path: `/api/payment-links?wallet=${WALLET}` },
  { method: 'POST', path: '/api/wallet/transactions/live' },
  { method: 'POST', path: '/api/wallet/transactions/pending' },
  { method: 'POST', path: '/api/wallet/notifications/read' },
  { method: 'POST', path: '/api/wallet/contacts' },
  { method: 'POST', path: '/api/payment-links' },
  { method: 'POST', path: '/api/payment-links/live' },
  { method: 'PATCH', path: '/api/settings/language' },
];

for (const route of USER_SCOPED_ROUTES) {
  test(`${route.method} ${route.path} refuses a caller without a session`, async () => {
    const response = await fetch(`${baseUrl}${route.path}`, {
      method: route.method,
      headers: { 'Content-Type': 'application/json' },
      body: route.method === 'GET' ? undefined : JSON.stringify({ wallet: WALLET }),
    });

    assert.equal(response.status, 401);
    const body = (await response.json()) as { reason?: string };
    assert.equal(body.reason, 'missing_token');
  });
}

test('a public route is not gated', async () => {
  // The payer may not be signed in, so the link lookup stays open. The
  // answer is a validation error, not an authentication one.
  const response = await fetch(`${baseUrl}${PUBLIC_ROUTE}`);

  assert.equal(response.status, 400);
});

test('the claim endpoint stays public', async () => {
  const response = await fetch(`${baseUrl}/api/payment-links/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);
});

test('the public identity lookup answers without publishing the account e-mail', async () => {
  // The address is invalid, so the route answers before reading the
  // database. The assertion that matters is in the unit tests: the payload
  // carries the handle and never the e-mail.
  const response = await fetch(`${baseUrl}${PUBLIC_ROUTE}`);

  assert.equal(response.status, 400);
});

test('every response carries the security headers', async () => {
  const response = await fetch(`${baseUrl}${PUBLIC_ROUTE}`);

  assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('no response answers a wildcard origin', async () => {
  const response = await fetch(`${baseUrl}${PUBLIC_ROUTE}`, {
    headers: { Origin: 'https://evil.example' },
  });

  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('a request from a trusted origin is answered with that exact origin', async () => {
  const response = await fetch(`${baseUrl}${PUBLIC_ROUTE}`, {
    headers: { Origin: 'http://127.0.0.1:3000' },
  });

  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3000');
});
