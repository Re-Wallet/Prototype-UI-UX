/**
 * Payment verification adapter — proving that money actually moved.
 *
 * The payments documentation is blunt about this: never trust a client that
 * says "payment complete", and never fulfil on a `processed` transaction.
 * Everything here reads the chain and returns evidence.
 *
 * Strategies, cheapest first:
 * 1. `getTokenAccountBalance` — a single balance read.
 * 2. `accountNotifications` — a WebSocket subscription on a token account.
 * 3. `getSignaturesForAddress` + `getTransaction` — history, used to locate a
 *    specific reference and extract memo and amount.
 *
 * Docs:
 * - https://solana.com/docs/payments/accept-payments/verification-tools
 * - https://solana.com/docs/payments/accept-payments/indexing
 */

import { address } from '@solana/kit';

import type {
  Address,
  PaymentReceipt,
  Reference,
  Signature,
  TokenAmount,
  VerifyPaymentRequest,
  VerifyPaymentResult,
  WatchPaymentEvent,
  WatchPaymentOptions,
} from '../contracts/payments';
import { PaymentError } from '../contracts/payments';
import { amountFromBase } from '../contracts/tokens';

import { rpc, rpcSubscriptions } from './solana-client';
import { deriveAta, getTokenBalance } from './token';
import type { TokenAsset } from '../contracts/payments';

// ============================================================================
// COMMITMENT
// ============================================================================

export type Commitment = 'processed' | 'confirmed' | 'finalized';

/** Ordering used to decide whether an observed status is good enough. */
const COMMITMENT_RANK: Record<Commitment, number> = {
  processed: 0,
  confirmed: 1,
  finalized: 2,
};

/**
 * Whether an observed status satisfies the required one.
 *
 * `confirmed` is the right default: it arrives in 1-2 seconds and is safe for
 * ordinary flows. `finalized` costs ~13 seconds and is for high-value money.
 */
export function meetsCommitment(observed: Commitment, required: Commitment): boolean {
  return COMMITMENT_RANK[observed] >= COMMITMENT_RANK[required];
}

/** Summarise an RPC confirmation status as our own commitment level. */
export function normaliseCommitment(
  status: string | null | undefined
): Commitment | null {
  if (status === 'processed' || status === 'confirmed' || status === 'finalized') {
    return status;
  }
  return null;
}

// ============================================================================
// TRANSACTION INSPECTION
// ============================================================================

/**
 * Shape of a `getTransaction` result, limited to the fields we read.
 * Declared locally so the adapter does not depend on the SDK's deep types.
 */
interface ParsedTokenBalanceEntry {
  accountIndex: number;
  mint?: string | null;
  owner?: string | null;
  uiTokenAmount?: { amount?: string | null; decimals?: number; uiAmount?: number | null };
}

interface ParsedTransactionResult {
  slot?: number | bigint | null;
  meta?: {
    err?: unknown;
    blockTime?: number | bigint | null;
    confirmationStatus?: string | null;
    preTokenBalances?: ParsedTokenBalanceEntry[];
    postTokenBalances?: ParsedTokenBalanceEntry[];
  } | null;
  transaction?: {
    message?: { instructions?: Array<Record<string, unknown>> };
  };
}

interface ParsedTransfer {
  signature: Signature;
  slot: number | null;
  commitment: Commitment | null;
  /** Net change to the watched account, in base units. Positive = received. */
  delta: bigint;
  mint: Address | null;
  counterparty: Address | null;
  memo: string | null;
  blockTime: number | null;
  error: boolean;
}

/** Extract memo strings from a transaction's parsed instructions. */
function extractMemo(tx: {
  transaction?: { message?: { instructions?: Array<Record<string, unknown>> } };
}): string | null {
  const instructions = tx.transaction?.message?.instructions ?? [];
  const parts: string[] = [];

  for (const instruction of instructions) {
    const program = String(instruction.program ?? '');
    if (program !== 'spl-memo') continue;
    const parsed = instruction.parsed;
    if (typeof parsed === 'string') parts.push(parsed);
  }

  return parts.length > 0 ? parts.join('; ') : null;
}

/**
 * Inspect a transaction to find how a watched token account changed.
 *
 * Uses pre/post token balances, which is the approach the docs recommend for
 * simple flows. It yields the net change rather than per-instruction detail,
 * which is enough to confirm a single payment.
 */
