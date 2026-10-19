/**
 * Wallet service layer.
 *
 * Maps persisted SQLite wallet records to the API domain types.
 */

import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';

import { db } from '../db';
import {
  contacts as contactsTable,
  notifications as notificationsTable,
  transactions as transactionsTable,
  users as usersTable,
} from '../db/schema';
import type { User as DbUser, Transaction as DbTransaction, Contact as DbContact } from '../db/schema';

import type {
  Contact as UiContact,
  Transaction as UiTransaction,
  TransactionStatus,
  TransactionType,
} from '../types/wallet';

// ============================================================================
// DOMAIN MAPPERS
// ============================================================================

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

function formatTimestamp(date: Date | null): string {
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
  };
}

export function mapContact(row: DbContact): UiContact {
  return {
    id: `c-${row.id}`,
    name: row.name,
    handle: row.handle,
    avatarBg: row.avatarBg ?? 'bg-[#ff5a1f]',
    avatarEmoji: row.avatarEmoji ?? '◡̈',
    recent: row.isFavorite,
    address: row.publicKey ?? undefined,
    isVerified: row.isVerified,
  };
}

export interface WalletUserProfile {
  id: number;
  name: string;
  handle: string;
  email: string | null;
  phone: string | null;
  avatarBg: string;
  avatarEmoji: string;
  country: string | null;
  publicKey: string;
  walletAddress: string;
  language: string;
  balanceUsdc: number;
  balanceSol: number;
  kycStatus: string;
}

export function mapUser(row: DbUser): WalletUserProfile {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    email: row.email,
    phone: row.phone,
    avatarBg: row.avatarBg ?? 'bg-[#ff1f71]',
    avatarEmoji: row.avatarEmoji ?? '◡̈',
    country: row.country,
    publicKey: row.publicKey,
    walletAddress: `${row.publicKey.slice(0, 6)}...${row.publicKey.slice(-4)}`,
    language: row.language,
    balanceUsdc: row.balanceUsdc,
    balanceSol: row.balanceSol,
    kycStatus: row.kycStatus,
  };
}

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Resolve the primary persisted wallet.
 *
 * Peers (counterparties) are also rows in `users`, so ordering by id alone can
 * pick the wrong wallet. Prefer the KYC-verified wallet that owns transactions,
 * falling back to the oldest row.
 */
export async function getPrimaryUser(): Promise<WalletUserProfile | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .orderBy(
      sql`CASE WHEN ${usersTable.kycStatus} = 'verified' THEN 0 ELSE 1 END`,
      sql`(SELECT COUNT(*) FROM ${transactionsTable} WHERE ${transactionsTable.userId} = ${usersTable.id}) DESC`,
      usersTable.id
    )
    .limit(1);

  return rows.length > 0 ? mapUser(rows[0]) : null;
}

/**
 * Resolve a wallet profile by its Solana public key.
 *
 * Used to scope per-session data (contacts, recent recipients) to the wallet
 * the user authenticated with, instead of the single primary user.
 */
export async function getUserByPubkey(
  publicKey: string
): Promise<WalletUserProfile | null> {
  const address = publicKey.trim();
  if (!address) return null;

  const [row] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.publicKey, address))
    .limit(1);

  return row ? mapUser(row) : null;
}

export async function listTransactions(
  userId: number,
  limit = 50
): Promise<UiTransaction[]> {
  const rows = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.userId, userId))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limit);

  // Resolve the peer's registered email so receipts can name people instead
  // of base58 strings. Left-joined: a counterparty outside ReWallet simply
  // has no row, and the UI falls back to the address.
  const pubkeys = [
    ...new Set(
      rows
        .map((row) => row.counterpartyPubkey)
        .filter((key): key is string => typeof key === 'string' && key.length > 0)
    ),
  ];
  const peers =
    pubkeys.length > 0
      ? await db
          .select({ publicKey: usersTable.publicKey, email: usersTable.email })
          .from(usersTable)
          .where(inArray(usersTable.publicKey, pubkeys))
      : [];
  const emailByPubkey = new Map(peers.map((peer) => [peer.publicKey, peer.email]));

  return rows.map((row) => ({
    ...mapTransaction(row),
    counterpartyEmail: row.counterpartyPubkey
      ? emailByPubkey.get(row.counterpartyPubkey) ?? null
      : null,
  }));
}

