/**
 * Wallet API client (local read/write backend on port 3001).
 *
 * The API is optional at runtime: every call fails soft so the app keeps
 * working on-chain data alone when the local server is not running.
 */

import type { Transaction } from '../types/wallet';
import type { SealedLiveQuery } from '@neon/realtime/client';
import type { LiveTransactionRow } from './transactionMapper';

const API_BASE =
  import.meta.env.VITE_API_URL?.trim() || 'http://127.0.0.1:3001';

const REQUEST_TIMEOUT_MS = 4000;

export interface RecentRecipient {
  id: string;
  email: string | null;
  name: string;
  handle: string;
  address: string;
  lastSentAt: number | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Recent recipients for the Transfer screen; [] when the API is offline or
 * the wallet is not registered. Scoped by the authenticated wallet address so
 * each user only sees recipients THEY sent to.
 */
export async function fetchRecentRecipients(
  walletAddress: string
): Promise<RecentRecipient[]> {
  try {
    const data = await request<RecentRecipient[]>(
      `/api/wallet/contacts?wallet=${encodeURIComponent(walletAddress)}`
    );
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Wire shape of the server-side balance read (cache + paced RPC). */
export interface WalletBalances {
  sol: number;
  usdc: number;
  fetchedAt: number;
  source: 'rpc' | 'cache';
}

/**
 * SOL/USDC balances read server-side (single paced RPC budget + 15s cache).
 * Pass `fresh` right after broadcasting a transaction so the follow-up read
 * is not served pre-transfer values. Returns null when the API is offline so
 * the caller can fall back to a direct RPC read.
 */
export async function fetchWalletBalances(
  walletAddress: string,
  fresh = false
): Promise<WalletBalances | null> {
  try {
    const query = fresh ? '&fresh=1' : '';
    const data = await request<WalletBalances>(
      `/api/wallet/balances?wallet=${encodeURIComponent(walletAddress)}${query}`
    );
    return typeof data?.sol === 'number' && typeof data?.usdc === 'number'
      ? data
      : null;
  } catch {
    return null;
  }
}

/** Wire shape of the public identity lookup for a Solana address. */
export interface WalletIdentity {
  email: string | null;
  handle: string | null;
}

/**
 * Registered email/handle for a wallet address (used by the payment page so
 * the payer sees "Pagar a {email}" instead of a raw pubkey). Returns null for
 * unknown addresses, offline API, or invalid input — the caller falls back to
 * a shortened address.
 */
export async function fetchWalletIdentity(
  address: string
): Promise<WalletIdentity | null> {
  try {
    return await request<WalletIdentity>(
      `/api/wallet/identity?address=${encodeURIComponent(address)}`
    );
  } catch {
    return null;
  }
}

/** Record a transfer recipient; silently ignored when the API is offline. */
export async function registerRecipient(
  senderAddress: string,
  recipientPublicKey: string,
  name?: string
): Promise<void> {
  try {
    await request('/api/wallet/contacts', {
      method: 'POST',
      body: JSON.stringify({
        wallet: senderAddress,
        publicKey: recipientPublicKey,
        ...(name ? { name } : {}),
      }),
    });
  } catch {
    // The transfer itself already succeeded; losing the address book entry
    // must never surface an error to the user.
  }
}

// ============================================================================
// TRANSACTIONS (DB-backed history)
// ============================================================================

/** Wire shape of a `transactions` row after JSON serialization by the API. */
interface ApiTransaction {
  id: string;
  title: string;
  counterparty?: string;
  /** Registered email of the counterparty wallet, when it is a ReWallet user. */
  counterpartyEmail?: string | null;
  type: Transaction['type'];
  status: Transaction['status'];
  amount: number;
  assetSymbol?: 'SOL' | 'USDC';
  fiatAmount: number | null;
  fiatCurrency: string;
  timestamp: string;
  /** ISO string after JSON; revived to Date before returning. */
  date: string;
  method?: string;
  referenceId?: string;
  note?: string;
  txHash?: string;
  walletAddress?: string;
}

/**
 * Transactions for `walletAddress` from the local DB (webhook + sweeper
 * projections). Returns null when the API is offline so the caller can fall
 * back to the direct RPC path.
 *
 * The `date` field is revived: the API serializes it as an ISO string but the
 * UI sorts and renders with a real Date.
 */
export async function fetchWalletTransactions(
  walletAddress: string
): Promise<Transaction[] | null> {
  try {
    const rows = await request<ApiTransaction[]>(
      `/api/wallet/transactions?wallet=${encodeURIComponent(walletAddress)}`
    );
    if (!Array.isArray(rows)) return null;
    return rows.map((row) => ({
      ...row,
      date: new Date(row.date),
    }));
  } catch {
    return null;
  }
}

/**
 * Mint a sealed Neon Realtime capability for the user's transaction live
 * query. Fail-soft (null): without a capability the UI keeps the REST +
 * RPC paths, exactly like `fetchWalletTransactions`.
 */
export async function fetchSealedTransactions(
  walletAddress: string
): Promise<SealedLiveQuery<LiveTransactionRow> | null> {
  try {
    return await request<SealedLiveQuery<LiveTransactionRow>>(
      '/api/wallet/transactions/live',
      {
        method: 'POST',
        body: JSON.stringify({ wallet: walletAddress }),
      }
    );
  } catch {
    return null;
  }
}

/**
 * Persist a just-signed transfer as `pending` so the sender's history
 * survives a reload before any webhook or sweep arrives. Fail-soft: the
 * transfer is already on-chain; losing the local row must not surface an
 * error.
 */
export async function registerPendingTransfer(params: {
  wallet: string;
  signature: string;
  counterpartyPubkey: string;
  amountUsdc: number;
  assetSymbol?: 'USDC' | 'SOL';
  note?: string;
}): Promise<void> {
  try {
    await request('/api/wallet/transactions/pending', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch {
    // Fail-soft by design (see JSDoc).
  }
}

// ============================================================================
// NOTIFICATIONS (bell in the Header)
// ============================================================================

/** Wire shape of a `notifications` row after JSON serialization by the API. */
export interface WalletNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  /** ISO string after JSON. */
  createdAt: string;
  dataJson?: {
    signature?: string;
    assetSymbol?: string;
    amount?: number;
    outgoing?: boolean;
    counterparty?: string;
    walletAddress?: string;
    explorerUrl?: string;
  } | null;
}

export interface NotificationFeed {
  unread: number;
  items: WalletNotification[];
}

/**
 * Notification feed for `walletAddress`. Returns null when the API is offline
 * so the caller can keep the last known feed instead of blanking the bell.
 */
export async function fetchNotifications(
  walletAddress: string
): Promise<NotificationFeed | null> {
  try {
    const data = await request<NotificationFeed>(
      `/api/wallet/notifications?wallet=${encodeURIComponent(walletAddress)}`
    );
    if (!data || !Array.isArray(data.items)) return null;
    return { unread: typeof data.unread === 'number' ? data.unread : 0, items: data.items };
  } catch {
    return null;
  }
}

/**
 * Mark notifications read (all of them when `ids` is omitted). Returns the
 * remaining unread count, or null when the API is offline.
 */
export async function markNotificationsRead(
  walletAddress: string,
  ids?: number[]
): Promise<number | null> {
  try {
    const data = await request<{ unread: number }>('/api/wallet/notifications/read', {
      method: 'POST',
      body: JSON.stringify({
        wallet: walletAddress,
        ...(ids && ids.length > 0 ? { ids } : {}),
      }),
    });
    return typeof data.unread === 'number' ? data.unread : null;
  } catch {
    return null;
  }
}
