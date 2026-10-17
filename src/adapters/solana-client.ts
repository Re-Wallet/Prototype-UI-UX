/**
 * Solana RPC client — the only place a connection is created.
 *
 * Everything else in `src/adapters/` borrows the client from here. RPC
 * endpoints come from environment variables so devnet, mainnet, and a private
 * provider are a configuration change, not a code change.
 *
 * Note on endpoints: the public cluster URLs are rate-limited and have no SLA.
 * They are fine for a prototype against devnet. Production needs a provider
 * (Helius, Triton, QuickNode, Alchemy) — see:
 * https://solana.com/docs/payments/interacting-with-solana
 */

import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

import type { SupportedCluster } from '../contracts/tokens';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface SolanaNetworkConfig {
  cluster: SupportedCluster;
  /** HTTP RPC endpoint. */
  rpcUrl: string;
  /** WebSocket endpoint used for subscriptions. */
  rpcSubscriptionsUrl: string;
}

const DEFAULT_DEVNET: SolanaNetworkConfig = {
  cluster: 'devnet',
  rpcUrl: 'https://api.devnet.solana.com',
  rpcSubscriptionsUrl: 'wss://api.devnet.solana.com',
};

const DEFAULT_MAINNET: SolanaNetworkConfig = {
  cluster: 'mainnet-beta',
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  rpcSubscriptionsUrl: 'wss://api.mainnet-beta.solana.com',
};

function envValue(key: string): string | undefined {
  const raw = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env?.[key];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve the active network from the environment.
 *
 * VITE_SOLANA_CLUSTER selects the cluster; VITE_SOLANA_RPC and
 * VITE_SOLANA_RPC_WS override the endpoints (a private provider, a local
 * validator, or a proxy).
 */
export function resolveNetworkConfig(): SolanaNetworkConfig {
  const clusterRaw = envValue('VITE_SOLANA_CLUSTER');
  const cluster: SupportedCluster =
    clusterRaw === 'mainnet-beta' ? 'mainnet-beta' : 'devnet';

  const base = cluster === 'mainnet-beta' ? DEFAULT_MAINNET : DEFAULT_DEVNET;

  return {
    cluster,
    rpcUrl: envValue('VITE_SOLANA_RPC') ?? base.rpcUrl,
    rpcSubscriptionsUrl: envValue('VITE_SOLANA_RPC_WS') ?? base.rpcSubscriptionsUrl,
  };
}

// ============================================================================
// CLIENTS (lazily created singletons)
// ============================================================================

/**
 * The RPC surface this app actually uses.
 *
 * Typing only what we consume keeps the rest of the adapters honest: every call
 * below is checked, instead of degrading to `any`.
 */
export interface PaymentRpcApi {
  getBalance: (
    addr: unknown,
    config?: unknown
  ) => { send: () => Promise<{ value: bigint }> };
  getAccountInfo: (
    addr: unknown,
    config?: unknown
  ) => { send: () => Promise<{ value: { owner: unknown; data: unknown } | null }> };
  getTokenAccountBalance: (
    addr: unknown
  ) => { send: () => Promise<{ value: { amount: string; decimals: number; uiAmount: number | null } }> };
  getTokenAccountsByOwner: (
    owner: unknown,
    filter: unknown,
    config?: unknown
  ) => {
    send: () => Promise<{
      value: Array<{ pubkey: unknown; account: { data: unknown } }>;
    }>;
  };
  getMinimumBalanceForRentExemption: (size: bigint) => { send: () => Promise<bigint> };
  getSignaturesForAddress: (
    addr: unknown,
    config?: unknown
  ) => {
    send: () => Promise<
      Array<{
        signature: unknown;
        slot: unknown;
        blockTime: unknown;
        err: unknown;
        confirmationStatus?: unknown;
      }>
    >;
  };
  getTransaction: (
    signature: unknown,
    config?: unknown
  ) => { send: () => Promise<unknown> };
  getSignatureStatuses: (
    signatures: unknown[]
  ) => {
    send: () => Promise<{
      value: Array<{ confirmationStatus: unknown; err: unknown; slot: unknown } | null>;
    }>;
  };
}

export interface PaymentRpcSubscriptionsApi {
  accountNotifications: (
    addr: unknown,
    config?: unknown
  ) => { subscribe: (opts: { abortSignal: AbortSignal }) => Promise<unknown> };
}

type SolanaRpc = PaymentRpcApi;
type SolanaRpcSubscriptions = PaymentRpcSubscriptionsApi;

let httpClient: SolanaRpc | null = null;
let wsClient: SolanaRpcSubscriptions | null = null;
let resolvedConfig: SolanaNetworkConfig | null = null;

/** The active network configuration. */
export function network(): SolanaNetworkConfig {
  if (!resolvedConfig) {
    resolvedConfig = resolveNetworkConfig();
  }
  return resolvedConfig;
}

/** True when the app is pointed at devnet. */
export function isDevnet(): boolean {
  return network().cluster === 'devnet';
}

/** Shared HTTP RPC client. */
export function rpc(): SolanaRpc {
  if (!httpClient) {
    httpClient = createSolanaRpc(network().rpcUrl) as unknown as SolanaRpc;
  }
  return httpClient;
}

/** Shared WebSocket subscription client. */
export function rpcSubscriptions(): SolanaRpcSubscriptions {
  if (!wsClient) {
    wsClient = createSolanaRpcSubscriptions(
      network().rpcSubscriptionsUrl
    ) as unknown as SolanaRpcSubscriptions;
  }
  return wsClient;
}

/**
 * Drop cached clients. Call after changing the network at runtime (tests,
 * or a cluster switcher).
 */
export function resetClients(): void {
  httpClient = null;
  wsClient = null;
  resolvedConfig = null;
}

// ============================================================================
// EXPLORER LINKS
// ============================================================================

/** Explorer URL for a transaction signature on the active cluster. */
export function explorerTxUrl(signature: string): string {
  const suffix = isDevnet() ? '?cluster=devnet' : '';
  return `https://solscan.io/tx/${signature}${suffix}`;
}

/** Explorer URL for an account on the active cluster. */
export function explorerAddressUrl(address: string): string {
  const suffix = isDevnet() ? '?cluster=devnet' : '';
  return `https://solscan.io/account/${address}${suffix}`;
}
