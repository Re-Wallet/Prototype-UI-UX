/**
 * A real Postgres pool, for the local scripts only.
 *
 * The API talks to Neon over HTTP (see `index.ts`) because a Worker cannot
 * open a socket. The one-off maintenance scripts — the SQLite migration and
 * the history backfill — run on a developer's machine, where a socket is
 * both possible and faster.
 *
 * Nothing that ships to the Worker imports this file: the HTTP driver is the
 * only database path in the deployed bundle.
 */

import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString?.startsWith('postgres://') && !connectionString?.startsWith('postgresql://')) {
  throw new Error(
    'DATABASE_URL is missing or not a postgres URL. Run `neon env pull` in the project root.'
  );
}

export const pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 300_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (error) => {
  console.error('⚠️  idle Postgres client error:', error.message);
});
