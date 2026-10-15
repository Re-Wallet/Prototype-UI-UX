/**
 * Payment contracts — pure types, zero SDK imports.
 *
 * This module is the boundary between the UI and Solana. Screens, hooks and
 * components import from here; they never import `@solana/*` directly. The
 * adapters in `src/adapters/` are the only place that knows about the SDK.
 *
 * Design rules:
 * - Amounts are always expressed as base units (bigint) alongside the mint's
 *   decimals, never as an ambiguous float. Use `TokenAmount` for this.
 * - A payment is described by an intent before it exists on chain, and by a
 *   receipt after it settles. These are separate types on purpose: an intent is
 *   not evidence of payment.
 * - Nothing here assumes devnet, mainnet, or a particular wallet provider.
 */

// ============================================================================
// IDENTIFIERS
// ============================================================================

/**
 * A base58-encoded Solana address (wallet, token mint, or program).
 * Branded so it cannot be confused with an arbitrary string.
 */
export type Address = string & { readonly __brand: 'SolanaAddress' };

/** A base58-encoded transaction signature. */
export type Signature = string & { readonly __brand: 'SolanaSignature' };

/** A base58-encoded payment reference, used to track a specific payment. */
export type Reference = string & { readonly __brand: 'SolanaReference' };

// ============================================================================
// AMOUNTS
// ============================================================================

/**
 * A token amount with its decimals made explicit.
 *
 * `base` is the raw on-chain integer (e.g. 25000000n for 25 USDC at 6 decimals).
 * `ui` is the human-readable float, for display only — never for arithmetic
 * that produces more base units.
 */
export interface TokenAmount {
  /** Raw amount in the mint's base units. This is the source of truth. */
  base: bigint;
  /** Number of decimals the mint uses (USDC = 6, SOL = 9). */
  decimals: number;
  /** Display value derived from `base`. Never round-trip this back to `base`. */
  ui: number;
}

// ============================================================================
// PAYMENT LIFECYCLE
// ============================================================================

/**
 * Payment status aligned with Solana's commitment levels.
 *
 * `processed` is explicitly modelled because the docs warn against acting on
 * it: a processed transaction can still be dropped during a fork.
 */
export type PaymentStatus =
  | 'draft'        // intent created, not yet shared or signed
  | 'pending'      // shared/signed, not yet observed on chain
  | 'processed'    // seen by the cluster, NOT safe to fulfil
  | 'confirmed'    // 1-2s, safe for most flows
  | 'finalized'    // ~13s, safe for high-value flows
  | 'failed'       // transaction landed with an error
  | 'expired'      // not observed within the expected window
  | 'cancelled';   // abandoned before signing

/** Direction of a payment from the perspective of the current user. */
export type PaymentDirection = 'incoming' | 'outgoing';

// ============================================================================
// INTENT — what we want to happen
// ============================================================================

/** How the payer is expected to settle the intent. */
export type PaymentRail =
  | 'solana-pay-qr'      // scanned QR, settles via transfer request
  | 'solana-pay-link'    // shared link
  | 'p2p-handle'         // @handle resolution
  | 'internal-transfer'; // move between ReWallet balances

export interface PaymentIntent {
  /** Local identifier, generated before any chain interaction. */
  id: string;
  /** Who receives the funds. Always a wallet address, never a token account. */
  recipient: Address;
  /** Which asset moves. */
  asset: TokenAsset;
  /** How much moves. `null` means the payer chooses the amount. */
  amount: TokenAmount | null;
  /** Why this payment exists (shown to the payer). */
  concept: string;
  /** Optional counterparty label for reconciliation (e.g. client name). */
  payerLabel?: string;
  /** On-chain note attached to the transaction, if the rail supports it. */
  memo?: string;
  /** Tracking reference. Unique per intent; the key we watch on chain. */
  reference: Reference;
  /** Transport for this intent. */
  rail: PaymentRail;
  /** Current lifecycle state. */
  status: PaymentStatus;
  /** ISO 8601 creation time. */
  createdAt: string;
  /** ISO 8601 expiry, or `null` for intents that never expire. */
  expiresAt: string | null;
}

