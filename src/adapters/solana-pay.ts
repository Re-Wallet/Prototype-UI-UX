/**
 * Solana Pay adapter — URL encoding per the specification.
 *
 * Implements the transfer-request and transaction-request URL formats directly
 * from the spec rather than through a wrapper library:
 *
 *   https://docs.solanapay.com/spec
 *
 * Why hand-rolled: the spec is a frozen contract, while the available SDK
 * (`@solana-commerce/solana-pay`) is in beta and pins an older Solana Kit
 * generation, which conflicted with the rest of the dependency tree. Encoding
 * a URL is pure string work and does not justify that coupling.
 *
 * Spec rules that are easy to get wrong, and are enforced here:
 *
 * - `recipient` must be the wallet public key. Associated token accounts must
 *   not be used; the wallet derives the ATA itself.
 * - `amount` is in *user* units (USDC, not base units). For tokens this is
 *   `uiAmountString`, not the raw integer. Scientific notation is forbidden and
 *   a fractional value below 1 needs a leading zero.
 * - Amounts with more decimals than the mint supports make the URL malformed.
 * - `reference` may appear multiple times and does not need to exist on chain.
 *   Validators index transactions by it, which is what makes it usable as a
 *   client-side payment id.
 * - `label`, `message` and `memo` are URL-encoded UTF-8.
 */

import { getBase58Decoder, isAddress } from '@solana/kit';

import type {
  Address,
  PaymentIntent,
  PaymentRail,
  Reference,
  TokenAmount,
  TokenAsset,
} from '../contracts/payments';
import { PaymentError } from '../contracts/payments';

import { network } from './solana-client';

// ============================================================================
// CONSTANTS
// ============================================================================

/** URL scheme that wallets register to handle. */
export const SOLANA_PAY_SCHEME = 'solana:';

/** Max decimals per asset, used to reject amounts the wallet would refuse. */
const SOL_DECIMALS = 9;

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Structural base58 check.
 *
 * Deliberately not a full byte-array decode: the spec only requires that the
 * value be a base58-encoded 32-byte key, and the wallet performs the real
 * validation. We reject obvious mistakes early so the user gets a clear error
 * instead of a wallet that silently refuses to scan.
 */
export function isBase58(value: string): boolean {
  return typeof value === 'string' && isAddress(value);
}

function assertBase58(value: string, field: string): void {
  if (!isBase58(value)) {
    throw new PaymentError('invalid-address', `Invalid ${field}: not base58`, {
      field,
      value,
    });
  }
}

/**
 * Format an amount the way the spec requires.
 *
 * The spec is explicit: a non-negative integer or decimal in user units, no
 * scientific notation, and a leading zero for values below 1. We format from
 * base units to avoid float drift.
 */
export function formatSpecAmount(amount: TokenAmount, decimals: number): string {
  if (
    amount.base < 0n ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > SOL_DECIMALS ||
    amount.decimals !== decimals
  ) {
    throw new PaymentError('invalid-amount', 'Invalid amount or token decimals', {
      base: amount.base.toString(),
      amountDecimals: amount.decimals,
      decimals,
    });
  }

  const divisor = 10n ** BigInt(decimals);
  const whole = amount.base / divisor;
  const fraction = (amount.base % divisor)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '');

  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Number of decimals an asset supports on chain. */
function decimalsFor(asset: TokenAsset | null): number {
  return asset ? asset.decimals : SOL_DECIMALS;
}

// ============================================================================
// TRANSFER REQUEST
// ============================================================================

export interface TransferRequestInput {
  /** Wallet that receives funds. Must not be a token account. */
  recipient: Address;
  /** Amount in base units. `null` omits it so the payer chooses. */
  amount: TokenAmount | null;
  /** Asset requested. `null` means native SOL. */
  asset: TokenAsset | null;
  /** One or more tracking references. */
  reference?: Reference | Reference[];
  /** Who is asking for the payment. */
  label?: string;
  /** What the payment is for. */
  message?: string;
  /** On-chain memo, recorded by validators. */
  memo?: string;
}

/**
 * Encode a transfer request URL.
 *
 * Format:
 *   solana:<recipient>?amount=<>&spl-token=<>&reference=<>&label=<>&message=<>&memo=<>
 */
