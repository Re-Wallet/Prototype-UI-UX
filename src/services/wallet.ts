/**
 * Wallet service layer.
 *
 * Maps persisted SQLite wallet records to the API domain types.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

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
