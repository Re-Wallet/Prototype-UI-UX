/**
 * Wallet API client (local read/write backend on port 3001).
 *
 * The API is optional at runtime: every call fails soft so the app keeps
 * working on-chain data alone when the local server is not running.
 */

import type { Transaction } from '../types/wallet';
import type { SealedLiveQuery } from '@neon/realtime/client';
import type { LiveTransactionRow } from './transactionMapper';
import { getDynamicClient } from '../dynamicClient';

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

/**
 * The session credential, when there is one.
 *
 * Dynamic signs the session and the server verifies that signature, so the
 * wallet the API acts on comes from a signed claim instead of a parameter
 * the caller chose. The token is `client.token` — a plain getter, not a
 * hook — so it is read at call time: the value changes when the user signs
 * in or out, and a captured value would go stale.
 */
let warnedAboutMissingClient = false;

function sessionToken(): string | null {
  try {
    const token = getDynamicClient().token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch (error) {
    // No Dynamic client yet: no environment id, or the SDK has not been
    // created. The request still goes out — a user-scoped route answers 401
    // and a public route answers normally — but a silent 401 loop is
    // impossible to diagnose, so the failure is reported once.
    //
    // Once per process, like the server-side misconfiguration warnings: a
    // long-lived process says it one time, and a serverless isolate says it
    // one time per isolate, which is the right granularity there.
    if (!warnedAboutMissingClient) {
      warnedAboutMissingClient = true;
      console.warn(
        '[api] the Dynamic client is not available; user-scoped requests will answer 401.',
        error
      );
    }
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
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

/**
 * The profile the browser hands over when it provisions the ledger row.
 *
 * The wallet is the only field the server cannot verify for itself — and it
 * does not take it on trust: the server takes the address from the signed
 * session and only uses the body for the profile the user owns.
 */
export interface SessionProfilePayload {
  wallet: string;
  handle?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  language?: string | null;
}

/**
 * Make sure the ledger has a row for the signed-in user.
 *
 * The row is the user's identity in the ledger, and nothing else creates it.
 * Without this the app works for the two seeded accounts and for nobody
 * else. The call is idempotent: it runs on every sign-in and refreshes the
 * profile in place.
 */
export async function provisionSessionUser(
  profile: SessionProfilePayload
): Promise<{ id: number; handle: string; created: boolean }> {
  return await request<{ id: number; handle: string; created: boolean }>(
    '/api/users/session',
    {
      method: 'POST',
      body: JSON.stringify(profile),
    }
  );
}

/**
 * Wire shape of the public identity lookup for a Solana address.
 *
 * The display handle only. The account e-mail used to be part of this
 * payload, and a public route keyed by an on-chain address is a directory
 * scraper rather than a lookup: every pubkey is public, so publishing the
 * e-mail behind it would have handed out the user directory.
 */
export interface WalletIdentity {
  handle: string | null;
}

/**
 * Registered handle for a wallet address (used by the payment page so the
 * payer sees "Pagar a {handle}" instead of a raw pubkey). Returns null for
 * unknown addresses, offline API, or invalid input — the caller falls back
 * to a shortened address.
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
 * The Dynamic session lives in the localStorage of the origin it was
 * created on, and a tunnel and `127.0.0.1` are DIFFERENT origins: the
 * session does not travel between them, and landing on the other one asks
 * the user to log in again.
 *
 * So the rule is "stay where you are" whenever the app is already being
 * served from a public origin: that origin IS the app, and the session
 * that is active there is the one the user has. The configured origin only
 * matters in local development, where the app runs on `127.0.0.1` and the
 * payment link is served from the tunnel — there, the configured value
 * brings the user back to the dev app that holds their session.
 */
export function resolveAppHomeUrl(): string {
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

  if (!isLocal) return window.location.origin;

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
