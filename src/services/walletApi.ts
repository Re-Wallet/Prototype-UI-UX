/**
 * Wallet API client (local read/write backend on port 3001).
 *
 * The API is optional at runtime: every call fails soft so the app keeps
 * working on-chain data alone when the local server is not running.
 */

import type { Transaction } from '../types/wallet';
import type { SealedLiveQuery } from '@neon/realtime/client';
import type { LiveTransactionRow } from './transactionMapper';

/**
 * Base URL for API calls.
 *
 * Empty by default, which makes every call same-origin and relative. The
 * Vite dev server proxies `/api` to the API process, so the app works the
 * same whether it is opened on localhost or through a tunnel — and a payer
 * opening `/pay` from another device can reach the API instead of trying
 * `127.0.0.1`, which would point at their own machine.
 *
 * `VITE_API_URL` still overrides it for a split deployment.
 */
const API_BASE = import.meta.env.VITE_API_URL?.trim() ?? '';

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
 * Browser-side mirror of the server cache: the last known address book per
 * wallet.
 *
 * The Transfer and Withdraw screens remount every time the user switches tab.
 * Painting this synchronously keeps the contacts from flashing empty while
 * the refresh lands. It is a pure latency buffer — the server still owns the
 * truth, and the refresh below replaces it.
 */
const recipientsCache = new Map<string, RecentRecipient[]>();

/** The last known address book for `walletAddress`, or null if never loaded. */
export function peekRecentRecipients(walletAddress: string): RecentRecipient[] | null {
  return recipientsCache.get(walletAddress) ?? null;
}

/**
 * Recent recipients for the Transfer screen; [] when the API is offline or
 * the wallet is not registered. Scoped by the authenticated wallet address so
 * each user only sees recipients THEY sent to.
 *
 * Offline, the last known list is served rather than an empty one.
 */
