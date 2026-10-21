/**
 * The cached key resolver.
 *
 * Everything here is hermetic: the key pair is generated in the test, the
 * JWKS is served by a stub fetch, and the clock is injected.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { createCachingJwksResolver, SessionUnavailableError } from './jwks';

const URL_UNDER_TEST = 'https://example.test/.well-known/jwks';

/** The protected header every test token carries. */
const HEADER = { alg: 'RS256', kid: 'test-key' };

/**
 * The flattened token `jose` hands to a key resolver. The local resolver
 * only reads the protected header, so the body is a placeholder.
 */
const TOKEN_INPUT = { payload: '', signature: '' };

const { privateKey, publicKey } = await generateKeyPair('RS256');
const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

/** Sign a token the resolver can find a key for. */
async function signToken(): Promise<string> {
  return await new SignJWT({ sub: 'dyn-user-1' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(privateKey);
}

/** A fetch stub that always answers with the key set. */
function okFetch(counter: { calls: number }): typeof fetch {
  return (async () => {
    counter.calls += 1;
    return new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

/** A fetch stub that always fails. */
function failingFetch(): typeof fetch {
  return (async () => {
    throw new Error('the network is down');
  }) as unknown as typeof fetch;
}

test('the key set is fetched once and served from the cache', async () => {
  const counter = { calls: 0 };
  const resolver = createCachingJwksResolver({
    url: URL_UNDER_TEST,
    fetchImpl: okFetch(counter),
    now: () => 0,
  });

  const token = await signToken();
  const key = await resolver(HEADER, TOKEN_INPUT);
  assert.ok(key);
  await resolver(HEADER, TOKEN_INPUT);
  await resolver(HEADER, TOKEN_INPUT);

  assert.equal(counter.calls, 1);
  assert.ok(token);
});

test('a failed refresh keeps serving the cached key set', async () => {
  const counter = { calls: 0 };
  let healthy = true;
  let now = 0;
  const resolver = createCachingJwksResolver({
    url: URL_UNDER_TEST,
    maxAgeMs: 1000,
    staleMs: 60_000,
    now: () => now,
    fetchImpl: (async () => {
      counter.calls += 1;
      if (!healthy) throw new Error('the network is down');
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
    }) as unknown as typeof fetch,
  });

  const token = await signToken();
  await resolver(HEADER, TOKEN_INPUT);
  healthy = false;
  // The cached set is now past its max age, so the next call refreshes.
  now = 5000;

  // The cached set is past its max age, so a refresh is attempted — and it
  // fails. The cached set still answers.
  const key = await resolver(HEADER, TOKEN_INPUT);
  assert.ok(key);
  assert.equal(counter.calls, 2);
});

test('an unreachable key set with nothing cached reports the dependency as unavailable', async () => {
  const resolver = createCachingJwksResolver({
    url: URL_UNDER_TEST,
    fetchImpl: failingFetch(),
    now: () => 0,
  });

  const token = await signToken();
  await assert.rejects(
    async () => {
      await resolver(HEADER, TOKEN_INPUT);
    },
    (error: unknown) => error instanceof SessionUnavailableError
  );
});

test('a failed refresh is not retried inside the cooldown', async () => {
  const counter = { calls: 0 };
  let now = 1000;
  const resolver = createCachingJwksResolver({
    url: URL_UNDER_TEST,
    cooldownMs: 30_000,
    now: () => now,
    fetchImpl: (async () => {
      counter.calls += 1;
      throw new Error('the network is down');
    }) as unknown as typeof fetch,
  });

  const token = await signToken();
  await assert.rejects(async () => {
    await resolver(HEADER, TOKEN_INPUT);
  });
  // Still inside the cooldown: no second attempt.
  now = 2000;
  await assert.rejects(async () => {
    await resolver(HEADER, TOKEN_INPUT);
  });
  now = 40_000;
  await assert.rejects(async () => {
    await resolver(HEADER, TOKEN_INPUT);
  });

  assert.equal(counter.calls, 2);
});

/** A fetch stub that never answers, but honours the abort signal. */
function hangingFetch(): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('the fetch was abandoned')));
    })) as unknown as typeof fetch;
}

test('a hanging key set is abandoned instead of holding the request open', async () => {
  // Without a timeout, a hanging endpoint holds the request for the
  // platform's default fetch timeout, which in Node is unbounded.
  const resolver = createCachingJwksResolver({
    url: URL_UNDER_TEST,
    fetchTimeoutMs: 50,
    fetchImpl: hangingFetch(),
    now: () => 0,
  });

  const token = await signToken();
  await assert.rejects(
    async () => {
      await resolver(HEADER, TOKEN_INPUT);
    },
    (error: unknown) => error instanceof SessionUnavailableError
  );
});

test('a fetch that ignores the abort signal still loses the race', async () => {
  // The abort stops a fetch that honours the signal. The race is what stops
  // one that does not, so the request cannot hang either way.
  const stubborn = (() => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return new Promise<Response>(() => {
        /* never settles */
      });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls: () => calls };
  })();

  const resolver = createCachingJwksResolver({
    url: URL_UNDER_TEST,
    fetchTimeoutMs: 50,
    fetchImpl: stubborn.fetchImpl,
    now: () => 0,
  });

  const token = await signToken();
  await assert.rejects(
    async () => {
      await resolver(HEADER, TOKEN_INPUT);
    },
    (error: unknown) => error instanceof SessionUnavailableError
  );
  assert.equal(stubborn.calls(), 1);
});

test('a timeout below the floor is raised instead of aborting every fetch', async () => {
  // A zero would abort every fetch before it starts, and the resolver would
  // report the session service as unavailable forever.
  const counter = { calls: 0 };
  const resolver = createCachingJwksResolver({
    url: URL_UNDER_TEST,
    fetchTimeoutMs: 0,
    fetchImpl: okFetch(counter),
    now: () => 0,
  });

  const token = await signToken();
  const key = await resolver(HEADER, TOKEN_INPUT);

  assert.ok(key);
  assert.equal(counter.calls, 1);
});

test('a key set with no keys is refused', async () => {
  const resolver = createCachingJwksResolver({
    url: URL_UNDER_TEST,
    fetchImpl: (async () =>
      new Response(JSON.stringify({ keys: [] }), { status: 200 })) as unknown as typeof fetch,
    now: () => 0,
  });

  const token = await signToken();
  await assert.rejects(
    async () => {
      await resolver(HEADER, TOKEN_INPUT);
    },
    (error: unknown) => error instanceof SessionUnavailableError
  );
});
