/**
 * Chain-history ingestion (write path).
 *
 * The activity feed must not be read live from the public RPC: a single page
 * load fans out into one `getSignaturesForAddress` per owned token account plus
 * one `getTransaction` per signature, and that burst trips 429s on the shared
 * devnet endpoint. Instead the chain is read once, normalized, and persisted;
 * the UI reads SQLite.
 *
 * The same `syncWalletHistory` serves three callers:
 *   - the one-off backfill for activity that predates the webhook,
 *   - the periodic sweeper that catches what Dynamic never emits
 *     (`wallet.activity` is confirmed-only, so failed transactions are
 *     invisible to it),
 *   - the webhook ingestor's projection step.
 */

import { eq } from 'drizzle-orm';

import type { Address } from '../adapters';
import { db } from '../db';
import { users as usersTable } from '../db/schema';
import type { Transaction as UiTransaction } from '../types/wallet';

import { getWalletTransactions } from './solanaHistory';
import { upsertTransactions, type PersistedMovement } from './wallet';

export interface SyncResult {
  userId: number;
  publicKey: string;
  movements: number;
  inserted: number;
  updated: number;
  error?: string;
}

/**
 * `parseWalletTransaction` drops transactions whose `meta.err` is non-null, so
 * every movement it yields is already confirmed on-chain. It still labels
 * outgoing movements `in_progress` — a UI affordance, not chain state — so
 * persistence records what the chain actually says.
 */
const CONFIRMED_STATUS = 'completed';
const CONFIRMED_CONFIRMATIONS = 1;

/**
 * Normalize one RPC movement into a persistable row.
 *
 * `referenceId` is the movement's own id (`<signature>-<asset>`), never the
 * bare signature it also carries: one transaction can yield both a native-SOL
 * and a USDC movement for the same wallet, and `(user_id, reference_id)` is the
 * unique key that keeps them apart.
 *
 * The counterparty address is intentionally left null here. Recovering it would
 * cost one extra RPC call per movement — the exact traffic this service exists
 * to avoid. The webhook fills it from `fromAddress`/`toAddress` as activity
 * arrives; the backfill only needs the movement itself.
 */
function toPersistedMovement(
  movement: UiTransaction,
  publicKey: string
): PersistedMovement | null {
  if (!movement.id) return null;

  const assetSymbol = movement.assetSymbol ?? 'USDC';
  const isSol = assetSymbol === 'SOL';

  return {
    referenceId: movement.id,
    type: movement.type,
    status: CONFIRMED_STATUS,
    // `amount_usdc` is NOT NULL, so a native-SOL movement stores 0 there and
    // keeps its real value in `amount_sol`.
    amountUsdc: isSol ? 0 : movement.amount,
    amountSol: isSol ? movement.amount : null,
    fiatAmount: isSol ? null : movement.fiatAmount ?? movement.amount,
    fiatCurrency: movement.fiatCurrency ?? 'USD',
    method: movement.method ?? null,
    solanaSignature: movement.txHash ?? movement.referenceId ?? null,
    confirmations: CONFIRMED_CONFIRMATIONS,
    confirmedAt: movement.date,
    counterpartyPubkey: null,
    metadataJson: {
      assetSymbol,
      title: movement.title,
      walletAddress: publicKey,
      source: 'solana-history',
    },
    createdAt: movement.date,
  };
}

/** Read one wallet's on-chain history and upsert it. Idempotent. */
export async function syncWalletHistory(
  userId: number,
  publicKey: string
): Promise<SyncResult> {
  const movements = await withRetry(publicKey, () =>
    getWalletTransactions(publicKey as Address)
  );

  const persisted = movements
    .map((movement) => toPersistedMovement(movement, publicKey))
    .filter((movement): movement is PersistedMovement => movement !== null);

  const { inserted, updated } = await upsertTransactions(userId, persisted);

  return { userId, publicKey, movements: movements.length, inserted, updated };
}

/** Resolve a wallet by public key, then sync it. */
export async function syncWalletByPubkey(
  publicKey: string
): Promise<SyncResult | null> {
  const address = publicKey.trim();
  if (!address) return null;

  const [user] = await db
    .select({ id: usersTable.id, publicKey: usersTable.publicKey })
    .from(usersTable)
    .where(eq(usersTable.publicKey, address))
    .limit(1);

  if (!user) return null;
  return syncWalletHistory(user.id, user.publicKey);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// RATE-LIMIT DISCIPLINE
// ============================================================================

/**
 * `getWalletTransactions` fans out by design: one signature query per owned
 * token account (two pages each) plus transaction fetches in batches of eight.
 * Against a public cluster endpoint that burst is answered with 429 and no
 * `Retry-After`, so the ingestor backs off on its own. This is a background
 * job — waiting is always cheaper than losing the run.
 */
const RETRY_ATTEMPTS = 6;
const RETRY_BASE_MS = 800;
const RETRY_MAX_MS = 10_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryable(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    /\b(429|5\d\d)\b/.test(message) ||
    /too many requests|rate limit|timed? ?out|fetch failed|ECONNRESET|EAI_AGAIN|socket hang up/i.test(
      message
    )
  );
}

/** Exponential backoff with jitter, so parallel callers do not resynchronise. */
function backoffDelay(attempt: number): number {
  const ceiling = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
  return Math.round(ceiling * (0.5 + Math.random() * 0.5));
}

async function withRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === RETRY_ATTEMPTS - 1;
      if (!isRetryable(error) || isLastAttempt) throw error;

      const delay = backoffDelay(attempt);
      console.warn(
        `[historySync] ${label}: reintento ${attempt + 1}/${RETRY_ATTEMPTS - 1} en ${delay}ms → ${errorMessage(error)}`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Sync every persisted wallet, sequentially.
 *
 * Serial on purpose: the RPC rate limit is per endpoint, so parallel wallets
 * would recreate the 429 burst this ingestion is meant to eliminate.
 */
export async function syncAllWallets(delayMs = 3000): Promise<SyncResult[]> {
  const wallets = await db
    .select({ id: usersTable.id, publicKey: usersTable.publicKey, handle: usersTable.handle })
    .from(usersTable)
    .orderBy(usersTable.id);

  const results: SyncResult[] = [];

  for (const wallet of wallets) {
    try {
      results.push(await syncWalletHistory(wallet.id, wallet.publicKey));
    } catch (error) {
      results.push({
        userId: wallet.id,
        publicKey: wallet.publicKey,
        movements: 0,
        inserted: 0,
        updated: 0,
        error: errorMessage(error),
      });
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  return results;
}