async function inspectTransaction(
  signature: string,
  watchedAta: Address,
  asset: TokenAsset
): Promise<ParsedTransfer | null> {
  const tx = (await rpc()
    .getTransaction(signature as never, {
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 0,
    })
    .send()) as ParsedTransactionResult | null;

  if (!tx) return null;

  const meta = tx.meta;
  const pre = meta?.preTokenBalances ?? [];
  const post = meta?.postTokenBalances ?? [];

  const findForAta = (
    entries: ParsedTokenBalanceEntry[]
  ): { amount: bigint; mint: string | null } | null => {
    const entry = entries.find((b) => String(b.owner) === String(watchedAta));
    if (!entry) return null;
    return {
      amount: BigInt(entry.uiTokenAmount?.amount ?? '0'),
      mint: entry.mint ? String(entry.mint) : null,
    };
  };

  const before = findForAta(pre);
  const after = findForAta(post);

  if (!before && !after) return null;

  const delta = (after?.amount ?? 0n) - (before?.amount ?? 0n);
  if (delta === 0n) return null;

  const mint = (after?.mint ?? before?.mint ?? asset.mint) as Address;

  // The counterparty is whichever other account moved in the opposite
  // direction by the same amount.
  const opposite = delta > 0n ? pre : post;
  const expected = delta > 0n ? -delta : -delta;
  let counterparty: Address | null = null;

  for (const entry of opposite) {
    const entryPost = post.find((p) => p.accountIndex === entry.accountIndex);
    const entryPre = pre.find((p) => p.accountIndex === entry.accountIndex);
    const entryDelta =
      BigInt(entryPost?.uiTokenAmount?.amount ?? '0') -
      BigInt(entryPre?.uiTokenAmount?.amount ?? '0');
    if (entryDelta === expected) {
      counterparty = (entryPost?.owner ?? entryPre?.owner ?? null) as Address | null;
      if (counterparty) break;
    }
  }

  return {
    signature: signature as Signature,
    slot: tx.slot != null ? Number(tx.slot) || null : null,
    commitment: normaliseCommitment(meta?.confirmationStatus),
    delta,
    mint,
    counterparty,
    memo: extractMemo(tx as never),
    blockTime: meta?.blockTime ? Number(meta.blockTime) : null,
    error: Boolean(meta?.err),
  };
}

// ============================================================================
// REFERENCE LOOKUP
// ============================================================================

export interface ReferenceHit {
  signature: Signature;
  slot: number | null;
  blockTime: number | null;
  error: boolean;
}

/**
 * Find transactions that mention a reference.
 *
 * The reference is a throwaway address the payer includes in the transaction,
 * so `getSignaturesForAddress` on it returns exactly the payments for that
 * intent — no scanning and no heuristics.
 */
