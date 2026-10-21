/**
 * Drizzle + PostgreSQL connection (Neon).
 *
 * DATABASE_URL is pulled into .env.local by `neon deploy`. dotenv is loaded
 * here because ESM evaluates imported modules (this one) before the importing
 * module's body runs — server.ts calls dotenv.config() at line 25, after its
 * own imports have already executed. dotenv never overwrites existing keys,
 * so the double load is harmless.
 */

import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

import { countDbQuery } from '../services/dbMetrics';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString?.startsWith('postgres://') && !connectionString?.startsWith('postgresql://')) {
  throw new Error(
    'DATABASE_URL is missing or not a postgres URL. Run `neon env pull` in the project root.'
  );
}

export const pool = new Pool({
  connectionString,
  // Sized for the app's real concurrency: the App fires three wallet
  // requests in parallel on open, and the audit showed every one of them
  // needs a single round-trip. Five leaves headroom for the webhook
  // projection landing while a page is loading.
  max: 5,
  // The compute does NOT suspend on this project (`suspend_timeout_seconds`
  // is 0), so the previous justification for a 30s idle timeout — reconnect
  // cleanly instead of handing out a dead socket after a wake-up — no longer
  // applies. What it did apply was a tax: every reconnect costs a fresh TCP
  // plus TLS handshake to Neon's pooler (~1s from this machine), so the first
  // request after 30s of inactivity paid it. Five minutes keeps the sockets
  // usable across a normal session.
  idleTimeoutMillis: 300_000,
  // A connection that cannot be established in time fails the request rather
  // than hanging it forever.
  connectionTimeoutMillis: 10_000,
});

// A pooled socket can die between checkout and query (compute suspend, network
// reset). node-postgres emits it here; without a handler it is an unhandled
// 'error' event that crashes the whole server.
pool.on('error', (error) => {
  console.error('⚠️  idle Postgres client error:', error.message);
});

export const db = drizzle(pool, { schema });

// Every database round-trip goes through `pool.query`: Drizzle issues its
// statements against the pool, and the few raw `pool.query` calls in the
// codebase use it too. Wrapping the method here is therefore the single
// place that can count round-trips per request, and it also sees the SQL
// text for the audit log.
const rawPoolQuery = pool.query.bind(pool);
pool.query = ((...args: unknown[]) => {
  const first = args[0];
  const sql = typeof first === 'string' ? first : (first as { sql?: string } | undefined)?.sql;
  countDbQuery(sql);
  return (rawPoolQuery as (...params: unknown[]) => unknown)(...args);
}) as typeof pool.query;

export type Db = typeof db;

export { schema };

/**
 * Open the pool's connections ahead of the first request.
 *
 * Establishing a connection to Neon costs DNS + TCP + TLS + auth — around a
 * second from this machine. Paying that lazily means the first request after
 * a deploy (or after the pool's idle timeout) waits for it. Since the
 * compute never suspends here, the sockets stay usable, so warming them at
 * boot moves the cost off the user's critical path.
 *
 * Failures are not fatal: the API still works, it just reconnects lazily.
 */
export async function warmPool(): Promise<void> {
  const started = Date.now();
  const target = pool.options.max ?? 5;
  try {
    const clients = await Promise.all(
      Array.from({ length: target }, () => pool.connect())
    );
    await Promise.all(clients.map((client) => client.query('SELECT 1')));
    clients.forEach((client) => client.release());
    console.log(`   DB pool warmed: ${clients.length} connection(s) in ${Date.now() - started}ms`);
  } catch (error) {
    console.warn(
      '⚠️  DB pool warmup failed (the API still works, it just reconnects lazily):',
      error instanceof Error ? error.message : error
    );
  }
}