// ============================================================================
// WRITE PATH (chain-sourced movements)
// ============================================================================

/**
 * A movement normalized for persistence, closest to the SQLite columns.
 *
 * `referenceId` is `<signature>-<asset>`, not the bare signature: a single
 * transaction can produce both a native-SOL and a USDC movement for the same
 * wallet, and the per-user unique index would otherwise reject the second one.
 */
export interface PersistedMovement {
  referenceId: string;
  type: 'deposit' | 'withdrawal' | 'sent' | 'received';
  status: 'pending' | 'confirming' | 'completed' | 'failed' | 'cancelled' | 'expired';
  amountUsdc: number;
  amountSol?: number | null;
  fiatAmount?: number | null;
  fiatCurrency?: string | null;
  method?: string | null;
  solanaSignature?: string | null;
  solanaSlot?: number | null;
  counterpartyPubkey?: string | null;
  confirmations?: number;
  confirmedAt?: Date | null;
  failedReason?: string | null;
  metadataJson?: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Insert or refresh a batch of chain-sourced movements for one wallet.
 *
 * Idempotent on `(user_id, reference_id)`, so re-running the backfill or a
 * webhook re-projecting a transaction the sweeper already stored updates the
 * row instead of duplicating it. This is deliberately a different concern from
 * the delivery-level dedupe in `webhook_events`.
 */
export async function upsertTransactions(
  userId: number,
  movements: PersistedMovement[]
): Promise<{ inserted: number; updated: number }> {
  if (movements.length === 0) return { inserted: 0, updated: 0 };

  const existing = await db
    .select({ referenceId: transactionsTable.referenceId })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.userId, userId),
        inArray(
          transactionsTable.referenceId,
          movements.map((movement) => movement.referenceId)
        )
      )
    );
  const alreadyStored = new Set(existing.map((row) => row.referenceId));

  for (const movement of movements) {
    const values = {
      userId,
      referenceId: movement.referenceId,
      type: movement.type,
      status: movement.status,
      amountUsdc: movement.amountUsdc,
      amountSol: movement.amountSol ?? null,
      fiatAmount: movement.fiatAmount ?? null,
      fiatCurrency: movement.fiatCurrency ?? 'USD',
      method: movement.method ?? null,
      solanaSignature: movement.solanaSignature ?? null,
      solanaSlot: movement.solanaSlot ?? null,
      counterpartyPubkey: movement.counterpartyPubkey ?? null,
      confirmations: movement.confirmations ?? 0,
      confirmedAt: movement.confirmedAt ?? null,
      failedReason: movement.failedReason ?? null,
      metadataJson: movement.metadataJson ?? null,
      createdAt: movement.createdAt,
      updatedAt: new Date(),
    };

    await db
      .insert(transactionsTable)
      .values(values)
      .onConflictDoUpdate({
        target: [transactionsTable.userId, transactionsTable.referenceId],
        set: {
          status: values.status,
          amountUsdc: values.amountUsdc,
          amountSol: values.amountSol,
          fiatAmount: values.fiatAmount,
          method: values.method,
          solanaSignature: values.solanaSignature,
          solanaSlot: values.solanaSlot,
          // Chain syncs (backfill/sweeper) carry no counterparty and thinner
          // metadata than webhook projections. Merge on conflict so a later
          // sync can never erase enrichment a webhook already wrote — the
          // sweeper re-runs every few minutes and would otherwise roll it back.
          counterpartyPubkey: sql`COALESCE(${values.counterpartyPubkey ?? null}, ${transactionsTable.counterpartyPubkey})`,
          confirmations: values.confirmations,
          confirmedAt: values.confirmedAt,
          failedReason: values.failedReason,
          metadataJson: sql`json_patch(COALESCE(${transactionsTable.metadataJson}, '{}'), ${JSON.stringify(values.metadataJson ?? {})})`,
          updatedAt: values.updatedAt,
        },
      });
  }

  return {
    inserted: movements.length - alreadyStored.size,
    updated: alreadyStored.size,
  };
}

