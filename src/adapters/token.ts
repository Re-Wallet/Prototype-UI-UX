/**
 * Token adapter — Associated Token Accounts and recipient validation.
 *
 * Wallets do not hold tokens. Each wallet has a token account (ATA) per mint,
 * derived deterministically from `(owner, tokenProgram, mint)`.
 *
 * The derivation is implemented here against the standard PDA rules using
 * `@solana/kit` primitives, rather than through `@solana-program/token`. That
 * keeps the dependency surface to a single SDK package and avoids the version
 * conflicts the token program clients currently carry.
 *
 * Seeds (in order): owner, tokenProgram, mint — under the Associated Token
 * Account program.
 *
 * Docs:
 * - https://solana.com/docs/payments/how-payments-work#token-accounts
 * - https://solana.com/docs/payments/send-payments/verify-address
 */

import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  isAddress,
  type Address as KitAddress,
} from '@solana/kit';

import type { Address, TokenAsset, TokenProgram } from '../contracts/payments';
import { PaymentError } from '../contracts/payments';
import { amountFromBase, programIdFor } from '../contracts/tokens';

import { rpc } from './solana-client';

// ============================================================================
// CONSTANTS
// ============================================================================

/** The Associated Token Account program, which owns every ATA. */
export const ASSOCIATED_TOKEN_PROGRAM_ID =
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address;

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// ============================================================================
// ATA DERIVATION
// ============================================================================

/**
 * Derive the Associated Token Account for an owner and asset.
 *
 * Derives with the program that actually owns the mint: using the wrong one
 * yields a different, unusable address.
 */
export async function deriveAta(owner: Address, asset: TokenAsset): Promise<Address> {
  // Use KitAddress for @solana/kit internal operations
  const ownerKit = owner as unknown as KitAddress;
  const mintKit = asset.mint as unknown as KitAddress;
  if (!isAddress(owner)) {
    throw new PaymentError('invalid-address', `Invalid owner address: ${owner}`);
  }
  if (!isAddress(asset.mint)) {
    throw new PaymentError('invalid-address', `Invalid mint: ${asset.mint}`);
  }

  const encoder = getAddressEncoder();

  try {
    const programId = programIdFor(asset.program) as unknown as KitAddress;
    const [pda] = await getProgramDerivedAddress({
      programAddress: ASSOCIATED_TOKEN_PROGRAM_ID as unknown as KitAddress,
      seeds: [
        encoder.encode(address(ownerKit)),
        encoder.encode(address(programId)),
        encoder.encode(address(mintKit)),
      ],
    });

    return pda as unknown as Address;
  } catch (error) {
    throw new PaymentError('invalid-address', `Could not derive token account: ${(error as Error).message}`);
  }
}

// ============================================================================
// BALANCES
// ============================================================================

export interface TokenBalance {
  owner: Address;
  ata: Address;
  asset: TokenAsset;
  /** Raw base units. Zero when the account does not exist yet. */
  base: bigint;
  /** Human-readable value. */
  ui: number;
  /** Whether the token account exists on chain. */
  exists: boolean;
}

/**
 * Read a wallet's balance for an asset.
 *
 * A missing token account is not an error: it means the wallet has never held
 * this token. Reported as zero with `exists: false`.
 */
export async function getTokenBalance(
  owner: Address,
  asset: TokenAsset
): Promise<TokenBalance> {
  const ata = await deriveAta(owner, asset);

  try {
    const result = await rpc().getTokenAccountBalance(ata as never).send();
    const base = BigInt(result.value.amount);

    return {
      owner,
      ata,
      asset,
      base,
      ui: result.value.uiAmount ?? amountFromBase(base, asset).ui,
      exists: true,
    };
  } catch {
    return { owner, ata, asset, base: 0n, ui: 0, exists: false };
  }
}

/** Read balances for several assets at once. */
export async function getTokenBalances(
  owner: Address,
  assets: TokenAsset[]
): Promise<TokenBalance[]> {
  return Promise.all(assets.map((asset) => getTokenBalance(owner, asset)));
}

