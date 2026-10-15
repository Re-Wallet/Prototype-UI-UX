/**
 * Devnet helpers for the prototype.
 *
 * Everything here is read-only or cosmetic: no private keys, no signing,
 * no transaction submission. Balances shown are simulated by the prototype
 * repository so the UI can be exercised without funding a wallet.
 */

export type SolanaCluster = 'devnet' | 'testnet' | 'mainnet-beta';

export const DEVNET: SolanaCluster = 'devnet';

export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const DEVNET_RPC_WS = 'wss://api.devnet.solana.com';

// Devnet USDC mint (Circle's devnet deployment). Mainnet is
// EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.
export const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export const USDC_DECIMALS = 6;
export const SOL_DECIMALS = 9;

/** Fake but well-formed devnet addresses used by the seed data. */
export const SEED_ADDRESSES = {
  cataSoto: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  benjaMunoz: '5YNmS1R9nNSCDzb5a7mZJ1dhF9hBkQx8vZ4wqL3tY2zM',
  coniRojas: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  sebaFuentes: 'So11111111111111111111111111111111111111112',
  vale: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
} as const;

export function getSolanaCluster(): SolanaCluster {
  const raw = (import.meta.env?.VITE_SOLANA_CLUSTER as string | undefined)?.trim();
  if (raw === 'mainnet-beta' || raw === 'testnet' || raw === 'devnet') return raw;
  return DEVNET;
}

export function getUsdcMint(cluster: SolanaCluster = getSolanaCluster()): string {
  return cluster === 'mainnet-beta' ? MAINNET_USDC_MINT : DEVNET_USDC_MINT;
}

/** Explorer link for a signature (devnet-aware). */
export function explorerTxUrl(
  signature: string,
  cluster: SolanaCluster = getSolanaCluster()
): string {
  const suffix = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `https://solscan.io/tx/${signature}${suffix}`;
}

/** Explorer link for an account (devnet-aware). */
export function explorerAddressUrl(
  address: string,
  cluster: SolanaCluster = getSolanaCluster()
): string {
  const suffix = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `https://solscan.io/account/${address}${suffix}`;
}

/** Convert a human USDC amount to base units (6 decimals). */
export function toUsdcBaseUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
}

/** Convert base units back to a human USDC amount. */
export function fromUsdcBaseUnits(baseUnits: bigint | number): number {
  return Number(baseUnits) / 10 ** USDC_DECIMALS;
}

/** Generate a prototype reference id, e.g. MOZ-4815162. */
export function generateReferenceId(prefix = 'MOZ'): string {
  const n = Math.floor(1000000 + Math.random() * 9000000);
  return `${prefix}-${n}`;
}

/** Placeholder devnet signature for seeded demo transactions. */
export function fakeDevnetSignature(seed: string): string {
  const alphabet =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let out = '';
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  for (let i = 0; i < 87; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    out += alphabet[h % alphabet.length];
  }
  return out + 'x';
}
