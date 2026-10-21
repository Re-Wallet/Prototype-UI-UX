/**
 * Wallet service layer.
 *
 * Maps persisted wallet records to the API domain types.
 */

import { and, desc, eq, getTableColumns, inArray, isNotNull, ne, sql, type SQL } from 'drizzle-orm';

import { db } from '../db';
import {
  contacts as contactsTable,
  notifications as notificationsTable,
  transactions as transactionsTable,
  users as usersTable,
} from '../db/schema';
import type {
  User as DbUser,
  Contact as DbContact,
  Notification as DbNotification,
  Transaction as DbTransaction,
} from '../db/schema';

import type { Contact as UiContact, Transaction as UiTransaction } from '../types/wallet';

import { mapTransaction, mapLiveTransactionRow, type LiveTransactionRow } from './transactionMapper';
import { getBalances, invalidateBalances } from './balanceCache';
import { cacheKey, invalidate } from './readCache';

// ============================================================================
// DOMAIN MAPPERS
// ============================================================================

// Transaction row mapping lives in './transactionMapper': it is shared with
// the browser (Neon Realtime live rows) and must stay dependency-free here.

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
 * Resolve a wallet profile by its Solana public key.
 *
 * Used to scope per-session data (contacts, recent recipients) to the wallet
 * the user authenticated with.
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
  // The peer's registered email is LEFT JOINed instead of resolved in a
  // second query: a counterparty outside ReWallet simply has no row, and the
  // UI falls back to the address. This is the same selection the Realtime
  // live query uses, so both paths share one mapper.
  //
  // The extra round-trip this removes cost a full network RTT, which is the
  // dominant term in this endpoint's latency.
  const rows = await db
    .select({
      ...selectAllTransactions(),
      counterpartyEmail: sql`${usersTable.email}`.as('counterpartyEmail'),
    })
    .from(transactionsTable)
    .leftJoin(usersTable, eq(usersTable.publicKey, transactionsTable.counterpartyPubkey))
    .where(eq(transactionsTable.userId, userId))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limit);

  // The aliased columns are typed as `unknown` by Drizzle, but the selection
  // provably returns `LiveTransactionRow`-shaped rows: camelCase result
  // names, and the default parsers revive `timestamptz` and `jsonb`. This is
  // the same assertion the Realtime path makes.
  return rows.map((row) => mapLiveTransactionRow(row as unknown as LiveTransactionRow));
}

/**
 * Drizzle selection for Neon Realtime: every `transactions` column aliased
 * to its Drizzle JS key.
 *
 * `@neon/realtime-drizzle` asserts that each selected key equals the
 * PostgreSQL result name (the proxy returns DB result names, not Drizzle's
 * client-side mapping), and this schema maps camelCase keys onto snake_case
 * columns — so each column needs an explicit `AS <key>` alias. Aliased rows
 * then match `Transaction` ($inferSelect) and the shared mapper runs as-is.
 */
function aliasAllTransactions() {
  return Object.fromEntries(
    Object.entries(getTableColumns(transactionsTable)).map(([key, column]) => [
      key,
      sql`${column}`.as(key),
    ])
  ) as unknown as Record<keyof DbTransaction, SQL>;
}

/**
 * Selection for the REST path: the real column objects, so Drizzle knows
 * each column's data type.
 *
 * This matters more than it looks. Drizzle's node-postgres driver disables
 * node-postgres' own TIMESTAMPTZ parser and converts timestamps itself, using
 * the type metadata of the SELECT. An aliased `sql` fragment has an `unknown`
 * type, so the conversion is skipped and the raw string reaches the mapper —
 * `date.getTime()` then throws. Real columns keep the conversion; the aliased
 * variant above is only for the Realtime path, where the proxy already sends
 * parsed values.
 */
function selectAllTransactions() {
  return getTableColumns(transactionsTable);
}

/**
 * Live-query twin of {@link listTransactions}: same filter, order, limit and
 * peer-email resolution, but as one joinable Drizzle select that can be
 * sealed and subscribed through the Realtime WebSocket. Every insert or
 * update to `transactions` matching the query reaches the UI without a
 * refetch.
 */
