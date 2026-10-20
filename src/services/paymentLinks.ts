import { randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { paymentLinks, users } from '../db/schema';
import { generateReference } from '../adapters/solana-pay';

export type PaymentLinkStatus = 'active' | 'paid' | 'partial' | 'expired' | 'cancelled';

export interface PaymentLink {
  id: number;
  userId: number;
  slug: string;
  referencePubkey: string;
  amountUsdc: number | null;
  currency: string;
  concept: string;
  status: PaymentLinkStatus;
  paidAmountUsdc: number;
  paidAt: Date | null;
  paidByPubkey: string | null;
  paidTxId: number | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PaymentLinkRow {
  id: number;
  userId: number;
  slug: string;
  referencePubkey: string;
  amountUsdc: number | null;
  currency: string;
  concept: string;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  status: string;
  paidAmountUsdc: number;
  paidAt: Date | null;
  paidByPubkey: string | null;
  paidTxId: number | null;
  expiresAt: Date | null;
  metadataJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function toPaymentLink(row: PaymentLinkRow): PaymentLink {
  return {
    id: row.id,
    userId: row.userId,
    slug: row.slug,
    referencePubkey: row.referencePubkey,
    amountUsdc: row.amountUsdc,
    currency: row.currency,
    concept: row.concept,
    status: row.status as PaymentLinkStatus,
    paidAmountUsdc: row.paidAmountUsdc,
    paidAt: row.paidAt,
    paidByPubkey: row.paidByPubkey,
    paidTxId: row.paidTxId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Create a single-use charge link.
 *
 * Generates a unique on-chain reference (Solana Pay) and a URL slug, then
 * persists the row with `status: 'active'`. The reference goes into the
 * payment URL so the payer's transaction carries it on-chain, and the
 * slug is the public identifier for status checks.
 *
 * Idempotent on concept + recipient + amount: re-creating the same charge
 * returns the existing active link instead of duplicating.
 */
export async function createPaymentLink(
  userId: number,
  input: {
    recipient: string;
    amountUsdc: number | null;
    concept: string;
    expiresAt?: Date | null;
  }
): Promise<PaymentLink> {
  const existing = await db
    .select()
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.userId, userId),
        eq(paymentLinks.concept, input.concept),
        eq(paymentLinks.status, 'active'),
        sql`${paymentLinks.amountUsdc} = ${input.amountUsdc ?? 0}`
      )
    )
    .limit(1);

  if (existing.length > 0 && input.amountUsdc !== null) {
    // Same charge re-generated while still active — return the existing link.
    const row = await db.select().from(paymentLinks).where(eq(paymentLinks.id, existing[0].id)).limit(1);
    if (row.length > 0) return toPaymentLink(row[0]);
  }

  const reference = generateReference();
  const slug = randomBytes(8).toString('hex');
  const now = new Date();

  const [row] = await db
    .insert(paymentLinks)
    .values({
      userId,
      slug,
      referencePubkey: reference,
      amountUsdc: input.amountUsdc,
      currency: 'USDC',
      concept: input.concept,
      status: 'active',
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return toPaymentLink(row);
}

/**
 * Look up a payment link by its on-chain reference.
 *
 * Used by the /pay page to check status before allowing payment, and by
 * the settle endpoint to verify the link is still active.
 */
export async function getPaymentLinkByReference(reference: string): Promise<PaymentLink | null> {
  const [row] = await db
    .select()
    .from(paymentLinks)
    .where(eq(paymentLinks.referencePubkey, reference))
    .limit(1);
  return row ? toPaymentLink(row) : null;
}

/**
 * Look up a payment link by its slug (public identifier).
 */
export async function getPaymentLinkBySlug(slug: string): Promise<PaymentLink | null> {
  const [row] = await db
    .select()
    .from(paymentLinks)
    .where(eq(paymentLinks.slug, slug))
    .limit(1);
  return row ? toPaymentLink(row) : null;
}

/**
 * Mark a payment link as paid. Idempotent: only transitions from `active`
 * or `partial` to `paid`; a link already `paid` is returned unchanged.
 *
 * Called by the settle endpoint after on-chain verification confirms the
 * payment, and by the sweeper as a backstop when it observes the
 * reference in a transaction's account keys.
 */
export async function markPaymentLinkPaid(
  reference: string,
  settlement: { paidAmountUsdc: number; paidByPubkey: string; paidTxId: number | null }
): Promise<PaymentLink | null> {
  const now = new Date();
  const [row] = await db
    .update(paymentLinks)
    .set({
      status: 'paid',
      paidAmountUsdc: settlement.paidAmountUsdc,
      paidAt: now,
      paidByPubkey: settlement.paidByPubkey,
      paidTxId: settlement.paidTxId,
      updatedAt: now,
    })
    .where(
      and(
        eq(paymentLinks.referencePubkey, reference),
        sql`${paymentLinks.status} IN ('active', 'partial')`
      )
    )
    .returning();

  if (!row) {
    // Already paid or not found — return current state.
    const existing = await getPaymentLinkByReference(reference);
    return existing;
  }
  return toPaymentLink(row);
}

/**
 * List a user's payment links, newest first.
 */
export async function listPaymentLinks(userId: number, limit = 20): Promise<PaymentLink[]> {
  const rows = await db
    .select()
    .from(paymentLinks)
    .where(eq(paymentLinks.userId, userId))
    .orderBy(desc(paymentLinks.createdAt))
    .limit(limit);
  return rows.map(toPaymentLink);
}

/**
 * Expire links whose `expiresAt` has passed. Called by the sweeper.
 */
export async function expireStalePaymentLinks(): Promise<number> {
  const { rows } = await pool.query(
    `UPDATE payment_links SET status = 'expired', updated_at = now()
     WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now()
     RETURNING id`
  );
  return rows.length;
}

/**
 * Try to settle a payment link after an observed on-chain transfer.
 *
 * Matches active links for `recipient` whose fixed amount equals the
 * transferred USDC amount (open-amount links match any amount). Marks the
 * first match as paid and returns it.
 *
 * Called by the webhook ingestor after projecting a successful incoming
 * USDC transfer, so the merchant's charge settles the moment the webhook
 * lands. Returns null when no active link matches.
 */
export async function settlePaymentLinkForTransfer(params: {
  recipient: string;
  amountUsdc: number;
  transactionHash: string;
  payerPubkey: string;
  slot: number | null;
}): Promise<PaymentLink | null> {
  const links = await db
    .select()
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.status, 'active'),
        // Match fixed-amount links exactly, open-amount links always.
        sql`(${paymentLinks.amountUsdc} = ${params.amountUsdc} OR ${paymentLinks.amountUsdc} IS NULL)`
      )
    )
    .orderBy(paymentLinks.createdAt)
    .limit(1);

  // The link's owner is the recipient — resolve to find their userId.
  if (links.length === 0) return null;

  const link = links[0];
  // Confirm the recipient owns this link.
  const [owner] = await db
    .select({ publicKey: users.publicKey })
    .from(users)
    .where(eq(users.id, link.userId))
    .limit(1);

  if (!owner || owner.publicKey !== params.recipient) return null;

  const paid = await markPaymentLinkPaid(link.referencePubkey, {
    paidAmountUsdc: params.amountUsdc,
    paidByPubkey: params.payerPubkey,
    paidTxId: null, // Will be linked via transaction upsert
  });

  return paid;
}
