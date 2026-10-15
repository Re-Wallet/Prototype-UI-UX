/**
 * Drizzle + SQLite connection (prototype).
 *
 * The database file lives at ./data/rewallet.db by default and is ignored by git.
 * Override with DATABASE_URL, e.g. DATABASE_URL=file:./data/dev.db
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import * as schema from './schema';

const DEFAULT_DB_PATH = './data/rewallet.db';

function resolveDatabasePath(): string {
  const raw = process.env.DATABASE_URL?.trim();

  if (!raw) return DEFAULT_DB_PATH;
  if (raw.startsWith('file:')) return raw.slice('file:'.length);
  return raw;
}

const dbPath = resolveDatabasePath();
mkdirSync(dirname(resolve(dbPath)), { recursive: true });

export const sqlite = new Database(dbPath);

// Pragmas: WAL for concurrent reads, FK enforcement, sane durability for dev.
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('synchronous = NORMAL');

export const db = drizzle(sqlite, { schema });

export type Db = typeof db;

export { schema };