export function liveTransactionsQuery(userId: number, limit = 50) {
  return db
    .select({
      ...aliasAllTransactions(),
      counterpartyEmail: sql`${usersTable.email}`.as('counterpartyEmail'),
    })
    .from(transactionsTable)
    .leftJoin(usersTable, eq(usersTable.publicKey, transactionsTable.counterpartyPubkey))
    .where(eq(transactionsTable.userId, userId))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limit);
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
 * The upsert is the single funnel every movement passes through — webhook
 * projections and RPC sweeps alike — so it is also where the balance cache is
 * invalidated. The chain stays the source of truth for the amount; the DB only
 * signals *when* it changed. Passing `walletPubkey` lets that invalidation
 * target the right cache entry without an extra lookup; omit it when the
 * caller only has the numeric id and the balance is not cached by pubkey.
 *
 * Idempotent on `(user_id, reference_id)`, so re-running the backfill or a
 * webhook re-projecting a transaction the sweeper already stored updates the
 * row instead of duplicating it. This is deliberately a different concern from
 * the delivery-level dedupe in `webhook_events`.
 */
export async function upsertTransactions(
  userId: number,
  movements: PersistedMovement[],
  walletPubkey?: string
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
          // The chain projection is authoritative for the movement's NATURE.
          // A row inserted optimistically by the client (or injected by
          // anyone who can reach the endpoint) could claim `sent` for what
          // the chain shows as an incoming deposit; the webhook corrects it.
          type: values.type,
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
          // jsonb merge (||) instead of SQLite's json_patch: shallow-merges the
          // enrichment payload, which is flat, so parity with RFC 7396 depth
          // does not matter here.
          metadataJson: sql`COALESCE(${transactionsTable.metadataJson}, '{}'::jsonb) || ${JSON.stringify(values.metadataJson ?? {})}::jsonb`,
          updatedAt: values.updatedAt,
        },
      });
  }

  // A movement landed: the cached balance for this wallet is now provably
  // stale. Drop it so the next read goes to the chain. This is the one place
  // that covers both the webhook and the sweeper — no caller can forget it.
  if (walletPubkey) invalidateBalances(walletPubkey);

  // The same movement can reorder the address book (it is one of the sources
  // `listRecentRecipients` merges). Drop that cache too, from the same single
  // place, so no write path can forget it.
  invalidate(cacheKey.contacts(userId));
  invalidate(cacheKey.transactions(userId));
  invalidate(cacheKey.notifications(userId));

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

  // A new outgoing movement changes the address book (it is one of the
  // sources `listRecentRecipients` merges), so the cached book is stale.
  invalidate(cacheKey.contacts(userId));
  invalidate(cacheKey.transactions(userId));
  invalidate(cacheKey.notifications(userId));

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

  // The peer's display fields are LEFT JOINed into both sources instead of
  // being resolved in a third query. The two source queries still run in
  // parallel, so the whole read costs two round-trips instead of three.
  const peerEmail = sql<string | null>`${usersTable.email}`;
  const peerHandle = sql<string | null>`${usersTable.handle}`;
  const peerName = sql<string | null>`${usersTable.name}`;

  const [contactRows, transferRows] = await Promise.all([
    db
      .select({
        id: contactsTable.id,
        handle: contactsTable.handle,
        name: contactsTable.name,
        publicKey: contactsTable.publicKey,
        updatedAt: contactsTable.updatedAt,
        peerEmail,
        peerHandle,
      })
      .from(contactsTable)
      .leftJoin(usersTable, eq(usersTable.publicKey, contactsTable.publicKey))
      .where(eq(contactsTable.userId, userId))
      .orderBy(desc(contactsTable.updatedAt))
      .limit(limit),
    db
      .select({
        id: transactionsTable.id,
        publicKey: transactionsTable.counterpartyPubkey,
        at: outgoingAt,
        peerEmail,
        peerHandle,
        peerName,
      })
      .from(transactionsTable)
      .leftJoin(usersTable, eq(usersTable.publicKey, transactionsTable.counterpartyPubkey))
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

  const merged = new Map<string, RecentRecipient>();

  // Explicit contacts first: they carry the name the user picked.
  for (const row of contactRows) {
    if (!row.publicKey) continue;
    merged.set(row.publicKey, {
      id: `c-${row.id}`,
      email: row.peerEmail ?? null,
      name: row.peerEmail ?? (row.name || truncateAddress(row.publicKey)),
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

    merged.set(row.publicKey, {
      id: `t-${row.id}`,
      email: row.peerEmail ?? null,
      name: row.peerEmail ?? row.peerName ?? truncateAddress(row.publicKey),
      handle: row.peerHandle ?? row.publicKey,
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

  // The address book changed: drop the cached copy so the next read (the
  // Transfer screen refreshes right after a send) is fresh.
  invalidate(cacheKey.contacts(userId));
  invalidate(cacheKey.transactions(userId));
  invalidate(cacheKey.notifications(userId));

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

/**
 * Snapshot of one user's wallet.
 *
 * Scoped by `userId` on purpose: an unscoped "primary user" snapshot is a
 * profile dump — name, handle, email, phone, balance, history and contacts —
 * for whoever happens to be first in the table, with no way to ask for anyone
 * else. The caller resolves the wallet to a user first.
 */
export async function getWalletSnapshot(userId: number): Promise<WalletSnapshot | null> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return null;
  const profile = mapUser(user);

  const [transactions, contacts] = await Promise.all([
    listTransactions(userId),
    listContacts(userId),
  ]);

  // The balance comes from the chain, not from `users.balance_usdc`.
  //
  // Nothing in the server ever writes that column, so it stays at its
  // default of zero, and a snapshot that says "0 USDC" for a wallet holding
  // money is worse than no snapshot at all. The chain is the only source of
  // truth for a balance — that is the same rule the ledger projection
  // follows.
  const balances = await getBalances(user.publicKey).catch(() => null);

  return {
    user: profile,
    balance: balances?.usdc ?? 0,
    transactions,
    contacts,
  };
}

/**
 * Drizzle selection for the notification feed: every `notifications` column
 * aliased under its Drizzle JS key, so the row shape matches `Notification`
 * exactly and the aliased rows can carry an extra computed column.
 */
function selectAllNotifications() {
  return getTableColumns(notificationsTable);
}

/**
 * The notification feed and the unread badge in one round-trip.
 *
 * The unread count used to be a separate `COUNT(*)` query. A window function
 * computes it over the same result set instead: `FILTER (...) OVER ()` is
 * evaluated before `LIMIT`, so the badge counts every unread notification
 * while the feed still returns only the newest `limit` rows.
 *
 * The count rides on the first row; an empty feed means zero unread.
 */
export async function listNotificationsWithUnread(
  userId: number,
  limit = 20
): Promise<{ items: DbNotification[]; unread: number }> {
  const rows = await db
    .select({
      ...selectAllNotifications(),
      unreadTotal: sql<number>`COUNT(*) FILTER (WHERE ${notificationsTable.isRead} = false) OVER ()::int`.as(
        'unreadTotal'
      ),
    })
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);

  const unread = rows.length > 0 ? Number(rows[0].unreadTotal ?? 0) : 0;
  // The helper column is an artifact of the query, not part of the feed.
  const items = rows.map(({ unreadTotal: _unreadTotal, ...row }) => row as DbNotification);
  return { items, unread };
}

export async function countUnreadNotifications(userId: number): Promise<number> {
  // `COUNT(*)` returns bigint, which node-postgres hands over as a STRING to
  // preserve precision — so the raw value would be `"8"`, not `8`, while the
  // signature promises a number. Casting to integer in SQL keeps the value
  // numeric end to end. The same applies to the window-function count below.
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
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
        sql`${notificationsTable.dataJson}->>'signature' = ${input.signature}`
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

  // The cached feed still shows the old read flags and badge count.
  invalidate(cacheKey.notifications(userId));

  return countUnreadNotifications(userId);
}

export async function setUserLanguage(userId: number, language: string) {
  await db
    .update(usersTable)
    .set({ language, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
}
