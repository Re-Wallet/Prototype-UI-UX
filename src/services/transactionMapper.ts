/**
 * Pure transaction row → UI mapper.
 *
 * Shared by the server (`listTransactions`, pending-transfer reads) and the
 * browser (Neon Realtime live rows), so this module must stay dependency-
 * free: type-only imports are erased at compile time, and no runtime import
 * may touch `../db` (that would drag the pg pool into the browser bundle).
 */

import type { Transaction as DbTransaction } from '../db/schema';
import type {
  Transaction as UiTransaction,
  TransactionStatus,
  TransactionType,
} from '../types/wallet';

const STATUS_TO_UI: Record<string, TransactionStatus> = {
  pending: 'in_progress',
  confirming: 'in_progress',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'failed',
  expired: 'failed',
};

const TYPE_TO_UI: Record<string, TransactionType> = {
  deposit: 'deposit',
  withdrawal: 'withdrawal',
  sent: 'sent',
  received: 'received',
};

/**
 * Human timestamp for the activity list.
 *
 * Exported because the pending charges are painted by the same list and
 * must read exactly like the movements next to them.
 */
export function formatTimestamp(date: Date | null): string {
  if (!date) return 'Just now';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)} h ago`;
  return date.toLocaleDateString();
}

/**
 * Display-only fields that have no dedicated column in `transactions`.
 *
 * The table is USDC-centric (`amount_usdc` is NOT NULL and there is no
 * `asset_symbol`), so chain-sourced movements keep the extra fidelity the UI
 * renders — asset symbol, owning address, human title — in `metadata_json`.
 */
interface TransactionMetadata {
  assetSymbol?: 'SOL' | 'USDC';
  walletAddress?: string;
  title?: string;
  counterparty?: string;
  /** Network fee in lamports; present only when the source captured it. */
  feeLamports?: number;
}

function readTransactionMetadata(row: DbTransaction): TransactionMetadata {
  const raw = row.metadataJson;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const record = raw as Record<string, unknown>;
  const assetSymbol =
    record.assetSymbol === 'SOL' || record.assetSymbol === 'USDC'
      ? record.assetSymbol
      : undefined;

  return {
    assetSymbol,
    walletAddress:
      typeof record.walletAddress === 'string' ? record.walletAddress : undefined,
    title: typeof record.title === 'string' ? record.title : undefined,
    counterparty: typeof record.counterparty === 'string' ? record.counterparty : undefined,
    feeLamports:
      typeof record.feeLamports === 'number' ? record.feeLamports : undefined,
  };
}

export function mapTransaction(row: DbTransaction): UiTransaction {
  const metadata = readTransactionMetadata(row);
  const isSol = metadata.assetSymbol === 'SOL';

  // `amount_usdc` is the canonical column, but a native-SOL movement stores 0
  // there and keeps its real value in `amount_sol`.
  const amount = isSol ? row.amountSol ?? 0 : row.amountUsdc;

  return {
    id: `tx-${row.id}`,
    title: metadata.title || row.counterpartyHandle || row.method || `Transaction #${row.id}`,
    counterparty: metadata.counterparty ?? row.counterpartyHandle ?? undefined,
    type: TYPE_TO_UI[row.type] ?? 'sent',
    status: STATUS_TO_UI[row.status] ?? 'in_progress',
    amount,
    assetSymbol: metadata.assetSymbol,
    fiatAmount: isSol ? null : row.fiatAmount ?? row.amountUsdc,
    fiatCurrency: row.fiatCurrency ?? 'USD',
    timestamp: formatTimestamp(row.createdAt),
    date: row.createdAt,
    method: row.method ?? undefined,
    referenceId: row.referenceId,
    note: row.note ?? undefined,
    txHash: row.solanaSignature ?? undefined,
    walletAddress: metadata.walletAddress,
    feeLamports: metadata.feeLamports,
  };
}

/**
 * Row shape produced by `liveTransactionsQuery`: every `transactions`
 * column under its Drizzle JS key (see the aliasing note there) plus the
 * left-joined peer email. Matches `DbTransaction` so the same mapper runs.
 */
export type LiveTransactionRow = DbTransaction & {
  counterpartyEmail: string | null;
};

/** Map a live Realtime row exactly like the REST path maps its JSON rows. */
export function mapLiveTransactionRow(row: LiveTransactionRow): UiTransaction {
  return {
    ...mapTransaction(row),
    counterpartyEmail: row.counterpartyEmail,
  };
}
