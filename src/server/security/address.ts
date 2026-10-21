/**
 * A base58 Solana address: 32-44 characters, no 0 O I l.
 *
 * It lives here because three modules need the same rule, and three copies
 * of a security check are three chances to drift apart.
 */
export const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Is `value` a base58 Solana address? */
export function isBase58Address(value: unknown): value is string {
  return typeof value === 'string' && BASE58_RE.test(value);
}
