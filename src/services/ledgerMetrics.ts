/**
 * Landing metrics that only exist in our own ledger.
 *
 * Dynamic's analytics describe adoption — users, wallets, sessions, retention
 * — and say nothing about transactions, volume, success rate or settlement
 * time. Those four numbers live here, computed from the projection of
 * Solana that the database holds.
 *
 * The snapshot table (`ledger_metrics`) exists for the same reason as
 * `dynamic_metrics`: the landing is a public static page, and a database
 * hiccup must never put zeros (or a 500) on it. The last known numbers are
 * served until the next successful computation.
 *
 * Two counting rules matter here, and both were verified against the data:
 *
 * 1. **One row per on-chain movement.** A transfer produces two rows — the
 *    sender's and the receiver's — sharing the same `reference_id`. Summing
 *    `amount_usdc` over the raw table counts every transfer twice, so the
 *    volume is computed over distinct movements.
 * 2. **Success rate is over settled movements.** The denominator is
 *    completed + failed: a movement still pending has not failed yet.
 */

import { eq, sql } from 'drizzle-orm';

import { db } from '../db';
import { ledgerMetrics } from '../db/schema';
import type { LandingMetrics } from './dynamicMetrics';
import { getCached } from './readCache';

const DEFAULT_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
/** The cache is a single-row snapshot shared by the whole environment. */
const ROW_ID = 1;

export interface LedgerMetrics {
  /** Distinct on-chain movements projected into the ledger. */
  transactions: number;
  /** USDC moved, counted once per on-chain movement. */
  volumeUsdc: number;
  /** Share of settled movements that completed, in percent (0-100). */
  successRate: number;
  /** Average time from the webhook landing to the movement being projected. */
  avgProcessingMs: number;
  /** ISO timestamp of the last successful computation; null until the first. */
  fetchedAt: string | null;
}

/** The landing payload: the Dynamic counters plus the ledger ones. */
export interface LandingMetricsResponse extends LandingMetrics {
  transactions: number;
  volumeUsdc: number;
  successRate: number;
  avgProcessingMs: number;
}

const ZERO_LEDGER: LedgerMetrics = {
  transactions: 0,
  volumeUsdc: 0,
  successRate: 0,
  avgProcessingMs: 0,
  fetchedAt: null,
};

/**
 * One round-trip for the four numbers.
 *
 * The project counts database round-trips per request (the `X-DB-Queries`
 * header), and the landing is hit by every visitor: the whole metric set
 * has to come out of a single query.
 */
const METRICS_QUERY = sql`
WITH movements AS (
  -- One row per on-chain movement: a transfer is stored twice (sender and
  -- receiver) with the same reference_id.
  SELECT DISTINCT ON (reference_id)
         reference_id,
         amount_usdc,
         status
  FROM transactions
  ORDER BY reference_id, created_at
),
ledger AS (
  SELECT
    count(*)::int AS transactions,
    coalesce(sum(amount_usdc), 0)::float8 AS volume_usdc,
    count(*) FILTER (WHERE status = 'completed')::int AS completed,
    count(*) FILTER (WHERE status = 'failed')::int AS failed
  FROM movements
),
latency AS (
  -- How long a movement takes to be projected once the chain reports it.
  SELECT coalesce(
    avg(extract(epoch FROM (processed_at - received_at)) * 1000),
    0
  )::int AS avg_processing_ms
  FROM webhook_events
  WHERE processed_at IS NOT NULL
)
SELECT
  ledger.transactions AS transactions,
  ledger.volume_usdc AS volume_usdc,
  CASE
    WHEN ledger.completed + ledger.failed = 0 THEN 0
    ELSE round(
      (100.0 * ledger.completed / (ledger.completed + ledger.failed))::numeric,
      2
    )::float8
  END AS success_rate,
  latency.avg_processing_ms AS avg_processing_ms
FROM ledger, latency
`;

/**
 * Merge the two sources into the payload the landing consumes.
 *
 * Additive by construction: the Dynamic fields are passed through untouched,
 * so any consumer of the current shape keeps working.
 */
export function buildLandingMetricsResponse(
  dynamic: LandingMetrics,
  ledger: LedgerMetrics | null
): LandingMetricsResponse {
  return {
    ...dynamic,
    transactions: ledger?.transactions ?? 0,
    volumeUsdc: Math.round((ledger?.volumeUsdc ?? 0) * 100) / 100,
    successRate: Math.round((ledger?.successRate ?? 0) * 100) / 100,
    avgProcessingMs: Math.round(ledger?.avgProcessingMs ?? 0),
  };
}

async function readSnapshot(): Promise<LedgerMetrics> {
  const [row] = await db
    .select()
    .from(ledgerMetrics)
    .where(eq(ledgerMetrics.id, ROW_ID))
    .limit(1);

  if (!row) return ZERO_LEDGER;

  return {
    transactions: row.transactions,
    volumeUsdc: row.volumeUsdc,
    successRate: row.successRate,
    avgProcessingMs: row.avgProcessingMs,
    fetchedAt: row.fetchedAt ? row.fetchedAt.toISOString() : null,
  };
}

async function computeAndStore(): Promise<LedgerMetrics> {
  const result = await db.execute(METRICS_QUERY);
  const row = (result.rows as Array<Record<string, unknown>>)[0] ?? {};

  const metrics: LedgerMetrics = {
    transactions: Number(row.transactions ?? 0),
    volumeUsdc: Number(row.volume_usdc ?? 0),
    successRate: Number(row.success_rate ?? 0),
    avgProcessingMs: Number(row.avg_processing_ms ?? 0),
    fetchedAt: new Date().toISOString(),
  };

  await db
    .insert(ledgerMetrics)
    .values({
      id: ROW_ID,
      transactions: metrics.transactions,
      volumeUsdc: metrics.volumeUsdc,
      successRate: metrics.successRate,
      avgProcessingMs: metrics.avgProcessingMs,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: ledgerMetrics.id,
      set: {
        transactions: metrics.transactions,
        volumeUsdc: metrics.volumeUsdc,
        successRate: metrics.successRate,
        avgProcessingMs: metrics.avgProcessingMs,
        fetchedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  return metrics;
}

/**
 * The ledger metrics, cached in process and snapshotted in the database.
 *
 * Fail-soft like the Dynamic ones: a failed computation serves the last
 * snapshot, and an empty cache serves zeros — the landing animates whatever
 * it gets instead of breaking.
 */
export async function getLedgerMetrics(): Promise<LedgerMetrics> {
  return getCached('landing-ledger-metrics', refresh, { ttlMs: DEFAULT_TTL_MS });
}

async function refresh(): Promise<LedgerMetrics> {
  let cached: LedgerMetrics;
  try {
    cached = await readSnapshot();
  } catch (error) {
    // The database is unreachable. The Dynamic counters do not depend on it,
    // so the ledger ones fall back to zeros instead of taking the whole
    // endpoint down with them.
    console.warn(
      `[metrics] ledger snapshot unreadable: ${
        error instanceof Error ? error.message : String(error)
      } — serving zeros`
    );
    return ZERO_LEDGER;
  }

  const ttl = Number(process.env.LEDGER_METRICS_TTL_MS ?? DEFAULT_TTL_MS);
  const fetchedAt = cached.fetchedAt ? Date.parse(cached.fetchedAt) : 0;
  if (Date.now() - fetchedAt < ttl) return cached;

  try {
    return await computeAndStore();
  } catch (error) {
    console.warn(
      `[metrics] ledger computation failed: ${
        error instanceof Error ? error.message : String(error)
      } — serving cached snapshot`
    );
    return cached;
  }
}