export async function findReferenceTransactions(
  reference: Reference,
  options: { limit?: number; before?: string } = {}
): Promise<ReferenceHit[]> {
  const { limit = 10, before } = options;

  try {
    const signatures = await rpc()
      .getSignaturesForAddress(reference as never, {
        limit,
        ...(before ? { before: before as never } : {}),
      })
      .send();

    return signatures.map((entry) => ({
      signature: String(entry.signature) as Signature,
      slot: typeof entry.slot === 'number' ? entry.slot : Number(entry.slot ?? 0) || null,
      blockTime: entry.blockTime ? Number(entry.blockTime) : null,
      error: Boolean(entry.err),
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// VERIFICATION
// ============================================================================

/**
 * Verify a payment against the chain.
 *
 * Checks, in order:
 * 1. A transaction mentioning the reference exists.
 * 2. It did not fail.
 * 3. It reached the required commitment level.
 * 4. The amount matches what the intent promised.
 * 5. The mint matches the asset we expected.
 * 6. It has not been counted before (guarded by the caller's store).
 */
export async function verifyPayment(
  request: VerifyPaymentRequest,
  asset: TokenAsset,
  recipient: Address
): Promise<VerifyPaymentResult> {
  const required = request.requireCommitment ?? 'confirmed';

  const hits = await findReferenceTransactions(request.reference, { limit: 5 });
  const successful = hits.filter((hit) => !hit.error);

  if (successful.length === 0) {
    return {
      ok: false,
      status: 'pending',
      reason: hits.length > 0
        ? 'Transaction found but it failed on chain'
        : 'No transaction found for this reference yet',
    };
  }

  const ata = await deriveAta(recipient, asset);

  for (const hit of successful) {
    const parsed = await inspectTransaction(hit.signature, ata, asset);
    if (!parsed) continue;

    const commitment = parsed.commitment ?? 'processed';
    if (!meetsCommitment(commitment, required)) {
      return {
        ok: false,
        status: commitment,
        reason: `Transaction is ${commitment}; required at least ${required}`,
      };
    }

    // Anyone can create a token with the ticker "USDC", so compare the mint.
    if (parsed.mint && parsed.mint !== asset.mint) {
      throw new PaymentError('mint-mismatch', 'Payment used an unexpected mint', {
        expected: asset.mint,
        observed: parsed.mint,
      });
    }

    if (parsed.delta <= 0n) {
      // The watched account lost funds in this transaction: it is not a credit.
      continue;
    }

    const amount: TokenAmount = amountFromBase(parsed.delta, asset);

    if (request.expectedAmount && parsed.delta < request.expectedAmount.base) {
      return {
        ok: false,
        status: commitment,
        reason: `Underpaid: expected ${request.expectedAmount.base} base units, received ${parsed.delta}`,
      };
    }

    const receipt: PaymentReceipt = {
      intentId: null,
      reference: request.reference,
      signature: parsed.signature,
      status: commitment as PaymentReceipt['status'],
      direction: 'incoming',
      amount,
      counterparty: (parsed.counterparty ?? ('11111111111111111111111111111111' as Address)) as Address,
      memo: parsed.memo,
      slot: parsed.slot,
      verifiedAt: new Date().toISOString(),
    };

    return { ok: true, receipt };
  }

  return {
    ok: false,
    status: 'pending',
    reason: 'Reference found but no matching credit to the recipient account',
  };
}

// ============================================================================
// STREAMING
// ============================================================================

/**
 * Watch an account for incoming transfers.
 *
 * Subscribes to `accountNotifications` on the token account and emits an event
 * whenever the balance increases. This is the recommended low-latency path for
 * a single account; high-volume systems want an indexer instead.
 */
export function watchTokenAccount(
  owner: Address,
  asset: TokenAsset,
  onEvent: (event: WatchPaymentEvent, signatureHint?: Signature) => void,
  options: WatchPaymentOptions = {}
): () => void {
  const { commitment = 'confirmed', timeoutMs, signal } = options;

  const controller = new AbortController();
  let cancelled = false;
  let previous: bigint | null = null;

  const abort = () => {
    if (!cancelled) {
      cancelled = true;
      controller.abort();
    }
  };

  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs && timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      onEvent({ kind: 'timeout', reference: '' as Reference });
      abort();
    }, timeoutMs);
  }

  void (async () => {
    try {
      const ata = await deriveAta(owner, asset);

      // Seed with the current balance so the first notification is a delta.
      const initial = await getTokenBalance(owner, asset);
      previous = initial.base;

      const subscription = await rpcSubscriptions()
        .accountNotifications(ata as never, { commitment, encoding: 'base64' })
        .subscribe({ abortSignal: controller.signal });

      for await (const notification of subscription as AsyncIterable<{
        context?: { slot?: number };
        value?: { data?: [string, string] };
      }>) {
        if (cancelled) break;

        const base64 = notification.value?.data?.[0];
        if (!base64) continue;

        const decoded = decodeTokenAmount(base64);
        if (decoded === null) continue;

        const current = decoded;
        const last = previous ?? 0n;
        previous = current;

        if (current <= last) continue;

        const slot = notification.context?.slot ?? 0;
        onEvent({
          kind: 'observed',
          reference: '' as Reference,
          signature: '' as Signature,
          slot,
        });

        const delta = current - last;
        onEvent({
          kind: 'settled',
          receipt: {
            intentId: null,
            reference: '' as Reference,
            signature: '' as Signature,
            status: commitment,
            direction: 'incoming',
            amount: amountFromBase(delta, asset),
            counterparty: owner,
            memo: null,
            slot,
            verifiedAt: new Date().toISOString(),
          },
        });
      }
    } catch (error) {
      if (!cancelled) {
        onEvent({
          kind: 'error',
          reference: '' as Reference,
          message: (error as Error).message,
        });
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  })();

  return abort;
}

/**
 * Decode the amount field out of a base64 token account.
 *
 * An SPL token account is a fixed-layout buffer: mint (32) + owner (32) +
 * amount as a little-endian u64 at offset 64.
 */
function decodeTokenAmount(base64: string): bigint | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    if (bytes.length < 72) return null;

    let amount = 0n;
    for (let i = 7; i >= 0; i -= 1) {
      amount = (amount << 8n) | BigInt(bytes[64 + i]);
    }
    return amount;
  } catch {
    return null;
  }
}

// ============================================================================
// TRANSACTION STATUS
// ============================================================================

/** Look up the confirmation status of a signature. */
export async function getTransactionStatus(
  signature: string
): Promise<{ commitment: Commitment | null; error: boolean; slot: number | null }> {
  try {
    const result = await rpc().getSignatureStatuses([signature as never]).send();
    const entry = result.value[0];

    if (!entry) return { commitment: null, error: false, slot: null };

    return {
      commitment: normaliseCommitment(String(entry.confirmationStatus ?? '')),
      error: Boolean(entry.err),
      slot: typeof entry.slot === 'number' ? entry.slot : null,
    };
  } catch {
    return { commitment: null, error: false, slot: null };
  }
}

/** True when the signature has already been observed and recorded. */
export interface ProcessedLedger {
  has(signature: string): Promise<boolean>;
  add(signature: string, reference: string): Promise<void>;
}

/**
 * In-memory ledger for the prototype.
 *
 * Prevents double-fulfilment within a session. Production must persist this:
 * webhooks retry, and the docs call out double-fulfilment as a real failure
 * mode. See the `processed_signatures` table in the database schema.
 */
export function createInMemoryLedger(): ProcessedLedger {
  const seen = new Set<string>();
  return {
    async has(signature: string) {
      return seen.has(signature);
    },
    async add(signature: string) {
      seen.add(signature);
    },
  };
}