// ============================================================================
// PENDING TRANSFER (send-time state persistence)
// ============================================================================

export interface PendingTransferInput {
  signature: string;
  counterpartyPubkey: string;
  amountUsdc: number;
  assetSymbol?: 'USDC' | 'SOL';
  note?: string | null;
}

/**
 * Record a just-signed transfer as `pending` for `userId`.
 *
 * The row exists from the moment the transaction is signed, so the sender's
 * history survives a reload before any webhook or sweep arrives. The webhook
 * projection (or the sweeper) later upserts the SAME `(user_id, reference_id)`
 * key with `completed`, flipping the status — that handoff is the whole point
 * of sharing the reference format `<signature>-<symbol>`.
 *
 * Idempotent: a duplicate POST (retry, double render) returns the existing row.
 */
export async function insertPendingTransfer(
  userId: number,
  input: PendingTransferInput
): Promise<UiTransaction | null> {
  const symbol = input.assetSymbol === 'SOL' ? 'SOL' : 'USDC';
  const isSol = symbol === 'SOL';
  const now = new Date();

  const [owner] = await db
    .select({ publicKey: usersTable.publicKey })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  await db
    .insert(transactionsTable)
    .values({
      userId,
      referenceId: `${input.signature}-${symbol}`,
      type: isSol ? 'withdrawal' : 'sent',
      status: 'pending',
      amountUsdc: isSol ? 0 : input.amountUsdc,
      amountSol: isSol ? input.amountUsdc : null,
      fiatAmount: isSol ? null : input.amountUsdc,
      fiatCurrency: 'USD',
      method: isSol ? 'Solana' : `Solana ${symbol}`,
      solanaSignature: input.signature,
      counterpartyPubkey: input.counterpartyPubkey,
      confirmations: 0,
      note: input.note ?? null,
      metadataJson: {
        assetSymbol: symbol,
        walletAddress: owner?.publicKey ?? null,
        title: `Envío ${symbol}`,
        counterparty: input.counterpartyPubkey,
        source: 'client-pending',
      },
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.userId, userId),
        eq(transactionsTable.referenceId, `${input.signature}-${symbol}`)
      )
    )
    .limit(1);

  return row ? mapTransaction(row) : null;
}

export async function listContacts(userId: number): Promise<UiContact[]> {
  const rows = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.userId, userId))
    .orderBy(desc(contactsTable.isFavorite), contactsTable.name);

  return rows.map(mapContact);
}

// ============================================================================
// RECENT RECIPIENTS (Transfer screen address book)
// ============================================================================

export interface RecentRecipient {
  id: string;
  /** Email of the registered ReWallet user behind this address, when known. */
  email: string | null;
  /** Display name; falls back to a truncated address for unknown peers. */
  name: string;
  handle: string;
  address: string;
  lastSentAt: number | null;
}

function truncateAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

/**
 * Contacts of `userId` most recently interacted with, with the peer's email
 * resolved from `users`. The join matches on the contact FK first and falls
 * back to the raw public key so an address-only contact still picks up an
 * email as soon as a `users` row exists for that wallet.
 */
