/**
 * Rate limiting.
 *
 * The reason this exists is a single endpoint. `POST /api/payment-links/claim`
 * verifies a payment with up to seven paced Solana RPC reads. The public
 * devnet endpoint rate-limits by burst with no `Retry-After`, so a stream of
 * claims does not just waste the RPC budget — it starves the *legitimate*
 * users' balance reads and the sweeper of the same quota. A caller who can
 * spend a shared, rate-limited resource on someone else's behalf is a
 * denial-of-service vector, whatever the payload says.
 *
 * Scope, honestly stated
 * ----------------------
 * This limiter lives in the process, so it is **per instance**. In a single
 * Node process that is exact. On Cloudflare Workers each isolate keeps its
 * own counters, so the effective limit is a multiple of the configured one.
 * The authoritative limit is a Cloudflare WAF rate-limiting rule at the
 * edge, which sees every request; this limiter is the application-level
 * floor that still protects the RPC budget when the edge rule is not
 * configured yet.
 */

import type { Request, RequestHandler, Response } from 'express';

export interface RateLimitOptions {
  /** Requests allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** How to identify the caller. Defaults to the Cloudflare-aware client IP. */
  key?: (req: Request) => string;
  /** Maximum number of tracked keys before the oldest are dropped. */
  maxKeys?: number;
  /** Injected clock, so the tests do not have to wait. */
  now?: () => number;
}

/**
 * The caller's address.
 *
 * `CF-Connecting-IP` is what Cloudflare sets on every request it forwards;
 * `req.ip` behind a proxy is the *proxy's* address, which would put every
 * caller in the same bucket. The header is only trusted because it is
 * overwritten by Cloudflare on the way in — it cannot be forged by the
 * client when the zone is proxied.
 */
export function clientIp(req: Request): string {
  const cloudflare = req.headers['cf-connecting-ip'];
  if (typeof cloudflare === 'string' && cloudflare.trim()) return cloudflare.trim();

  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();

  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/**
 * How many entries one request may sweep when releasing expired callers.
 *
 * Sixty-four is generous for a table of live callers: the sweep stops at the
 * first live entry, so in practice it walks one or two entries. The cap is
 * what keeps a flood of unique callers from turning a request into an O(n)
 * sweep.
 */
const MAX_SWEEP_PER_REQUEST = 64;

/**
 * Release the callers whose window has passed.
 *
 * The per-caller filter already drops the expired timestamps of a caller that
 * comes back; this is for the callers that never come back. Without it their
 * timestamps sit in the table for as long as the process lives.
 *
 * The map must be ordered least-recently-seen first — which is how
 * `createRateLimiter` keeps it, by re-inserting every key it touches. The
 * sweep relies on that order: it stops at the first live entry, because every
 * entry after it is more recent and therefore also live.
 *
 * @returns how many entries were removed
 */
export function pruneExpiredCallers(
  hits: Map<string, number[]>,
  now: number,
  windowMs: number,
  maxSweep = MAX_SWEEP_PER_REQUEST
): number {
  const windowStart = now - windowMs;
  let removed = 0;
  let swept = 0;

  for (const [key, timestamps] of hits) {
    if (swept >= maxSweep) break;
    swept += 1;
    const newest = timestamps[timestamps.length - 1] ?? 0;
    // The first live entry means every entry after it is live too.
    if (newest > windowStart) break;
    hits.delete(key);
    removed += 1;
  }

  return removed;
}

/**
 * Build a rate limiter.
 *
 * The window is a sliding one: the timestamps of the requests still inside
 * the window are kept, and the limit applies to how many there are. A fixed
 * window would let a caller send twice the limit across a boundary.
 *
 * The table of callers stays bounded: the least recently seen ones are
 * evicted when the table is over its cap, and the ones whose window has
 * passed are released as they come up. Both are best-effort and amortized —
 * a request sweeps a bounded number of entries and never scans the whole
 * table — so a flood of unique callers cannot turn one request into an O(n)
 * sweep. The table is the attacker's to grow, and the cost of growing it
 * stays bounded.
 */
export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const { limit, windowMs, maxKeys = 10_000 } = options;
  const keyOf = options.key ?? clientIp;
  const clock = options.now ?? Date.now;

  const hits = new Map<string, number[]>();

  return (req: Request, res: Response, next: import('express').NextFunction): void => {
    const now = clock();
    const key = keyOf(req);
    const windowStart = now - windowMs;

    const previous = hits.get(key) ?? [];
    const timestamps = previous.filter((timestamp) => timestamp > windowStart);

    if (timestamps.length >= limit) {
      // Keep the caller's place in the least-recently-seen order: a caller
      // that keeps calling is a caller that is still here.
      hits.delete(key);
      hits.set(key, timestamps);

      // The oldest hit inside the window is the one that frees a slot.
      const retryAfterMs = Math.max(0, (timestamps[0] ?? now) + windowMs - now);
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      res.status(429).json({ error: 'Too many requests. Try again shortly.' });
      return;
    }

    timestamps.push(now);
    // Re-insert so the Map's iteration order is "least recently seen first",
    // which is what the eviction and the sweep below rely on.
    hits.delete(key);
    hits.set(key, timestamps);

    // Evict the least recently seen callers until the table is back under
    // its cap, then release the ones whose window has passed. The eviction
    // removes exactly what the table grew; the sweep is capped, so it
    // releases at most MAX_SWEEP_PER_REQUEST entries per request and the
    // rest wait for the next one. Both costs stay bounded by the traffic.
    while (hits.size > maxKeys) {
      const oldest = hits.keys().next();
      if (oldest.done) break;
      hits.delete(oldest.value);
    }
    pruneExpiredCallers(hits, now, windowMs);

    next();
  };
}
