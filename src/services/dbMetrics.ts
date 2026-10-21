/**
 * Per-request database round-trip counter.
 *
 * Why this exists: every database round-trip to Neon costs about one network
 * RTT from wherever the API runs. The query count IS the latency budget, so
 * the only question that matters for performance work is "how many round-trips
 * does this request make?".
 *
 * `AsyncLocalStorage` ties the count to the request that caused the query
 * rather than to a global counter, so concurrent requests never mix their
 * numbers. Drizzle calls `logger.logQuery` synchronously inside the
 * requesting call's async context, which is what makes the store reachable
 * from the listener.
 *
 * This module is a leaf: it imports nothing from `src/db`, so `src/db` can
 * wire the logger in without an import cycle.
 *
 * The count is published as the `X-DB-Queries` response header, which
 * `src/scripts/auditEndpoints.ts` reads.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

interface RequestMetrics {
  queries: number;
}

const store = new AsyncLocalStorage<RequestMetrics>();

/**
 * Count one database round-trip in the current request. A no-op outside a
 * request (scripts, background sweeps).
 */

/**
 * Set `AUDIT_SQL=1` to log every query as it is dispatched. Off by default:
 * the log is only useful while auditing, and it would flood the server log
 * in normal operation.
 */
const AUDIT_SQL = process.env.AUDIT_SQL === '1';

/**
 * Count one database round-trip in the current request.
 *
 * The counter is fed from the pool's `query` method, which is the single
 * entry point for every round-trip: Drizzle issues its statements through the
 * pool, and the few raw `pool.query` calls in the codebase go through it too.
 * Counting at one place avoids the double count that a second hook (a
 * Drizzle logger) would produce.
 */
export function countDbQuery(sql?: string): void {
  const metrics = store.getStore();
  if (metrics) metrics.queries += 1;
  if (AUDIT_SQL && sql) {
    console.log(`   SQL: ${sql.replace(/\s+/g, ' ').slice(0, 220)}`);
  }
}

/**
 * Count the database round-trips of each request and publish the total in the
 * `X-DB-Queries` header.
 *
 * The header must be set before the response starts, so the send paths are
 * wrapped rather than using the `finish` event (which fires too late).
 */
export const dbQueryCounter: RequestHandler = (req, res, next) => {
  const metrics: RequestMetrics = { queries: 0 };

  const publish = (): void => {
    if (!res.headersSent) res.setHeader('X-DB-Queries', String(metrics.queries));
  };

  store.run(metrics, () => {
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      publish();
      return originalJson(body);
    };

    const originalSend = res.send.bind(res);
    res.send = (body: unknown) => {
      publish();
      return originalSend(body);
    };

    next();
  });
};

/**
 * The number of database round-trips issued so far in the current request.
 */
export function dbQueriesSoFar(): number {
  return store.getStore()?.queries ?? 0;
}