/**
 * Recipients of `userId`, most recent first.
 *
 * Two sources, merged by address:
 *   - Explicit `contacts` rows (they keep their chosen name and win the merge).
 *   - The counterparty of every outgoing movement (sent / withdrawal) the user
 *     has in `transactions`.
 *
 * The movement source matters: the webhook projection is what writes a send to
 * the DB, so a transfer made through a flow that never POSTs a contact — or
 * straight from another wallet — still surfaces here. The peer's email is
 * resolved from `users` by public key, falling back to a truncated address.
 */
export async function listRecentRecipients(
  userId: number,
  limit = 6
): Promise<RecentRecipient[]> {
  const outgoingAt = sql<number | null>`COALESCE(${transactionsTable.confirmedAt}, ${transactionsTable.createdAt})`;

  const [contactRows, transferRows] = await Promise.all([
    db
      .select({
        id: contactsTable.id,
        handle: contactsTable.handle,
        name: contactsTable.name,
        publicKey: contactsTable.publicKey,
        updatedAt: contactsTable.updatedAt,
      })
      .from(contactsTable)
      .where(eq(contactsTable.userId, userId))
      .orderBy(desc(contactsTable.updatedAt))
      .limit(limit),
    db
      .select({
        id: transactionsTable.id,
        publicKey: transactionsTable.counterpartyPubkey,
        at: outgoingAt,
      })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.userId, userId),
          inArray(transactionsTable.type, ['sent', 'withdrawal']),
          isNotNull(transactionsTable.counterpartyPubkey),
          ne(transactionsTable.status, 'failed')
        )
      )
      .orderBy(desc(outgoingAt))
      .limit(limit * 3),
  ]);

  const addresses = new Set<string>();
  for (const row of contactRows) if (row.publicKey) addresses.add(row.publicKey);
  for (const row of transferRows) if (row.publicKey) addresses.add(row.publicKey);
  if (addresses.size === 0) return [];

  const peers = await db
    .select({
      publicKey: usersTable.publicKey,
      handle: usersTable.handle,
      name: usersTable.name,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(inArray(usersTable.publicKey, [...addresses]));
  const peerByAddress = new Map(peers.map((peer) => [peer.publicKey, peer]));

  const merged = new Map<string, RecentRecipient>();

  // Explicit contacts first: they carry the name the user picked.
  for (const row of contactRows) {
    if (!row.publicKey) continue;
    const peer = peerByAddress.get(row.publicKey);
    merged.set(row.publicKey, {
      id: `c-${row.id}`,
      email: peer?.email ?? null,
      name: peer?.email ?? (row.name || truncateAddress(row.publicKey)),
      handle: row.handle,
      address: row.publicKey,
      lastSentAt: row.updatedAt?.getTime() ?? null,
    });
  }

  // Then the on-chain counterparties: they only add addresses (or bump the
  // recency of an existing contact).
  for (const row of transferRows) {
    if (!row.publicKey) continue;
    const at = row.at === null ? null : Number(row.at) * 1000;
    const existing = merged.get(row.publicKey);

    if (existing) {
      if (at !== null && at > (existing.lastSentAt ?? 0)) existing.lastSentAt = at;
      continue;
    }

    const peer = peerByAddress.get(row.publicKey);
    merged.set(row.publicKey, {
      id: `t-${row.id}`,
      email: peer?.email ?? null,
      name: peer?.email ?? peer?.name ?? truncateAddress(row.publicKey),
      handle: peer?.handle ?? row.publicKey,
      address: row.publicKey,
      lastSentAt: at,
    });
  }

  return [...merged.values()]
    .sort((a, b) => (b.lastSentAt ?? 0) - (a.lastSentAt ?? 0))
    .slice(0, limit);
}

/**
 * Record a transfer recipient for `userId`.
 *
 * If the address belongs to a registered ReWallet user, the contact picks up
 * that user's email through `contactUserId`. Re-sending to the same address
 * bumps `updatedAt` so it floats back to the top of the recent list.
 */
export async function upsertContactByPubkey(
  userId: number,
  publicKey: string,
  nameHint?: string
): Promise<RecentRecipient | null> {
  const address = publicKey.trim();
  if (!address) return null;

  const [peer] = await db
    .select({ id: usersTable.id, handle: usersTable.handle, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.publicKey, address))
    .limit(1);

  const [existing] = await db
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(and(eq(contactsTable.userId, userId), eq(contactsTable.publicKey, address)))
    .limit(1);

  const handle = peer?.handle ?? address;
  const name = nameHint?.trim() || peer?.name || truncateAddress(address);

  if (existing) {
    await db
      .update(contactsTable)
      .set({
        contactUserId: peer?.id ?? null,
        handle,
        name,
        updatedAt: new Date(),
      })
      .where(eq(contactsTable.id, existing.id));
  } else {
    await db.insert(contactsTable).values({
      userId,
      contactUserId: peer?.id ?? null,
      handle,
      name,
      publicKey: address,
    });
  }

  const [saved] = await db
    .select({ id: contactsTable.id, updatedAt: contactsTable.updatedAt })
    .from(contactsTable)
    .where(and(eq(contactsTable.userId, userId), eq(contactsTable.publicKey, address)))
    .limit(1);

  if (!saved) return null;
  return {
    id: `c-${saved.id}`,
    email: peer?.email ?? null,
    name: peer?.email ?? name,
    handle,
    address,
    lastSentAt: saved.updatedAt?.getTime() ?? null,
  };
}

export interface WalletSnapshot {
  user: WalletUserProfile;
  balance: number;
  transactions: UiTransaction[];
  contacts: UiContact[];
}

export async function getWalletSnapshot(): Promise<WalletSnapshot | null> {
  const user = await getPrimaryUser();
  if (!user) return null;

  const [transactions, contacts] = await Promise.all([
    listTransactions(user.id),
    listContacts(user.id),
  ]);

  return {
    user,
    balance: user.balanceUsdc,
    transactions,
    contacts,
  };
}

export async function listNotifications(userId: number, limit = 20) {
  return db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);
}

