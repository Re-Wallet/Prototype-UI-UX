import { randomBytes } from 'node:crypto';
import { and, desc, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { paymentLinks, users } from '../db/schema';
import { generateReference } from '../adapters/solana-pay';
import { cacheKey, invalidate, invalidatePrefix } from './readCache';

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
  /** Signature of the transaction that settled this link. */
  paidTxSignature: string | null;
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
  paidTxSignature: string | null;
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
    paidTxSignature: row.paidTxSignature,
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

  // The cached link list no longer matches the table.
  invalidate(cacheKey.paymentLinks(userId));

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
 * Atomically settle a payment link.
 *
 * The `status IN ('active','partial')` predicate lives inside the UPDATE, so
 * two concurrent settles cannot both win: the loser's UPDATE matches zero
 * rows and this returns null. Returns the freshly-settled row, or null when
 * the link was already settled or does not exist.
 */
export async function trySettlePaymentLink(
  reference: string,
  settlement: {
    paidAmountUsdc: number;
    paidByPubkey: string;
    paidTxId: number | null;
    paidTxSignature?: string | null;
  }
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
      paidTxSignature: settlement.paidTxSignature ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(paymentLinks.referencePubkey, reference),
        sql`${paymentLinks.status} IN ('active', 'partial')`,
        // One signature settles exactly one link.
        //
        // The claim path and the webhook path both write the signature, so
        // without this a single transfer could credit two links: the payer
        // opens two payment pages, signs once, and claims both.
        // The table name is a static identifier, so it is safe to inline;
        // Drizzle's `alias()` renders only the alias in a raw template, which
        // would produce `FROM "other"` with no table behind it.
        sql`NOT EXISTS (
          SELECT 1 FROM ${sql.raw('payment_links AS other')}
          WHERE other.paid_tx_signature = ${settlement.paidTxSignature ?? null}
            AND other.reference_pubkey <> ${reference}
        )`
      )
    )
    .returning();

  if (!row) return null;

  const settled = toPaymentLink(row);
  // The cached link list still shows this link as active. Invalidating here
  // covers every path that settles a link (the webhook ingestor included).
  invalidate(cacheKey.paymentLinks(settled.userId));
  return settled;
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
 * Drizzle selection for Neon Realtime: every `payment_links` column aliased
 * under its Drizzle JS key. Mirrors `aliasAllTransactions` — the Realtime
 * client parses `timestamptz` and `jsonb` with the default parsers, so the
 * aliased row shape matches `PaymentLink` exactly.
 *
 * The concrete key set is load-bearing: a bare index signature would erase
 * the row shape, and the sealed capability could no longer be cast to
 * `PaymentLink`.
 */
function aliasAllPaymentLinks() {
  return Object.fromEntries(
    Object.entries(getTableColumns(paymentLinks)).map(([key, column]) => [
      key,
      sql`${column}`.as(key),
    ])
  ) as unknown as Record<keyof PaymentLinkRow, SQL>;
}

/**
 * Live-query twin of {@link listPaymentLinks}: same filter, order and limit,
 * expressed as a Neon Realtime query. This is what lets the collector's
 * screen learn that a link was paid without polling or refetching.
 */
export function livePaymentLinksQuery(userId: number, limit = 20) {
  return db
    .select(aliasAllPaymentLinks())
    .from(paymentLinks)
    .where(eq(paymentLinks.userId, userId))
    .orderBy(desc(paymentLinks.createdAt))
    .limit(limit);
}

/**
 * Expire links whose `expiresAt` has passed. Called by the sweeper.
 */
export async function expireStalePaymentLinks(): Promise<number> {
  const expired = await db.execute(sql`
    UPDATE payment_links SET status = 'expired', updated_at = now()
     WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now()
    RETURNING id
  `);
  // The sweep spans every user, so the whole family of link lists is stale.
  if (expired.rows.length > 0) invalidatePrefix('payment-links:');
  return expired.rows.length;
}

