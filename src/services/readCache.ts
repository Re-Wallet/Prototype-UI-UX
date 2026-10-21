/**
 * Generic server-side read-through cache.
 *
 * Why this exists: the database is hosted in another region, so every
 * round-trip costs roughly one network RTT (~190ms measured from Argentina
 * against a us-east-2 compute). The number of round-trips a request makes IS
 * its latency — the tables are small enough that the query plan is irrelevant
 * next to the cost of reaching them. This module removes repeat round-trips
 * for reads that change rarely.
 *
 * Same shape as `balanceCache`, generalised:
 *   - a TTL bounds staleness,
 *   - concurrent misses share one read instead of running the same queries
 *     twice,
 *   - a generation token stops a read that raced an invalidation from
 *     caching pre-write values.
 *
 * Correctness does not rest on the TTL: every write path invalidates the
 * keys it affects, so the next read is fresh regardless. The TTL only bounds
 * how stale a read can be after a write this process never observed.
 */

/** Default lifetime of a cached read. */
const DEFAULT_TTL_MS = Number(process.env.READ_CACHE_TTL_MS ?? 30_000);

interface CacheEntry {
  value: unknown;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Reads in flight, keyed by cache key. Two concurrent misses for the same key
 * share one load instead of running it twice.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Per-key generation, bumped by {@link invalidate}. A read that started under
 * an older generation must not cache its (pre-write) result, so it checks the
 * generation before writing.
 */
const generation = new Map<string, number>();

function bumpGeneration(key: string): number {
  const next = (generation.get(key) ?? 0) + 1;
  generation.set(key, next);
  return next;
}

/**
 * Read a value through the cache.
 *
 * Pass `force` to bypass the cache — callers that just wrote the value do, so
 * the follow-up read is not served the pre-write version. A failing load with
 * a cached entry resolves with that stale value instead of an error: for a
 * prototype, a slightly stale read beats an error.
 */
export async function getCached<T>(
  key: string,
  load: () => Promise<T>,
  options: { ttlMs?: number; force?: boolean; shouldCache?: (value: T) => boolean } = {}
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const hit = cache.get(key);
  if (!options.force && hit && Date.now() - hit.fetchedAt < ttlMs) {
    return hit.value as T;
  }

  // Collapse concurrent misses onto one load. A forced read still shares an
  // in-flight read: the values it wants are the ones already being fetched.
  // This is what keeps a page load — three wallet requests fired in parallel
  // — from running the same lookup three times.
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const startedAt = generation.get(key) ?? 0;
  const read = (async () => {
    try {
      const value = await load();
      // Only cache if no invalidation happened while we were reading.
      if ((generation.get(key) ?? 0) === startedAt) {
        const cacheable = options.shouldCache ? options.shouldCache(value) : true;
        if (cacheable) {
          cache.set(key, { value, fetchedAt: Date.now() });
        }
      }
      return value;
    } catch (error) {
      if (hit) {
        console.warn(`⚠️  cached read "${key}" failed, serving stale value:`, error);
        return hit.value as T;
      }
      throw error;
    }
  })();

  inFlight.set(key, read);
  try {
    return await read;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Drop a cached value (used when a write invalidated it).
 *
 * Also bumps the key generation so an in-flight read started before the write
 * cannot later cache pre-write values, and drops that read from the dedupe
 * map so the next caller starts a fresh one.
 */
export function invalidate(key: string): void {
  cache.delete(key);
  bumpGeneration(key);
  inFlight.delete(key);
}

/**
 * Drop every cached value under a prefix (used when a write affects a whole
 * family of keys, such as every read of one user's data).
 */
export function invalidatePrefix(prefix: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) invalidate(key);
  }
}

/**
 * Canonical cache keys.
 *
 * Namespaced by kind so an invalidation can target one read without touching
 * the others, and so the `invalidatePrefix` helper can wipe one user's data
 * in a single call.
 */
export const cacheKey = {
  contacts: (userId: number): string => `contacts:${userId}`,
  transactions: (userId: number): string => `transactions:${userId}`,
  notifications: (userId: number): string => `notifications:${userId}`,
  paymentLinks: (userId: number): string => `payment-links:${userId}`,
  identity: (address: string): string => `identity:${address.trim()}`,
};