export async function countUnreadNotifications(userId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.isRead, false)
      )
    );
  return row?.count ?? 0;
}

export interface NotificationInput {
  /** `payment_received` | `transfer_sent` | `transfer_failed` | ... */
  type: string;
  title: string;
  message: string;
  /** On-chain signature the notification is about — the dedupe key. */
  signature: string;
  dataJson?: Record<string, unknown> | null;
}

/**
 * Insert one notification unless the same `(user, type, signature)` already
 * exists. Deliveries are deduped on `messageId`, but a redelivery variant can
 * carry a fresh id for the same movement — this keeps one banner per movement.
 */
export async function insertNotification(userId: number, input: NotificationInput) {
  const [existing] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.type, input.type),
        sql`json_extract(${notificationsTable.dataJson}, '$.signature') = ${input.signature}`
      )
    )
    .limit(1);
  if (existing) return null;

  const [row] = await db
    .insert(notificationsTable)
    .values({
      userId,
      type: input.type,
      title: input.title,
      message: input.message,
      dataJson: { signature: input.signature, ...(input.dataJson ?? {}) },
    })
    .returning();
  return row ?? null;
}

/**
 * Mark notifications read: the given ids, or every unread one when `ids` is
 * omitted. Returns the remaining unread count so the caller can update the
 * bell badge from the same round trip.
 */
export async function markNotificationsRead(
  userId: number,
  ids?: number[]
): Promise<number> {
  const scope =
    ids && ids.length > 0
      ? and(eq(notificationsTable.userId, userId), inArray(notificationsTable.id, ids))
      : eq(notificationsTable.userId, userId);

  await db
    .update(notificationsTable)
    .set({ isRead: true, readAt: new Date() })
    .where(scope);

  return countUnreadNotifications(userId);
}

export async function setUserLanguage(userId: number, language: string) {
  await db
    .update(usersTable)
    .set({ language, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
}
