/**
 * Token registry — the assets ReWallet can move.
 *
 * Every entry carries its mint, the program that owns it, and its decimals.
 * The program matters: deriving an Associated Token Account with the wrong
 * program yields a different address, and a transfer sent to the wrong program
 * fails. Never derive these values from a symbol at runtime.
 *
 * Mints are taken from the Solana payments documentation:
 * https://solana.com/docs/payments/how-payments-work#stablecoins
 */

import type { Address, TokenAmount, TokenAsset, TokenProgram } from './payments';

// ============================================================================
// PROGRAM ADDRESSES
// ============================================================================

export const TOKEN_PROGRAM_ID: Address =
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address;

export const TOKEN_2022_PROGRAM_ID: Address =
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' as Address;

export function programIdFor(program: TokenProgram): Address {
  return program === 'token-2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

// ============================================================================
// MAINTS
// ============================================================================

/** Mint + program pairs per cluster. Mainnet values come from the docs. */
const MAINNET_MINTS = {
  USDC: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', program: 'spl-token' },
  USDT: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', program: 'spl-token' },
  PYUSD: { mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', program: 'token-2022' },
  USDG: { mint: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH', program: 'token-2022' },
} as const satisfies Record<string, { mint: string; program: TokenProgram }>;

/**
 * Devnet mints. Circle publishes a devnet USDC; PYUSD and USDG are also
 * available from the Paxos faucet. Tokens without a devnet deployment are
 * marked so callers can reject them before attempting a transfer.
 */
const DEVNET_MINTS = {
  USDC: { mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', program: 'spl-token' },
} as const satisfies Record<string, { mint: string; program: TokenProgram }>;

export type SupportedSymbol = keyof typeof MAINNET_MINTS;

const DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  PYUSD: 6,
  USDG: 6,
};

// ============================================================================
// REGISTRY
// ============================================================================

export type SupportedCluster = 'devnet' | 'mainnet-beta';

/** Assets available on a given cluster. */
export function supportedAssets(cluster: SupportedCluster): TokenAsset[] {
  if (cluster === 'devnet') {
    return Object.entries(DEVNET_MINTS).map(([symbol, cfg]) => ({
      symbol,
      mint: cfg.mint as Address,
      program: cfg.program,
      decimals: DECIMALS[symbol] ?? 6,
    }));
  }

  return Object.entries(MAINNET_MINTS).map(([symbol, cfg]) => ({
    symbol,
    mint: cfg.mint as Address,
    program: cfg.program,
    decimals: DECIMALS[symbol] ?? 6,
  }));
}

/** Look up an asset by symbol on a cluster. Returns null when unsupported. */
export function assetBySymbol(
  symbol: string,
  cluster: SupportedCluster
): TokenAsset | null {
  return supportedAssets(cluster).find((a) => a.symbol === symbol) ?? null;
}

/**
 * Look up an asset by mint. Validation must always go through the mint, not
 * the symbol: anyone can create a token called "USDC".
 */
export function assetByMint(
  mint: string,
  cluster: SupportedCluster
): TokenAsset | null {
  return supportedAssets(cluster).find((a) => a.mint === mint) ?? null;
}

/** True when the mint is one we recognise on this cluster. */
export function isSupportedMint(mint: string, cluster: SupportedCluster): boolean {
  return assetByMint(mint, cluster) !== null;
}

// ============================================================================
// AMOUNT CONVERSION
// ============================================================================

/** Convert a human amount to base units. Rounds to avoid float drift. */
export function toBaseUnits(ui: number, decimals: number): bigint {
  if (!Number.isFinite(ui) || ui < 0) {
    throw new RangeError(`Invalid amount: ${ui}`);
  }
  // Scale via string to dodge binary float rounding (0.1 * 1e6 problems).
  const [whole, fraction = ''] = ui.toFixed(decimals).split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(`${whole}${paddedFraction}`);
}

/** Convert base units back to a human amount for display only. */
export function fromBaseUnits(base: bigint, decimals: number): number {
  const divisor = 10n ** BigInt(decimals);
  const whole = base / divisor;
  const remainder = base % divisor;
  return Number(whole) + Number(remainder) / Number(divisor);
}

/** Build a `TokenAmount` from a human value. */
export function amountFromUi(ui: number, asset: TokenAsset): TokenAmount {
  return {
    base: toBaseUnits(ui, asset.decimals),
    decimals: asset.decimals,
    ui,
  };
}

/** Build a `TokenAmount` from raw base units. */
export function amountFromBase(base: bigint, asset: TokenAsset): TokenAmount {
  return {
    base,
    decimals: asset.decimals,
    ui: fromBaseUnits(base, asset.decimals),
  };
}
