/**
 * Adapter barrel — the single entry point for chain access.
 *
 * Two modes, selected by `VITE_USE_CHAIN`:
 *
 * - `mock` (default): no network. Balances and receipts are synthesised from
 *   local data so the whole UI works offline and in tests.
 * - `devnet`: real reads against the configured cluster. Payment URLs and QR
 *   codes are always real, since encoding is pure computation.
 *
 * UI code imports from here and never branches on the mode.
 */

import type {
  Address,
  PaymentReceipt,
  Reference,
  Signature,
  TokenAsset,
  TokenAmount,
  WatchPaymentEvent,
  WatchPaymentOptions,
} from '../contracts/payments';
import { amountFromBase, formatAmount } from '../contracts/tokens';
import {
  network,
  isDevnet,
  rpc,
  rpcSubscriptions,
  explorerTxUrl,
  explorerAddressUrl,
  resetClients,
} from './solana-client';

import {
  encodeTransferRequest,
  encodeIntent,
  encodeTransactionRequest,
  createPaymentRequest,
  parsePaymentRequest,
  renderQrDataUrl,
  renderQrSvg,
  generateReference,
  isReference,
  describeNetwork,
  supportsRail,
  SUPPORTED_RAILS,
  formatSpecAmount,
  isBase58,
  type ParsedPaymentRequest,
  type ParsedTransferRequest,
} from './solana-pay';

import {
  deriveAta,
  getTokenBalance,
  getTokenBalances,
  classifyAddress,
  verifyRecipient,
  hasTokenAccount,
  tokenAccountRentLamports,
} from './token';
import { assetBySymbol, type SupportedCluster } from '../contracts/tokens';

import {
  verifyPayment,
  findReferenceTransactions,
  getTransactionStatus,
  watchTokenAccount,
  meetsCommitment,
  createInMemoryLedger,
} from './payment-verify';

// ============================================================================
// MODE
// ============================================================================

export type ChainMode = 'mock' | 'devnet';

/** Resolve the active mode from the environment. Defaults to mock. */
export function chainMode(): ChainMode {
  const raw = (import.meta.env as Record<string, string | undefined>)
    .VITE_USE_CHAIN;
  return raw?.trim() === 'true' ? 'devnet' : 'mock';
}

/** True when reads hit a real cluster. */
export function isLive(): boolean {
  return chainMode() === 'devnet';
}

// ============================================================================
// MOCK IMPLEMENTATIONS
// ============================================================================

/**
 * Deterministic pseudo-balance derived from an address.
 *
 * Stable across reloads so the UI does not flicker, and different per address
 * so multiple accounts look distinct.
 */
function mockBalanceBase(owner: Address, asset: TokenAsset): bigint {
  let hash = 0;
  const seed = `${owner}:${asset.mint}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  // Between 0 and 500 tokens.
  const whole = hash % 500;
  const fraction = (hash >>> 8) % 100;
  return amountFromBase(BigInt(whole * 100 + fraction), { ...asset, decimals: 2 }).base * 10n ** BigInt(asset.decimals - 2);
}

async function mockTokenBalance(owner: Address, asset: TokenAsset) {
  const base = mockBalanceBase(owner, asset);
  return {
    owner,
    ata: `MockATA${owner.slice(0, 8)}${asset.symbol}` as Address,
    asset,
    base,
    ui: amountFromBase(base, asset).ui,
    exists: true,
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

export const chain = {
  // --- Configuration ------------------------------------------------------
  mode: chainMode,
  isLive,
  network,
  isDevnet,
  describeNetwork,
  resetClients,
  explorerTxUrl,
  explorerAddressUrl,

  // --- Payment requests (always real: pure encoding) -----------------------
  encodeTransferRequest,
  encodeIntent,
  encodeTransactionRequest,
  createPaymentRequest,
  renderQrSvg,
  renderQrDataUrl,
  parsePaymentRequest,
  generateReference,
  isReference,
  formatSpecAmount,
  isBase58,
  supportsRail,
  supportedRails: SUPPORTED_RAILS,

  // --- Balances -----------------------------------------------------------
  /**
   * Read a wallet's balance. In mock mode returns a deterministic fake so the
   * UI has something to render.
   */
  async getBalance(owner: Address, asset: TokenAsset) {
    if (!isLive()) return mockTokenBalance(owner, asset);
    return getTokenBalance(owner, asset);
  },

  async getBalances(owner: Address, assets: TokenAsset[]) {
    if (!isLive()) return Promise.all(assets.map((a) => mockTokenBalance(owner, a)));
    return getTokenBalances(owner, assets);
  },

  // --- Accounts -----------------------------------------------------------
  deriveAta,

  async classifyAddress(addr: Address) {
    if (!isLive()) return { kind: 'wallet' as const, exists: true };
    return classifyAddress(addr);
  },

  async verifyRecipient(recipient: Address, asset: TokenAsset | null) {
    if (!isLive()) {
      return { ok: true, classified: { kind: 'wallet' as const, exists: true }, canReceive: true, reason: null };
    }
    return verifyRecipient(recipient, asset);
  },

  async hasTokenAccount(owner: Address, asset: TokenAsset) {
    if (!isLive()) return true;
    return hasTokenAccount(owner, asset);
  },

  tokenAccountRentLamports,

  // --- Verification -------------------------------------------------------
  /**
   * Verify a payment. In mock mode there is nothing to verify, so callers get
   * an explicit "not live" result rather than a fabricated receipt.
   */
  async verifyPayment(reference: Reference, asset: TokenAsset, recipient: Address) {
    if (!isLive()) {
      return {
        ok: false as const,
        status: 'pending' as const,
        reason: 'Chain access is disabled (VITE_USE_CHAIN is not true)',
      };
    }
    return verifyPayment({ reference }, asset, recipient);
  },

  findReferenceTransactions,

  async getTransactionStatus(signature: string) {
    if (!isLive()) return { commitment: null, error: false, slot: null };
    return getTransactionStatus(signature);
  },

  // --- Streaming ----------------------------------------------------------
  watchTokenAccount,

  // --- Guards -------------------------------------------------------------
  meetsCommitment,
  createInMemoryLedger,
};

// ============================================================================
// RE-EXPORTS
// ============================================================================

export type {
  Address,
  PaymentReceipt,
  Reference,
  Signature,
  TokenAsset,
  TokenAmount,
  WatchPaymentEvent,
  WatchPaymentOptions,
  SupportedCluster,
  ParsedPaymentRequest,
  ParsedTransferRequest,
};

export { assetBySymbol };

export { amountFromBase, formatAmount, rpc, rpcSubscriptions };
export type { ChainMode as ChainModeType };
