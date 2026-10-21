/**
 * The signing keys, cached.
 *
 * The session verifier needs Dynamic's JWKS on every request, and fetching it
 * every time would make the API's latency depend on a third party's
 * response time. `jose`'s own remote resolver caches the *response*, but it
 * throws when the endpoint is unreachable — and a Dynamic hiccup would then
 * answer every logged-in user with 401, which reads as "your session
 * expired" and sends the whole user base through a re-login.
 *
 * This resolver separates the two failures that matter:
 *
 * - **The key set is unavailable and we have nothing cached.** That is not a
 *   rejected credential; it is a broken dependency. The verifier says so
 *   (`SessionUnavailableError`) and the API answers 503, not 401.
 * - **The key set is unavailable but we fetched one recently.** The cached
 *   set keeps working for `staleMs`. A short outage of Dynamic does not take
 *   the app down.
 *
 * A failed refresh also starts a cooldown, so an outage costs one failed
 * fetch per cooldown window instead of one per request.
 */

import {
  createLocalJWKSet,
  type FlattenedJWSInput,
  type JWK,
  type JWSHeaderParameters,
  type JWTVerifyGetKey,
} from 'jose';

/** The session could not be checked because the key set was unreachable. */
export class SessionUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SessionUnavailableError';
    if (cause !== undefined) this.cause = cause;
  }
}

export interface JwksResolverOptions {
  /** The JWKS endpoint. */
  url: string;
  /** How long a fetched key set is served without a refresh. */
  maxAgeMs?: number;
  /** How long a key set still works after a failed refresh. */
  staleMs?: number;
  /** How long a failed refresh is not retried. */
  cooldownMs?: number;
  /** Injected clock, so the tests do not have to wait. */
  now?: () => number;
  /** Injected fetch, so the tests do not need a network. */
  fetchImpl?: typeof fetch;
}

/**
 * Build a key resolver that caches the key set and survives a short outage.
 *
 * The returned function has the shape `jose` expects for a key resolver: it
 * takes the protected header and returns the key that signed the token.
 */
export function createCachingJwksResolver(options: JwksResolverOptions): JWTVerifyGetKey {
  const {
    url,
    maxAgeMs = 10 * 60 * 1000,
    staleMs = 24 * 60 * 60 * 1000,
    cooldownMs = 30 * 1000,
  } = options;
  const clock = options.now ?? Date.now;
  const doFetch = options.fetchImpl ?? fetch;

  let fresh: { resolver: ReturnType<typeof createLocalJWKSet>; at: number } | null = null;
  let lastSuccessAt = 0;
  let lastFailureAt: number | null = null;
  let inflight: Promise<void> | null = null;

  const load = async (): Promise<void> => {
    const response = await doFetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`the JWKS endpoint answered ${response.status}`);
    }
    const payload = (await response.json()) as { keys?: JWK[] };
    if (!Array.isArray(payload.keys) || payload.keys.length === 0) {
      throw new Error('the JWKS endpoint returned no keys');
    }
    const resolver = createLocalJWKSet({ keys: payload.keys });
    const at = clock();
    fresh = { resolver, at };
    lastSuccessAt = at;
  };

  const refresh = (): Promise<void> => {
    if (!inflight) {
      inflight = load()
        .catch((error: unknown) => {
          lastFailureAt = clock();
          throw error;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };

  return async (protectedHeader: JWSHeaderParameters, token: FlattenedJWSInput) => {
    const at = clock();

    if (fresh && at - fresh.at < maxAgeMs) {
      return fresh.resolver(protectedHeader, token);
    }

    // Inside the cooldown after a failure, do not even try: the cached set is
    // the best answer available and the endpoint is known to be down.
    if (lastFailureAt !== null && at - lastFailureAt < cooldownMs) {
      if (fresh && at - lastSuccessAt < staleMs) return fresh.resolver(protectedHeader, token);
      throw new SessionUnavailableError('The session key set is unavailable.');
    }

    try {
      await refresh();
      if (!fresh) throw new Error('the key set was not stored');
      return fresh.resolver(protectedHeader, token);
    } catch (error) {
      // The refresh failed. A key set fetched recently is still good for a
      // while: a Dynamic outage must not log every user out.
      if (fresh && at - lastSuccessAt < staleMs) {
        return fresh.resolver(protectedHeader, token);
      }
      throw new SessionUnavailableError('The session key set could not be fetched.', error);
    }
  };
}
