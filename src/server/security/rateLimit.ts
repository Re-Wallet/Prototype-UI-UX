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
 * Build a rate limiter.
 *
 * The window is a sliding one: the timestamps of the requests still inside
 * the window are kept, and the limit applies to how many there are. A fixed
 * window would let a caller send twice the limit across a boundary.
 *
 * The table of callers is bounded, and the bound is enforced by evicting the
 * least recently seen key. The eviction is **amortized**: a request removes
 * at most the entries it added, and never scans the whole table. A flood of
 * unique callers therefore cannot turn one request into an O(n) sweep — the
 * table is the attacker's to grow, and the cost of growing it stays O(1).
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
      // The oldest hit inside the window is the one that frees a slot.
      const retryAfterMs = Math.max(0, (timestamps[0] ?? now) + windowMs - now);
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      res.status(429).json({ error: 'Too many requests. Try again shortly.' });
      return;
    }

    timestamps.push(now);
    // Re-insert so the Map's iteration order is "least recently seen first",
    // which is what the eviction below relies on.
    hits.delete(key);
    hits.set(key, timestamps);

    // Evict the least recently seen callers until the table is back under
    // its cap. The loop removes as many entries as the table grew over the
    // cap, so its cost is bounded by the attacker's own traffic.
    while (hits.size > maxKeys) {
      const oldest = hits.keys().next();
      if (oldest.done) break;
      hits.delete(oldest.value);
    }

    next();
  };
}