/** Whether the wallet already has a token account for this asset. */
export async function hasTokenAccount(owner: Address, asset: TokenAsset): Promise<boolean> {
  const balance = await getTokenBalance(owner, asset);
  return balance.exists;
}

/** Rent-exempt minimum for a standard 165-byte token account, in lamports. */
export async function tokenAccountRentLamports(): Promise<bigint> {
  const result = await rpc().getMinimumBalanceForRentExemption(165n).send();
  return BigInt(result);
}

// ============================================================================
// ACCOUNT CLASSIFICATION
// ============================================================================

/**
 * How a recipient should be treated before sending.
 *
 * Mirrors the decision tree in the verify-address guide:
 * https://solana.com/docs/payments/send-payments/verify-address
 *
 * Native SOL is only safe to send to a wallet. A System Program transfer
 * succeeds into any account, so sending SOL to a token account or a mint locks
 * the funds — only the owning program can move lamports out.
 */
export type AddressClass =
  | { kind: 'wallet'; exists: boolean }
  | { kind: 'token-account'; mint: Address | null; tokenProgram: TokenProgram | null }
  | { kind: 'needs-verification'; reason: string }
  | { kind: 'rejected'; reason: string };

/** Fetch an address and classify it. */
export async function classifyAddress(addr: Address): Promise<AddressClass> {
  if (!isAddress(addr)) {
    return { kind: 'rejected', reason: 'Not a valid base58 address' };
  }

  const info = await rpc().getAccountInfo(addr as never, { encoding: 'jsonParsed' }).send();

  if (!info.value) {
    // Unfunded but on-curve: a valid wallet that has not been used yet.
    return { kind: 'wallet', exists: false };
  }

  const owner = String(info.value.owner);

  if (owner === SYSTEM_PROGRAM_ID) {
    return { kind: 'wallet', exists: true };
  }

  if (owner === TOKEN_PROGRAM_ID || owner === TOKEN_2022_PROGRAM_ID) {
    const tokenProgram: TokenProgram =
      owner === TOKEN_2022_PROGRAM_ID ? 'token-2022' : 'spl-token';

    const data = info.value.data as { parsed?: { info?: { mint?: string } } };
    const mint = data.parsed?.info?.mint ?? null;

    if (!mint) {
      // Owned by a token program but carrying no mint: it is a mint account,
      // which cannot receive tokens.
      return { kind: 'rejected', reason: 'This is a mint account, not a recipient' };
    }

    return { kind: 'token-account', mint: mint as Address, tokenProgram };
  }

  return {
    kind: 'needs-verification',
    reason: 'Address belongs to a program; confirm the recipient controls it',
  };
}

export interface RecipientCheck {
  ok: boolean;
  classified: AddressClass;
  canReceive: boolean;
  reason: string | null;
}

/**
 * Verify a recipient before sending.
 *
 * SPL token transfers are partly self-protecting: the token program rejects a
 * mismatch between the two accounts, so a wrong mint fails safely. We check up
 * front anyway so the user sees a clear message instead of a failed
 * transaction.
 */
export async function verifyRecipient(
  recipient: Address,
  asset: TokenAsset | null
): Promise<RecipientCheck> {
  const classified = await classifyAddress(recipient);

  if (classified.kind === 'rejected') {
    return { ok: false, classified, canReceive: false, reason: classified.reason };
  }

  if (classified.kind === 'needs-verification') {
    return { ok: false, classified, canReceive: false, reason: classified.reason };
  }

  // Native SOL has no mint guard. Only a wallet is a safe destination.
  if (!asset) {
    const ok = classified.kind === 'wallet';
    return {
      ok,
      classified,
      canReceive: ok,
      reason: ok ? null : 'Native SOL can only be sent to a wallet address',
    };
  }

  if (classified.kind === 'token-account' && classified.mint && classified.mint !== asset.mint) {
    return {
      ok: false,
      classified,
      canReceive: false,
      reason: `Recipient's token account holds a different mint (${classified.mint})`,
    };
  }

  return { ok: true, classified, canReceive: true, reason: null };
}
