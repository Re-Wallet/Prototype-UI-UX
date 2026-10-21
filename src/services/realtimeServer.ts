/**
 * Server-side Neon Realtime capability issuer.
 *
 * `seal()` encrypts a query locally — no network call — and returns a
 * short-lived bearer capability the browser presents when subscribing
 * through the Realtime WebSocket. The project secret must never reach the
 * client bundle, which is why sealing lives behind this module and a POST
 * endpoint in `server.ts`.
 *
 * dotenv loads here for the same ESM reason documented in `src/db/index.ts`:
 * imported modules evaluate before their importers' body runs.
 */

import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

import { createRealtime, type SealedLiveQuery } from '@neon/realtime/server';
import { drizzleAdapter } from '@neon/realtime-drizzle';

import { liveTransactionsQuery } from './wallet';
import type { LiveTransactionRow } from './transactionMapper';
import { livePaymentLinksQuery } from './paymentLinks';
import type { PaymentLink } from './paymentLinks';

const realtime = process.env.NEON_REALTIME_SECRET
  ? createRealtime({
      secret: process.env.NEON_REALTIME_SECRET,
      // Embedded in every capability; the first accepted subscription binds
      // its connection to this database.
      db: process.env.NEON_REALTIME_DB ?? 'neondb',
      adapter: drizzleAdapter(),
    })
  : null;

/**
 * Seal the user's transaction live query for the browser.
 *
 * Row type is asserted: Drizzle's inferred result marker does not line up
 * with the SDK's `QueryRow` extractor, but the aliased selection provably
 * returns `LiveTransactionRow`-shaped rows (camelCase result names, default
 * client parsers revive `timestamptz` and `jsonb`).
 */
export function sealLiveTransactions(
  userId: number
): Promise<SealedLiveQuery<LiveTransactionRow>> {
  if (!realtime) {
    return Promise.reject(
      new Error(
        'NEON_REALTIME_SECRET is not set. Run `neon env pull --service realtime` in the project root.'
      )
    );
  }
  return realtime.seal({ query: liveTransactionsQuery(userId) }) as Promise<
    SealedLiveQuery<LiveTransactionRow>
  >;
}

/**
 * Seal the user's payment-link live query for the browser.
 *
 * Same contract as {@link sealLiveTransactions}: the aliased selection
 * provably returns `PaymentLink`-shaped rows, so the browser mapper runs
 * without a translation layer.
 */
export function sealLivePaymentLinks(
  userId: number
): Promise<SealedLiveQuery<PaymentLink>> {
  if (!realtime) {
    return Promise.reject(
      new Error(
        'NEON_REALTIME_SECRET is not set. Run `neon env pull --service realtime` in the project root.'
      )
    );
  }
  return realtime.seal({ query: livePaymentLinksQuery(userId) }) as Promise<
    SealedLiveQuery<PaymentLink>
  >;
}