export function encodeTransferRequest(input: TransferRequestInput): URL {
  assertBase58(input.recipient, 'recipient');

  if (input.asset) {
    assertBase58(input.asset.mint, 'spl-token');
  }

  const references = input.reference
    ? Array.isArray(input.reference)
      ? input.reference
      : [input.reference]
    : [];

  for (const ref of references) {
    assertBase58(ref, 'reference');
  }

  // Built by hand: `URL` cannot represent the `solana:` name without a host,
  // and would normalise the pathname we need to keep verbatim.
  const params = new URLSearchParams();

  if (input.amount) {
    const formatted = formatSpecAmount(input.amount, decimalsFor(input.asset));
    params.set('amount', formatted);
  }

  if (input.asset) {
    params.set('spl-token', input.asset.mint);
  }

  // The spec allows the key to repeat; append rather than set.
  for (const ref of references) {
    params.append('reference', ref);
  }

  if (input.label) params.set('label', input.label);
  if (input.message) params.set('message', input.message);
  if (input.memo) params.set('memo', input.memo);

  const query = params.toString();
  const raw = `${SOLANA_PAY_SCHEME}${input.recipient}${query ? `?${query}` : ''}`;

  return new URL(raw);
}

/** Encode a transfer request from a stored intent. */
export function encodeIntent(intent: PaymentIntent): URL {
  return encodeTransferRequest({
    recipient: intent.recipient,
    amount: intent.amount,
    asset: intent.asset,
    reference: intent.reference,
    message: intent.concept,
    memo: intent.memo,
  });
}

// ============================================================================
// TRANSACTION REQUEST
// ============================================================================

export interface TransactionRequestInput {
  /** Absolute HTTPS endpoint the wallet will call. */
  link: string;
  label?: string;
  message?: string;
}

/**
 * Encode a transaction request URL.
 *
 * Format: `solana:<link>`
 *
 * The spec requires the link to be URL-encoded only when it carries query
 * parameters; encoding a clean URL produces a denser QR for no benefit.
 */
export function encodeTransactionRequest(input: TransactionRequestInput): URL {
  let parsed: URL;
  try {
    parsed = new URL(input.link);
  } catch {
    throw new PaymentError('invalid-address', `Malformed link: ${input.link}`);
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new PaymentError('invalid-address', 'Transaction request links must use HTTPS without embedded credentials');
  }

  const hasQuery = parsed.search.length > 1;
  const target = hasQuery ? encodeURIComponent(parsed.toString()) : parsed.toString();

  const params = new URLSearchParams();
  if (input.label) params.set('label', input.label);
  if (input.message) params.set('message', input.message);

  const query = params.toString();
  const raw = `${SOLANA_PAY_SCHEME}${target}${query ? `?${query}` : ''}`;

  return new URL(raw);
}

// ============================================================================
// QR CODES
// ============================================================================

export interface QrOptions {
  /** Edge length in pixels. */
  size?: number;
  /** Foreground colour. Keep it dark for scanner reliability. */
  color?: string;
  /** Background colour. Keep it light; inverted codes often fail. */
  background?: string;
}

const DEFAULT_QR: Required<QrOptions> = {
  size: 320,
  color: '#0a0a0b',
  background: '#ffffff',
};

/** Render a payment URL as an SVG string. */
export async function renderQrSvg(url: string | URL, options: QrOptions = {}): Promise<string> {
  // The QR encoder is loaded on demand. It is only needed when a QR is
  // actually rendered, and the API server never renders one: importing it
  // eagerly put a font-parsing library in the server's startup path, which
  // is CPU the server does not need to spend.
  const { default: QRCode } = await import('qrcode');
  const { size, color, background } = { ...DEFAULT_QR, ...options };
  return QRCode.toString(url.toString(), {
    type: 'svg',
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: color, light: background },
  });
}

/** Render a payment URL as a PNG data URL, ready for an `<img src>`. */
export async function renderQrDataUrl(
  url: string | URL,
  options: QrOptions = {}
): Promise<string> {
  const { default: QRCode } = await import('qrcode');
  const { size, color, background } = { ...DEFAULT_QR, ...options };
  return QRCode.toDataURL(url.toString(), {
    type: 'image/png',
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: color, light: background },
  });
}

/** Build the request URL and both QR renderings in one call. */
export async function createPaymentRequest(
  input: TransferRequestInput,
  qrOptions?: QrOptions
): Promise<{ url: string; qrSvg: string; qrDataUrl: string }> {
  const url = encodeTransferRequest(input);
  const [qrSvg, qrDataUrl] = await Promise.all([
    renderQrSvg(url, qrOptions),
    renderQrDataUrl(url, qrOptions),
  ]);

  return { url: url.toString(), qrSvg, qrDataUrl };
}

