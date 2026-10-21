/**
 * Server-side check that a transaction signature was sent by a given wallet.
 *
 * Why this exists: the client posts a "pending transfer" right after signing,
 * so the movement shows up in the history before the webhook lands. That
 * endpoint would otherwise accept any signature for any wallet and write a
 * row into someone else's ledger.
 *
 * The proof is the fee payer: in a Solana transaction the first account key
 * is the fee payer, which is the account that signed it. Verified against a
 * real ReWallet transfer, where `accountKeys[0]` is the sender's wallet and
 * the recipient does not appear among the keys at all.
 *
 * A transaction that is not visible yet is reported as `unknown` rather than
 * `not-owned`: the signature may simply be too fresh. The caller decides how
 * to treat that, and the webhook projection still lands the real movement
 * either way.
 */

import { rpc } from '../adapters/solana-client';
import { noteRateLimit, pacedRpc } from './rpcThrottle';

export type SignatureOwnership = 'owned' | 'not-owned' | 'unknown';

interface ParsedTx {
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey?: string }>;
    };
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The fee payer of a transaction, or null when the RPC cannot see it yet.
 */
export async function getSignatureFeePayer(signature: string): Promise<string | null> {
  try {
    const tx = (await pacedRpc(() =>
      rpc()
        .getTransaction(signature as never, {
          encoding: 'jsonParsed',
          maxSupportedTransactionVersion: 0,
        })
        .send() as Promise<ParsedTx | null>
    )) as ParsedTx | null;

    const first = tx?.transaction?.message?.accountKeys?.[0];
    if (!first) return null;
    return typeof first === 'string' ? first : first.pubkey ?? null;
  } catch (error) {
    // A rate-limited or unreachable RPC must not throw: this lookup is
    // best-effort, and an unhandled rejection would take the whole API down.
    if ((error as { context?: { statusCode?: number } })?.context?.statusCode === 429) {
      noteRateLimit();
    }
    return null;
  }
}

/**
 * Decide whether `signature` was sent by `wallet`.
 *
 * The transaction may not be visible immediately after signing, so the lookup
 * is retried a few times before giving up.
 */
export async function verifySignatureOwnership(
  signature: string,
  wallet: string,
  attempts = 3,
  delayMs = 400
): Promise<SignatureOwnership> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const payer = await getSignatureFeePayer(signature);
    if (payer) return payer === wallet ? 'owned' : 'not-owned';
    if (attempt < attempts - 1) await sleep(delayMs);
  }
  return 'unknown';
}
