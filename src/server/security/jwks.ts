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
  /**
   * How long a fetched key set is served without a refresh.
   *
   * Ten minutes: long enough that a normal request never pays for a fetch,
   * short enough that a key rotation by Dynamic is picked up without a
   * redeploy.
   */
  maxAgeMs?: number;
  /**
   * How long a key set still works after a failed refresh.
   *
   * A day: a Dynamic outage must not take the app down, and a key that was
   * valid yesterday is still the right key today. Past that the set is
   * treated as unknown and the dependency is reported as unavailable.
   */
  staleMs?: number;
  /**
   * How long a failed refresh is not retried.
   *
   * Thirty seconds: an outage costs one failed fetch per half-minute
   * instead of one per request.
   */
  cooldownMs?: number;
  /**
   * How long a fetch may take before it is abandoned.
   *
   * Five seconds by default, the same bound the baseline resolver used.
   * Without it a hanging endpoint holds the request open for the platform's
   * default timeout, which in Node is unbounded. A value below the resolver's
   * floor is raised to it: a zero would abort every fetch and take
   * authentication down.
   */
  fetchTimeoutMs?: number;
  /** Injected clock, so the tests do not have to wait. */
  now?: () => number;
  /** Injected fetch, so the tests do not need a network. */
  fetchImpl?: typeof fetch;
}

/**
 * The default fetch timeout: five seconds, the same bound the baseline
 * resolver used.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 5 * 1000;

/**
 * The shortest fetch timeout the resolver accepts.
 *
 * A zero or negative timeout would abort every fetch before it starts, and
 * the resolver would then report the session service as unavailable
 * forever. A misconfiguration must not look like a total authentication
 * outage.
 */
const MIN_FETCH_TIMEOUT_MS = 100;

/**
 * The longest fetch timeout the resolver accepts.
 *
 * Without a ceiling a misconfiguration could set the timeout to a day, which
 * is the same as having no timeout at all — and "no timeout" is exactly what
 * this resolver exists to prevent.
 */
const MAX_FETCH_TIMEOUT_MS = 60 * 1000;

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

  const requestedTimeout = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const fetchTimeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(MAX_FETCH_TIMEOUT_MS, Math.max(MIN_FETCH_TIMEOUT_MS, requestedTimeout))
    : DEFAULT_FETCH_TIMEOUT_MS;

  const clock = options.now ?? Date.now;
  const doFetch = options.fetchImpl ?? fetch;

  // The key set and the moment it was fetched. The moment doubles as the
  // "last success" marker, so there is one clock in this resolver, not two.
  let fresh: { resolver: ReturnType<typeof createLocalJWKSet>; at: number } | null = null;
  let lastFailureAt: number | null = null;
  let inflight: Promise<void> | null = null;

  const load = async (): Promise<void> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // The abort stops a fetch that honours the signal, and the race stops
      // one that does not. Either way the request cannot hang.
      const response = await Promise.race([
        doFetch(url, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            // The message names the value the resolver ACTUALLY used. When
            // the caller asked for something outside the accepted range, the
            // difference is stated: a timeout of "100ms" that the caller
            // never asked for is a confusing way to be told "your value was
            // out of range".
            const adjusted =
              requestedTimeout !== fetchTimeoutMs ? ` (asked for ${requestedTimeout}ms)` : '';
            reject(
              new Error(
                `the JWKS endpoint did not answer within ${fetchTimeoutMs}ms${adjusted}`
              )
            );
          }, fetchTimeoutMs);
        }),
      ]);
      if (!response.ok) {
        throw new Error(`the JWKS endpoint answered ${response.status}`);
      }
      const payload = (await response.json()) as { keys?: JWK[] };
      if (!Array.isArray(payload.keys) || payload.keys.length === 0) {
        throw new Error('the JWKS endpoint returned no keys');
      }
      const resolver = createLocalJWKSet({ keys: payload.keys });
      fresh = { resolver, at: clock() };
    } finally {
      if (timer) clearTimeout(timer);
    }
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
      if (fresh && at - fresh.at < staleMs) return fresh.resolver(protectedHeader, token);
      throw new SessionUnavailableError('The session key set is unavailable.');
    }

    try {
      await refresh();
      if (!fresh) throw new Error('the key set was not stored');
      return fresh.resolver(protectedHeader, token);
    } catch (error) {
      // The refresh failed. A key set fetched recently is still good for a
      // while: a Dynamic outage must not log every user out.
      if (fresh && at - fresh.at < staleMs) {
        return fresh.resolver(protectedHeader, token);
      }
      throw new SessionUnavailableError('The session key set could not be fetched.', error);
    }
  };
}