export async function fetchRecentRecipients(
  walletAddress: string
): Promise<RecentRecipient[]> {
  try {
    const data = await request<RecentRecipient[]>(
      `/api/wallet/contacts?wallet=${encodeURIComponent(walletAddress)}`
    );
    const list = Array.isArray(data) ? data : [];
    recipientsCache.set(walletAddress, list);
    return list;
  } catch {
    return recipientsCache.get(walletAddress) ?? [];
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

// ============================================================================
// PAYMENT LINKS (single-use charge links)
// ============================================================================

/** Wire shape of a `payment_links` row after JSON serialization by the API. */
export interface PaymentLinkDto {
  id: number;
  slug: string;
  referencePubkey: string;
  amountUsdc: number | null;
  currency: string;
  concept: string;
  status: 'active' | 'paid' | 'partial' | 'expired' | 'cancelled';
  paidAmountUsdc: number;
  paidAt: string | null;
  paidByPubkey: string | null;
  paidTxId: number | null;
  /** Signature of the transaction that settled this link. */
  paidTxSignature: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/**
 * Row shape produced by `livePaymentLinksQuery`: every `payment_links`
 * column under its Drizzle JS key. The Realtime client revives `timestamptz`
 * with its default parser, so dates arrive as `Date` — unlike the REST path,
 * where JSON serialization turns them into ISO strings.
 */
export interface LivePaymentLinkRow {
  id: number;
  userId: number;
  slug: string;
  referencePubkey: string;
  amountUsdc: number | null;
  currency: string;
  concept: string;
  status: PaymentLinkDto['status'];
  paidAmountUsdc: number;
  paidAt: Date | null;
  paidByPubkey: string | null;
  paidTxId: number | null;
  paidTxSignature: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Serialize a live row's timestamp, tolerating an absent or invalid date. */
function toIsoString(value: Date | null | undefined): string | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * Map a live Realtime payment-link row to the same DTO the REST path
 * returns, so both sources feed the UI identically.
 */
export function mapLivePaymentLink(row: LivePaymentLinkRow): PaymentLinkDto {
  return {
    id: row.id,
    slug: row.slug,
    referencePubkey: row.referencePubkey,
    amountUsdc: row.amountUsdc,
    currency: row.currency,
    concept: row.concept,
    status: row.status,
    paidAmountUsdc: row.paidAmountUsdc,
    paidAt: toIsoString(row.paidAt),
    paidByPubkey: row.paidByPubkey,
    paidTxId: row.paidTxId,
    paidTxSignature: row.paidTxSignature ?? null,
    expiresAt: toIsoString(row.expiresAt),
    createdAt: toIsoString(row.createdAt) ?? new Date(0).toISOString(),
  };
}

/**
 * Where the "Inicio" button on the payment page should take the user.
 *
 * The payment link and the app home are not always the same place during
 * development: the link has to be reachable from another device (so it
 * points at the tunnel), while the app home is where the user's session
 * already exists. A tunnel and `127.0.0.1` are DIFFERENT origins, so the
 * Dynamic session — which lives in localStorage — does not carry over, and
 * landing on the tunnel origin asks the user to log in again.
 *
 * `VITE_PUBLIC_APP_URL` names the app's home. Without it, the current
 * origin is used, which is correct in production where there is only one.
 */
export function resolveAppHomeUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  return configured ? configured.replace(/\/$/, '') : window.location.origin;
}

/**
 * The public origin the app is reachable at.
 *
 * When the app runs on localhost the payment link must still point at the
 * public tunnel, or the payer (on another device) cannot open it. The API
 * publishes the tunnel's current hostname, so a tunnel restart never needs a
 * frontend rebuild.
 *
 * Returns null when the app is already on a public origin or the tunnel is
 * unknown; the caller then keeps the browser's own origin.
 */
export async function fetchPublicAppUrl(): Promise<string | null> {
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (!isLocal) return window.location.origin;
  try {
    const data = await request<{ url: string | null }>('/api/tunnel');
    return data.url ? data.url.replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

/**
 * Mint a sealed Neon Realtime capability for the user's payment links.
 * Fail-soft (null): without a capability the UI keeps the REST path, exactly
 * like `fetchSealedTransactions`.
 */
export async function fetchSealedPaymentLinks(
  walletAddress: string
): Promise<SealedLiveQuery<LivePaymentLinkRow> | null> {
  try {
    return await request<SealedLiveQuery<LivePaymentLinkRow>>(
      '/api/payment-links/live',
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
 * Create a single-use charge link for `walletAddress`. Returns the created
 * link, or null when the API is offline (fail-soft: the QR falls back to a
 * linkless URL).
 */
export async function createPaymentLink(
  walletAddress: string,
  params: { amountUsdc: number | null; concept: string }
): Promise<PaymentLinkDto | null> {
  try {
    return await request<PaymentLinkDto>('/api/payment-links', {
      method: 'POST',
      body: JSON.stringify({ wallet: walletAddress, ...params }),
    });
  } catch {
    return null;
  }
}

/**
 * Declare which payment link this transaction settles.
 *
 * The reference does not travel on-chain, so without this the server has to
 * guess the link from the recipient and the amount — and it guesses wrong
 * when the same recipient has two open charges of the same amount. The payer
 * knows exactly which link it opened, so it says so.
 *
 * Fail-soft: the webhook still settles the link if this call does not reach
 * the server, and the server verifies the transfer on-chain before settling.
 */
export async function claimPaymentLink(reference: string, signature: string): Promise<boolean> {
  // The server verifies the transfer on-chain and the public RPC can be
  // rate-limited, so a transient failure gets a couple of retries. The
  // webhook remains the fallback.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await request<{ ok: boolean }>('/api/payment-links/claim', {
        method: 'POST',
        body: JSON.stringify({ reference, signature }),
      });
      if (data?.ok === true) return true;
      // A definitive rejection (the link is settled, the amount does not
      // match) will not improve with another attempt.
      return false;
    } catch {
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  return false;
}

/**
 * Fetch a payment link by its on-chain reference. Returns null when not
 * found or the API is offline — the caller decides whether to block.
 */
export async function fetchPaymentLinkByReference(
  reference: string
): Promise<PaymentLinkDto | null> {
  try {
    return await request<PaymentLinkDto>(
      `/api/payment-links/by-reference/${encodeURIComponent(reference)}`
    );
  } catch {
    return null;
  }
}

/**
 * Fetch the caller's payment links. Returns null when the API is offline.
 */
export async function fetchPaymentLinks(walletAddress: string): Promise<PaymentLinkDto[] | null> {
  try {
    const data = await request<PaymentLinkDto[]>(`/api/payment-links?wallet=${encodeURIComponent(walletAddress)}`);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
