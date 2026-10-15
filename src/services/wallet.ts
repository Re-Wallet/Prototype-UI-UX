/**
 * Wallet service layer.
 *
 * Owns all business logic for the prototype: it maps database rows to the
 * UI-facing domain types in src/types/wallet.ts so screens never import
 * Drizzle directly.
 *
 * Phase 1 (current): reads from SQLite, writes back to SQLite.
 * Phase 2 (devnet): swap the local write paths for Solana Pay calls.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '../db';
import {
  contacts as contactsTable,
  notifications as notificationsTable,
  paymentLinks as paymentLinksTable,
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

export function mapTransaction(row: DbTransaction): UiTransaction {
  return {
    id: `tx-${row.id}`,
    title: row.counterpartyHandle || row.method || `Transaction #${row.id}`,
    counterparty: row.counterpartyHandle ?? undefined,
    type: TYPE_TO_UI[row.type] ?? 'sent',
    status: STATUS_TO_UI[row.status] ?? 'in_progress',
    amount: row.amountUsdc,
    fiatAmount: row.fiatAmount ?? row.amountUsdc,
    fiatCurrency: row.fiatCurrency ?? 'USD',
    timestamp: formatTimestamp(row.createdAt),
    date: row.createdAt,
    method: row.method ?? undefined,
    referenceId: row.referenceId,
    note: row.note ?? undefined,
    txHash: row.solanaSignature ?? undefined,
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
 * Resolve the demo/primary user.
 *
 * Peers (counterparties) are also rows in `users`, so ordering by id alone can
 * pick the wrong wallet. Prefer the KYC-verified wallet that owns transactions
 * and payment links, falling back to the oldest row.
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

export async function getUserByHandle(handle: string): Promise<WalletUserProfile | null> {
  const normalized = handle.startsWith('@') ? handle : `@${handle}`;
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.handle, normalized))
    .limit(1);
  return rows.length > 0 ? mapUser(rows[0]) : null;
}

export async function getUserByPublicKey(publicKey: string): Promise<WalletUserProfile | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.publicKey, publicKey))
    .limit(1);
  return rows.length > 0 ? mapUser(rows[0]) : null;
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

  return rows.map(mapTransaction);
}

export async function listContacts(userId: number): Promise<UiContact[]> {
  const rows = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.userId, userId))
    .orderBy(desc(contactsTable.isFavorite), contactsTable.name);

  return rows.map(mapContact);
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

// ============================================================================
// MUTATIONS (prototype: local ledger only)
// ============================================================================

export interface RecordTransactionInput {
  userId: number;
  type: TransactionType;
  status?: TransactionStatus;
  amountUsdc: number;
  fiatAmount?: number;
  fiatCurrency?: string;
  counterpartyHandle?: string;
  counterpartyName?: string;
  counterpartyPubkey?: string;
  method?: string;
  network?: 'solana' | 'base' | 'polygon' | 'arbitrum';
  referenceId: string;
  solanaSignature?: string;
  referencePubkey?: string;
  paymentLinkId?: number;
  memo?: string;
  note?: string;
  feeUsdc?: number;
}

const UI_STATUS_TO_DB: Record<TransactionStatus, string> = {
  in_progress: 'pending',
  completed: 'completed',
  failed: 'failed',
};

export async function recordTransaction(
  input: RecordTransactionInput
): Promise<UiTransaction> {
  const [row] = await db
    .insert(transactionsTable)
    .values({
      userId: input.userId,
      type: input.type,
      status: UI_STATUS_TO_DB[input.status ?? 'completed'],
      amountUsdc: input.amountUsdc,
      fiatAmount: input.fiatAmount ?? input.amountUsdc,
      fiatCurrency: input.fiatCurrency ?? 'USD',
      counterpartyHandle: input.counterpartyHandle,
      counterpartyName: input.counterpartyName,
      counterpartyPubkey: input.counterpartyPubkey,
      method: input.method,
      network: input.network ?? 'solana',
      referenceId: input.referenceId,
      solanaSignature: input.solanaSignature,
      referencePubkey: input.referencePubkey,
      paymentLinkId: input.paymentLinkId,
      memo: input.memo,
      note: input.note,
      feeUsdc: input.feeUsdc ?? 0,
      confirmedAt: input.status === 'completed' ? new Date() : null,
    })
    .returning();

  return mapTransaction(row);
}

/**
 * Adjust the cached balance for a user. In production the balance is derived
 * from the chain; here we keep a running local figure so the prototype UI reacts.
 */
export async function adjustBalance(
  userId: number,
  deltaUsdc: number
): Promise<number> {
  await db
    .update(usersTable)
    .set({
      balanceUsdc: sql`MAX(0, ${usersTable.balanceUsdc} + ${deltaUsdc})`,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));

  const [row] = await db
    .select({ balanceUsdc: usersTable.balanceUsdc })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  return row?.balanceUsdc ?? 0;
}

export interface CreatePaymentLinkInput {
  userId: number;
  slug: string;
  referencePubkey: string;
  amountUsdc: number | null;
  concept: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
}

export async function createPaymentLink(input: CreatePaymentLinkInput) {
  const [row] = await db
    .insert(paymentLinksTable)
    .values({
      userId: input.userId,
      slug: input.slug,
      referencePubkey: input.referencePubkey,
      amountUsdc: input.amountUsdc,
      concept: input.concept,
      clientName: input.clientName,
      clientEmail: input.clientEmail,
      clientPhone: input.clientPhone,
      status: 'active',
    })
    .returning();

  return row;
}

export async function markPaymentLinkPaid(
  linkId: number,
  paidByPubkey: string,
  paidAmountUsdc: number
) {
  await db
    .update(paymentLinksTable)
    .set({
      status: 'paid',
      paidAmountUsdc,
      paidByPubkey,
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(paymentLinksTable.id, linkId));
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

export async function setUserLanguage(userId: number, language: string) {
  await db
    .update(usersTable)
    .set({ language, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
}
