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

import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString?.startsWith('postgres://') && !connectionString?.startsWith('postgresql://')) {
  throw new Error(
    'DATABASE_URL is missing or not a postgres URL. Run `neon env pull` in the project root.'
  );
}

export const pool = new Pool({
  connectionString,
  // Neon suspends idle computes and drops pooled sockets when it does, so the
  // defaults (max 10, 10s idle) keep more connections than this single-process
  // API needs and hold them open past a suspend. A small, short-lived pool
  // reconnects cleanly on wake instead of handing out a dead socket.
  max: 5,
  idleTimeoutMillis: 30_000,
  // Neon's first connect after a suspend pays the compute wake-up (~500ms);
  // the default 0 (wait forever) would hang a request instead of failing it.
  connectionTimeoutMillis: 10_000,
});

// A pooled socket can die between checkout and query (compute suspend, network
// reset). node-postgres emits it here; without a handler it is an unhandled
// 'error' event that crashes the whole server.
pool.on('error', (error) => {
  console.error('⚠️  idle Postgres client error:', error.message);
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;

export { schema };
