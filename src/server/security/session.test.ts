/**
 * Session middleware tests.
 *
 * The middleware is exercised against a fake request and a recording
 * response, so the assertions are about the contract — the status code and
 * the body — and not about Express internals.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { NextFunction, Request, Response } from 'express';

import {
  extractSessionToken,
  requireOwnedWallet,
  requireSession,
  walletFromBody,
  walletFromQuery,
} from './session';
import type { DynamicSessionClaims, SessionVerifier } from './dynamicSession';
import { SessionUnavailableError } from './jwks';

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const OTHER_WALLET = '7cVfgArCheMR6CsD3b4UfWqB3wbcJgTyaQTuo1cNkD7V';

interface Recorder {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  finished: boolean;
}

function fakeRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    query: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

function fakeResponse(): { res: Response; recorder: Recorder } {
  const recorder: Recorder = { statusCode: 200, body: undefined, headers: {}, finished: false };
  const res = {
    status(code: number) {
      recorder.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      recorder.body = payload;
      recorder.finished = true;
      return res;
    },
    setHeader(name: string, value: string) {
      recorder.headers[name.toLowerCase()] = value;
      return res;
    },
    header(name: string, value: string) {
      recorder.headers[name.toLowerCase()] = value;
      return res;
    },
    end() {
      recorder.finished = true;
      return res;
    },
    sendStatus(code: number) {
      recorder.statusCode = code;
      recorder.finished = true;
      return res;
    },
  } as unknown as Response;
  return { res, recorder };
}

/** A verifier that accepts one token and rejects everything else. */
const verifier: SessionVerifier = {
  async verify(token: string): Promise<DynamicSessionClaims> {
    if (token !== 'good-token') throw new Error('invalid');
    return {
      dynamicUserId: 'dyn-user-1',
      email: 'ada@example.com',
      solanaAddresses: [WALLET],
    };
  },
};

test('a request without a credential is answered 401', async () => {
  const { res, recorder } = fakeResponse();
  const next: NextFunction = () => {
    throw new Error('the request must not continue');
  };

  requireSession(verifier)(fakeRequest(), res, next);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(recorder.statusCode, 401);
  assert.equal((recorder.body as { reason: string }).reason, 'missing_token');
});

test('a request with a rejected credential is answered 401', async () => {
  const { res, recorder } = fakeResponse();
  const next: NextFunction = () => {
    throw new Error('the request must not continue');
  };
  const req = fakeRequest({ headers: { authorization: 'Bearer bad-token' } });

  requireSession(verifier)(req, res, next);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(recorder.statusCode, 401);
  assert.equal((recorder.body as { reason: string }).reason, 'malformed_token');
});

test('a session service that is down answers 503, not 401', async () => {
  const { res, recorder } = fakeResponse();
  const next: NextFunction = () => {
    throw new Error('the request must not continue');
  };
  const unavailable: SessionVerifier = {
    async verify(): Promise<DynamicSessionClaims> {
      throw new SessionUnavailableError('the key set is unreachable');
    },
  };

  // A credential has to be present, or the request stops at the "no token"
  // check and never reaches the verifier that is down.
  requireSession(unavailable)(
    fakeRequest({ headers: { authorization: 'Bearer some-token' } }),
    res,
    next
  );
  await new Promise((resolve) => setImmediate(resolve));

  // A broken dependency must not look like an expired session: 401 would
  // send every user through a re-login.
  assert.equal(recorder.statusCode, 503);
  assert.equal((recorder.body as { reason: string }).reason, 'auth_unavailable');
});

test('a valid credential attaches the session and continues', async () => {
  const { res } = fakeResponse();
  const req = fakeRequest({ headers: { authorization: 'Bearer good-token' } });
  let continued = false;

  requireSession(verifier)(req, res, () => {
    continued = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(continued, true);
  assert.equal(req.session?.dynamicUserId, 'dyn-user-1');
});

test('a wallet the session does not control is answered 403', () => {
  const { res, recorder } = fakeResponse();
  const req = fakeRequest({ query: { wallet: OTHER_WALLET } });
  req.session = { dynamicUserId: 'dyn-user-1', email: null, solanaAddresses: [WALLET] };

  let continued = false;
  requireOwnedWallet(walletFromQuery)(req, res, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(recorder.statusCode, 403);
});

test('a wallet the session does control is allowed through', () => {
  const { res, recorder } = fakeResponse();
  const req = fakeRequest({ query: { wallet: WALLET } });
  req.session = { dynamicUserId: 'dyn-user-1', email: null, solanaAddresses: [WALLET] };

  let continued = false;
  requireOwnedWallet(walletFromQuery)(req, res, () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.equal(recorder.finished, false);
});

test('a malformed wallet is answered 400 before the ownership check', () => {
  const { res, recorder } = fakeResponse();
  const req = fakeRequest({ query: { wallet: 'not-base58' } });
  req.session = { dynamicUserId: 'dyn-user-1', email: null, solanaAddresses: [WALLET] };

  let continued = false;
  requireOwnedWallet(walletFromQuery)(req, res, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(recorder.statusCode, 400);
});

test('a request without a session cannot reach the ownership check', () => {
  const { res, recorder } = fakeResponse();
  const req = fakeRequest({ query: { wallet: WALLET } });

  let continued = false;
  requireOwnedWallet(walletFromQuery)(req, res, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(recorder.statusCode, 403);
});

test('the bearer header is the source of the credential', () => {
  const token = extractSessionToken(
    fakeRequest({ headers: { authorization: 'Bearer abc.def.ghi' } })
  );
  assert.equal(token, 'abc.def.ghi');
});

test('a cookie shaped like a JWT is the fallback', () => {
  const token = extractSessionToken(
    fakeRequest({ headers: { cookie: 'other=1; session=abc.def.ghi; more=2' } })
  );
  assert.equal(token, 'abc.def.ghi');
});

test('a cookie that is not a JWT is ignored', () => {
  const token = extractSessionToken(fakeRequest({ headers: { cookie: 'theme=dark; locale=es' } }));
  assert.equal(token, null);
});

test('the wallet can also be read from the body', () => {
  const req = fakeRequest({ body: { wallet: WALLET } });
  assert.equal(walletFromBody(req), WALLET);
});
