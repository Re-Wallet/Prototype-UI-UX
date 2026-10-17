/**
 * Adapter barrel — the single entry point for chain access.
 *
 * All balance, account, and payment-verification operations use the configured
 * Solana cluster. This adapter does not provide simulated chain data.
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
import { amountFromBase, amountFromUi, formatAmount } from '../contracts/tokens';
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
  getTokenAccountAddresses,
  getSolBalance,
  getTokenBalance,
  getTokenBalances,
  classifyAddress,
  verifyRecipient,
  hasTokenAccount,
  tokenAccountRentLamports,
} from './token';
import { assetByMint, assetBySymbol, type SupportedCluster } from '../contracts/tokens';

import {
  verifyPayment,
  findReferenceTransactions,
  getTransactionStatus,
  watchTokenAccount,
  meetsCommitment,
  createInMemoryLedger,
} from './payment-verify';

// ============================================================================
// PUBLIC API
// ============================================================================

export const chain = {
  // --- Configuration ------------------------------------------------------
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
  getBalance: getTokenBalance,
  getBalances: getTokenBalances,
  getSolBalance,

  // --- Accounts -----------------------------------------------------------
  deriveAta,
  getTokenAccountAddresses,
  classifyAddress,
  verifyRecipient,
  hasTokenAccount,
  tokenAccountRentLamports,

  // --- Verification -------------------------------------------------------
  async verifyPayment(reference: Reference, asset: TokenAsset, recipient: Address, expectedAmount?: TokenAmount) {
    return verifyPayment(
      { reference, expectedAmount, expectedRecipient: recipient },
      asset,
      recipient
    );
  },
  findReferenceTransactions,
  getTransactionStatus,

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
export { assetByMint };

export { amountFromBase, amountFromUi, formatAmount, rpc, rpcSubscriptions };