/**
 * Try to settle a payment link after an observed on-chain transfer.
 *
 * Matches active links owned by `recipient` whose fixed amount equals the
 * transferred USDC amount (open-amount links match any amount). Marks the
 * first match as paid and returns it.
 *
 * Candidate selection is scoped to the recipient IN SQL. Filtering by owner
 * after the fact is not equivalent: a global scan for "the oldest active link
 * with this amount" can land on another user's link, and the owner check then
 * abandons the real one — leaving it `active` and therefore payable a second
 * time. Fixed-amount links are preferred over open-amount ones, and among
 * equals the oldest wins.
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
  // Idempotency: this transfer may already have settled a link, claimed by
  // the payer. One signature settles exactly one link — without this check
  // the webhook would look for "some active link of this amount" and could
  // settle a DIFFERENT one, crediting a second, wrong link.
  const [claimed] = await db
    .select()
    .from(paymentLinks)
    .where(eq(paymentLinks.paidTxSignature, params.transactionHash))
    .limit(1);
  if (claimed) return toPaymentLink(claimed);

  const candidates = await db
    .select({ referencePubkey: paymentLinks.referencePubkey })
    .from(paymentLinks)
    .innerJoin(users, eq(users.id, paymentLinks.userId))
    .where(
      and(
        eq(paymentLinks.status, 'active'),
        eq(users.publicKey, params.recipient),
        // Match fixed-amount links exactly, open-amount links always.
        sql`(${paymentLinks.amountUsdc} = ${params.amountUsdc} OR ${paymentLinks.amountUsdc} IS NULL)`
      )
    )
    // Exact-amount links first (amount_usdc IS NULL sorts last), then NEWEST.
    //
    // Newest first, not oldest: a payment corresponds to the charge that was
    // shared most recently. Picking the oldest would settle a stale request
    // and leave the one actually shared still payable.
    .orderBy(sql`${paymentLinks.amountUsdc} IS NULL`, desc(paymentLinks.createdAt));

  // Settle the first matching link. The UPDATE is atomic, so when two
  // payments for the same amount land at once the loser moves on to the next
  // candidate instead of double-crediting the first one.
  for (const candidate of candidates) {
    const settled = await trySettlePaymentLink(candidate.referencePubkey, {
      paidAmountUsdc: params.amountUsdc,
      paidByPubkey: params.payerPubkey,
      paidTxId: null, // Will be linked via transaction upsert
      paidTxSignature: params.transactionHash,
    });
    if (settled) return settled;
  }

  return null;
}

/**
 * Settle a link the payer declared by reference.
 *
 * The reference does not travel on-chain, so the webhook can only guess
 * which link a transfer pays (by recipient and amount) — and it guesses
 * wrong whenever the same recipient has two active links of the same amount.
 * The payer, on the other hand, knows exactly which link it opened: it is
 * the reference in the URL.
 *
 * The caller MUST have verified on-chain that the transaction moved the
 * link's amount to its recipient before calling this. The settlement itself
 * is the same atomic UPDATE the webhook path uses, so a link can only be
 * settled once.
 */
export async function claimPaymentLinkByReference(
  reference: string,
  settlement: {
    paidAmountUsdc: number;
    paidByPubkey: string;
    paidTxId: number | null;
    paidTxSignature: string;
  }
): Promise<PaymentLink | null> {
  const settled = await trySettlePaymentLink(reference, settlement);
  if (!settled) return null;
  return settled;
}

/**
 * The wallet that receives a link's payments: the link's owner.
 *
 * A payment link is always created for the wallet of its owner, so the
 * owner's public key IS the link's recipient.
 */
export async function getPaymentLinkRecipient(reference: string): Promise<string | null> {
  const [row] = await db
    .select({ publicKey: users.publicKey })
    .from(paymentLinks)
    .innerJoin(users, eq(users.id, paymentLinks.userId))
    .where(eq(paymentLinks.referencePubkey, reference))
    .limit(1);
  return row?.publicKey ?? null;
}
