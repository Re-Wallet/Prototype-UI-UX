/**
 * The database client.
 *
 * Two runtimes, one client. The Worker cannot open a TCP socket to Neon —
 * a Worker has no sockets — so the ledger is reached over **HTTP** with
 * `drizzle-orm/neon-http`. That driver is a plain `fetch` per query, which
 * is also what the runtime prefers: no pool to warm, no connection to
 * recycle, and a query that costs exactly one round-trip.
 *
 * The local Node scripts that need a real socket (the SQLite migration) use
 * `nodePool.ts` instead. Nothing that ships to the Worker imports it.
 */

import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';

import { countDbQuery } from '../services/dbMetrics';
import { isWorkersRuntime } from '../server/runtime';
import * as schema from './schema';

// The local process reads its configuration from a file. The Worker gets it
// from the bindings, and there is no file to read.
if (!isWorkersRuntime()) {
  dotenv.config({ path: ['.env.local', '.env'] });
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString?.startsWith('postgres://') && !connectionString?.startsWith('postgresql://')) {
  throw new Error(
    'DATABASE_URL is missing or not a postgres URL. Run `neon env pull` in the project root.'
  );
}

/**
 * The HTTP client that talks to Neon.
 *
 * `drizzle-orm/neon-http` issues one `fetch` per statement, so there is no
 * pool to warm and no socket to keep alive. The query is sent as a string,
 * and the `sql` template that built it is carried alongside for the audit
 * log.
 */
const neonClient = neon(connectionString);

export const db = drizzle(neonClient, {
  schema,
  /**
   * Every statement goes through here, so it is the one place that can count
   * the round-trips per request. The audit scripts and the `/api/health`
   * probe both read that count, and it is the cheapest way to notice a
   * request that suddenly talks to the database ten times.
   */
  logger: {
    logQuery: (query: string) => countDbQuery(query),
  },
});

export type Db = typeof db;

export { schema };

/**
 * Open the database connections ahead of the first request.
 *
 * A Worker has no pool to warm: every statement is an HTTP request, and
 * the connection cost is already inside the round-trip. The function stays
 * because the local Node path still uses it, and because "warm nothing" is
 * not a failure worth crashing over.
 */
export async function warmPool(): Promise<void> {
  try {
    await db.execute(sql`SELECT 1`);
    console.log('   DB reachable');
  } catch (error) {
    console.warn(
      '⚠️  DB warmup failed (the API still works, it just reconnects lazily):',
      error instanceof Error ? error.message : error
    );
  }
}
