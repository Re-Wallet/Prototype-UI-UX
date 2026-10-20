/**
 * Landing metrics: Dynamic environment topline analytics, cached in SQLite.
 *
 * The landing is static (Cloudflare Pages) and must never call Dynamic
 * directly — an API token would end up in the browser. This service keeps a
 * single-row snapshot in `dynamic_metrics` and serves it through
 * `GET /api/landing/metrics`, so the landing only ever talks to our API.
 *
 * Source: Dashboard API `GET /environments/:environmentId/analytics/topline`
 * (bearer auth, `start`/`end` required as YYYY-MM-DD). We consume the
 * `allTime` counters of `users`, `wallets`, and `sessions`.
 *
 * Environment:
 *   DYNAMIC_API_TOKEN        Dashboard API token (scope: environment.analytics.read).
 *                            Without it the endpoint serves the last snapshot
 *                            (or zeros) — never an error.
 *   DYNAMIC_ENVIRONMENT_ID   Environment UUID. Falls back to
 *                            VITE_DYNAMIC_ENVIRONMENT_ID (both are in .env).
 *   DYNAMIC_METRICS_TTL_MS   Snapshot TTL before re-fetching (default 5 min).
 */

import { eq } from 'drizzle-orm';

import { db } from '../db';
import { dynamicMetrics } from '../db/schema';

const DASHBOARD_API = 'https://app.dynamic.xyz/api/v0';
const DEFAULT_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
/** The cache is a single-row snapshot shared by the whole environment. */
const ROW_ID = 1;

export interface LandingMetrics {
  users: number;
  wallets: number;
  sessions: number;
  /** ISO timestamp of the last successful Dynamic pull; null until the first. */
  fetchedAt: string | null;
}

type ToplineResponse = {
  users?: { allTime?: number };
  wallets?: { allTime?: number };
  sessions?: { allTime?: number };
};

const ZERO_METRICS: LandingMetrics = { users: 0, wallets: 0, sessions: 0, fetchedAt: null };

async function readCachedRow() {
  const [row] = await db
    .select()
    .from(dynamicMetrics)
    .where(eq(dynamicMetrics.id, ROW_ID))
    .limit(1);
  return row ?? null;
}

function toLandingMetrics(
  row: { users: number; wallets: number; sessions: number; fetchedAt: Date | null } | null
): LandingMetrics {
  if (!row) return ZERO_METRICS;
  return {
    users: row.users,
    wallets: row.wallets,
    sessions: row.sessions,
    fetchedAt: row.fetchedAt ? row.fetchedAt.toISOString() : null,
  };
}

async function fetchTopline(environmentId: string, token: string): Promise<LandingMetrics> {
  // `start`/`end` are required by the API even though we only read `allTime`.
  const end = new Date();
  const start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
  const day = (d: Date) => d.toISOString().slice(0, 10);

  const url =
    `${DASHBOARD_API}/environments/${encodeURIComponent(environmentId)}` +
    `/analytics/topline?start=${day(start)}&end=${day(end)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Dynamic topline responded ${response.status}`);
  }

  const data = (await response.json()) as ToplineResponse;
  const metrics: LandingMetrics = {
    users: Number(data.users?.allTime ?? 0),
    wallets: Number(data.wallets?.allTime ?? 0),
    sessions: Number(data.sessions?.allTime ?? 0),
    fetchedAt: new Date().toISOString(),
  };

  await db
    .insert(dynamicMetrics)
    .values({
      id: ROW_ID,
      environmentId,
      users: metrics.users,
      wallets: metrics.wallets,
      sessions: metrics.sessions,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: dynamicMetrics.id,
      set: {
        environmentId,
        users: metrics.users,
        wallets: metrics.wallets,
        sessions: metrics.sessions,
        fetchedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  return metrics;
}

/**
 * Landing metrics with a TTL cache in `dynamic_metrics`.
 *
 * Fail-soft by design: missing configuration or a failed pull always answers
 * the last snapshot (however old), and an empty cache answers zeros — the
 * landing animates whatever it gets instead of breaking.
 */
export async function getLandingMetrics(): Promise<LandingMetrics> {
  const cached = toLandingMetrics(await readCachedRow());

  const token = process.env.DYNAMIC_API_TOKEN?.trim();
  const environmentId =
    process.env.DYNAMIC_ENVIRONMENT_ID?.trim() ||
    process.env.VITE_DYNAMIC_ENVIRONMENT_ID?.trim();
  if (!token || !environmentId) return cached;

  const ttl = Number(process.env.DYNAMIC_METRICS_TTL_MS ?? DEFAULT_TTL_MS);
  const fetchedAt = cached.fetchedAt ? Date.parse(cached.fetchedAt) : 0;
  if (Date.now() - fetchedAt < ttl) return cached;

  try {
    return await fetchTopline(environmentId, token);
  } catch (error) {
    console.warn(
      `[metrics] Dynamic topline refresh failed: ${
        error instanceof Error ? error.message : String(error)
      } — serving cached snapshot`
    );
    return cached;
  }
}