// ============================================================================
// RECEIPT — evidence that something happened
// ============================================================================

/**
 * Server-verified proof that a payment settled. Never construct this from
 * client input: it must come from `payment-verify` after reading the chain.
 */
export interface PaymentReceipt {
  /** Local intent this receipt fulfils, when known. */
  intentId: string | null;
  /** Reference that was watched. */
  reference: Reference;
  /** Transaction signature. */
  signature: Signature;
  /** Observed commitment level at the time of verification. */
  status: Extract<PaymentStatus, 'processed' | 'confirmed' | 'finalized'>;
  /** Direction relative to the current user. */
  direction: PaymentDirection;
  /** Actual amount credited or debited. */
  amount: TokenAmount;
  /** Address funds moved from (for incoming) or to (for outgoing). */
  counterparty: Address;
  /** Memo extracted from the transaction, when present. */
  memo: string | null;
  /** Slot the transaction landed in, when available. */
  slot: number | null;
  /** ISO 8601 time the receipt was produced by our verifier. */
  verifiedAt: string;
}

// ============================================================================
// REQUESTS — instructions to the adapter layer
// ============================================================================

export interface CreateIntentRequest {
  recipient: Address;
  asset: TokenAsset;
  amount: TokenAmount | null;
  concept: string;
  payerLabel?: string;
  memo?: string;
  rail: PaymentRail;
  /** Minutes until the intent expires. `null` for no expiry. */
  expiresInMinutes?: number | null;
}

export interface VerifyPaymentRequest {
  reference: Reference;
  /** Amount the intent promised. Used to detect underpayment. */
  expectedAmount?: TokenAmount;
  /** Wallet that should have received the funds. */
  expectedRecipient?: Address;
  /** Commitment level to require before returning a receipt. */
  requireCommitment?: 'processed' | 'confirmed' | 'finalized';
}

/** Result of a verification attempt. */
export type VerifyPaymentResult =
  | { ok: true; receipt: PaymentReceipt }
  | { ok: false; status: PaymentStatus; reason: string };

// ============================================================================
// WATCHERS — real-time observation
// ============================================================================

export interface WatchPaymentOptions {
  /** Commitment level to resolve at. Defaults to `confirmed`. */
  commitment?: 'processed' | 'confirmed' | 'finalized';
  /** Abort the subscription. */
  signal?: AbortSignal;
  /** Stop watching after N milliseconds. */
  timeoutMs?: number;
}

export type WatchPaymentEvent =
  | { kind: 'observed'; reference: Reference; signature: Signature; slot: number }
  | { kind: 'settled'; receipt: PaymentReceipt }
  | { kind: 'timeout'; reference: Reference }
  | { kind: 'error'; reference: Reference; message: string };

// ============================================================================
// TOKEN REFERENCES (asset descriptor used by intents)
// ============================================================================

/**
 * Which token program owns a mint. Deriving an ATA with the wrong program
 * produces an unrelated address, so this must always travel with the mint.
 */
export type TokenProgram = 'spl-token' | 'token-2022';

/** An asset the wallet can move. */
export interface TokenAsset {
  /** Ticker for display. Never used for validation. */
  symbol: string;
  /** Mint address. This is what must be validated, not the symbol. */
  mint: Address;
  /** Program that owns the mint. */
  program: TokenProgram;
  /** Decimals for base-unit conversion. */
  decimals: number;
}

// ============================================================================
// ERRORS
// ============================================================================

export type PaymentErrorCode =
  | 'invalid-address'
  | 'unsupported-mint'
  | 'mint-mismatch'
  | 'insufficient-balance'
  | 'account-not-found'
  | 'expired-intent'
  | 'already-processed'
  | 'rpc-unavailable'
  | 'unsupported-network';

export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: PaymentErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.details = details;
  }
}
