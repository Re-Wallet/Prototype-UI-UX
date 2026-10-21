/**
 * The charges waiting to be paid, painted in the activity list.
 *
 * A charge is a `payment_links` row: the merchant asked for money and is
 * waiting. It is NOT a movement — no money moved yet — so it never reaches
 * the `transactions` table, the balance or the ledger.
 *
 * The list, however, has to show it: a person can generate a charge and
 * share it now, and the payer may pay minutes or hours later. Without the
 * row, the charge disappears the moment the QR screen is closed, and the
 * merchant has no way of knowing that it is still open.
 *
 * So the row is synthesized in the client, from the same link rows the
 * Realtime bridge delivers: it appears as soon as the charge is created and
 * disappears the moment the webhook settles it, in real time.
 */

import { formatTimestamp } from './transactionMapper';
import type { PaymentLinkDto } from './walletApi';
import type { Transaction } from '../types/wallet';

/**
 * Whether a charge is still waiting to be paid.
 *
 * An expired charge is not pending: nobody can pay it anymore, so showing
 * it as "awaiting payment" would be a lie.
 */
export function isPendingCharge(link: PaymentLinkDto, now: number = Date.now()): boolean {
  if (link.status !== 'active') return false;
  if (link.expiresAt && Date.parse(link.expiresAt) <= now) return false;
  return true;
}

/**
 * The pending charges of a wallet, as rows for the activity list.
 *
 * The id is prefixed so a synthetic row can never collide with a real
 * movement, and the `pendingCharge` marker tells the list that this row has
 * no signature: it is a request, not a transaction.
 */
export function toPendingChargeTransactions(
  links: PaymentLinkDto[],
  now: number = Date.now()
): Transaction[] {
  return links
    .filter((link) => isPendingCharge(link, now))
    .map((link) => {
      const createdAt = new Date(link.createdAt);
      const amount = link.amountUsdc ?? 0;

      return {
        id: `link-${link.id}`,
        title: link.concept,
        type: 'received',
        status: 'in_progress',
        amount,
        assetSymbol: 'USDC',
        fiatAmount: amount,
        fiatCurrency: 'USD',
        timestamp: formatTimestamp(createdAt),
        date: createdAt,
        note: link.concept,
        pendingCharge: {
          id: link.id,
          reference: link.referencePubkey,
          slug: link.slug,
        },
      } satisfies Transaction;
    });
}