// ============================================================================
// PARSING
// ============================================================================

export interface ParsedTransferRequest {
  kind: 'transfer';
  recipient: Address;
  /** Raw amount string as it appeared, or null when the payer chooses. */
  amount: string | null;
  /** Amount converted for display, when present and parseable. */
  amountUi: number | null;
  splToken: Address | null;
  references: Reference[];
  label: string | null;
  message: string | null;
  memo: string | null;
  /** Raw URL, for debugging and for re-display. */
  raw: string;
}

export interface ParsedTransactionRequest {
  kind: 'transaction';
  link: string;
  label: string | null;
  message: string | null;
  raw: string;
}

export type ParsedPaymentRequest = ParsedTransferRequest | ParsedTransactionRequest;

/** Read a boolean-free param once. */
function first(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value === null || value === '' ? null : value;
}

/**
 * Parse a scanned `solana:` URL or a bare payment link.
 *
 * Returns `null` when the input is not a Solana Pay URL, so callers can fall
 * back to treating it as a plain address.
 */
export function parsePaymentRequest(input: string): ParsedPaymentRequest | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith(SOLANA_PAY_SCHEME)) return null;

  const rest = trimmed.slice(SOLANA_PAY_SCHEME.length);
  if (!rest) return null;

  const questionMark = rest.indexOf('?');
  const pathname = questionMark === -1 ? rest : rest.slice(0, questionMark);
  const query = questionMark === -1 ? '' : rest.slice(questionMark + 1);
  const params = new URLSearchParams(query);

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  // A link (transaction request) starts with a scheme once decoded.
  if (decodedPath.startsWith('https://') || decodedPath.startsWith('http://')) {
    if (!decodedPath.startsWith('https://') || params.getAll('label').length > 1 || params.getAll('message').length > 1) {
      return null;
    }
    try {
      const transactionUrl = new URL(decodedPath);
      if (transactionUrl.protocol !== 'https:' || transactionUrl.username || transactionUrl.password) {
        return null;
      }
    } catch {
      return null;
    }
    return {
      kind: 'transaction',
      link: decodedPath,
      label: first(params, 'label'),
      message: first(params, 'message'),
      raw: trimmed,
    };
  }

  const singleValueParams = ['amount', 'spl-token', 'label', 'message', 'memo'];
  if (singleValueParams.some((key) => params.getAll(key).length > 1)) return null;
  if (singleValueParams.some((key) => params.has(key) && params.get(key) === '')) return null;
  if (!isBase58(pathname)) return null;

  const amountRaw = first(params, 'amount');
  let amountUi: number | null = null;
  if (amountRaw !== null) {
    if (!/^\d+(?:\.\d{1,9})?$/.test(amountRaw)) return null;
    const parsed = Number(amountRaw);
    if (!Number.isFinite(parsed)) return null;
    amountUi = parsed;
  }

  const splToken = first(params, 'spl-token');
  if (splToken !== null && !isBase58(splToken)) return null;
  const references = params.getAll('reference');
  if (references.some((reference) => !isBase58(reference))) return null;

  return {
    kind: 'transfer',
    recipient: pathname as Address,
    amount: amountRaw,
    amountUi,
    splToken: (splToken as Address | null) ?? null,
    references: references as Reference[],
    label: first(params, 'label'),
    message: first(params, 'message'),
    memo: first(params, 'memo'),
    raw: trimmed,
  };
}

// ============================================================================
// REFERENCES
// ============================================================================

/**
 * Generate a reference for a new payment.
 *
 * A reference is a 32-byte value the wallet includes as a read-only, non-signer
 * account key. It need not exist on chain — validators index transactions by
 * account key, which is what lets `getSignaturesForAddress` find the payment
 * later using an id we chose up front.
 */
export function generateReference(): Reference {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return getBase58Decoder().decode(bytes) as Reference;
}

/** True when the value looks like a valid reference. */
export function isReference(value: string): boolean {
  return isBase58(value);
}

// ============================================================================
// RAILS
// ============================================================================

export const SUPPORTED_RAILS: PaymentRail[] = ['solana-pay-qr', 'solana-pay-link'];

export function supportsRail(rail: PaymentRail): boolean {
  return SUPPORTED_RAILS.includes(rail);
}

/** Human-readable cluster label for the payment screen. */
export function describeNetwork(): string {
  return network().cluster === 'mainnet-beta' ? 'Solana mainnet' : 'Solana devnet';
}
