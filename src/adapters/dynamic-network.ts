/**
 * Dynamic network alignment.
 *
 * The app and Dynamic resolve the active Solana cluster from two independent
 * sources:
 *
 *   - the app:    `resolveNetworkConfig()` in ./solana-client (VITE_SOLANA_CLUSTER)
 *   - Dynamic:   `getActiveNetworkData()` -> `walletProvider.getActiveNetworkId()`
 *
 * Dynamic's transaction builders (`solanaTransferAmount`) read the cluster from
 * the *provider's active network*, not from the app configuration and not from
 * the wallet account. When a Dynamic environment has more than one SVM network
 * enabled, the two can drift: the app builds and validates against devnet while
 * the provider signs against mainnet-beta. The failure surfaces late, as an
 * opaque simulation error, because the debited fee payer is an account with no
 * balance on the network actually used.
 *
 * This module makes that state explicit before anything is signed.
 */

import {
  getActiveNetworkData,
  getNetworksData,
  isProgrammaticNetworkSwitchAvailable,
  switchActiveNetwork,
} from '@dynamic-labs-sdk/client';
import type { SolanaWalletAccount } from '@dynamic-labs-sdk/solana';

import { getDynamicClient } from '../dynamicClient';
import { network } from './solana-client';
import type { SupportedCluster } from '../contracts/tokens';

// ============================================================================
// GENESIS HASHES
// ============================================================================

/**
 * Canonical Solana cluster genesis hashes, verified against each public RPC.
 * Compared instead of `cluster` strings because Dynamic's cluster labels are
 * API-defined and need not match the app's `SupportedCluster` vocabulary.
 */
const SOLANA_GENESIS_HASH: Record<SupportedCluster, string> = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
};

export function genesisHashFor(cluster: SupportedCluster): string {
  return SOLANA_GENESIS_HASH[cluster];
}

/**
 * Minimum shared prefix required to call two genesis hashes the same chain.
 *
 * Solana clusters have unrelated hashes (devnet starts `EtWTRABZa`, mainnet-beta
 * `5eykt4UsF`, testnet `4uhcVJyU9`, Eclipse `EAQLJCV2`), so 20 characters is
 * already unambiguous in practice. The floor exists so a near-empty value can
 * never match everything.
 */
const MIN_GENESIS_PREFIX = 20;

/**
 * Compare a canonical genesis hash against one reported by Dynamic.
 *
 * Dynamic's networks API truncates genesis hashes — Solana devnet is returned as
 * `EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (31 chars) instead of the full
 * `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` (44). A strict equality check
 * therefore rejects the correct chain forever.
 *
 * A truncated value is still a prefix of the real one, so accept a prefix match
 * once enough characters agree. Genuinely different chains share no prefix, so
 * this does not weaken the Eclipse-vs-Solana-devnet distinction.
 */
function genesisMatches(expected: string, reported: string): boolean {
  if (reported === expected) return true;

  const [shorter, longer] =
    reported.length < expected.length ? [reported, expected] : [expected, reported];

  return longer.startsWith(shorter) && shorter.length >= MIN_GENESIS_PREFIX;
}

// ============================================================================
// RESULT TYPES
// ============================================================================

export type NetworkMatch = 'genesis' | 'cluster' | 'unknown';

export interface NetworkAlignment {
  /** True only when Dynamic is confirmed to be on the app's cluster. */
  aligned: boolean;
  /** How the comparison was decided. 'unknown' means no usable signal. */
  matchedBy: NetworkMatch;
  appCluster: SupportedCluster;
  dynamicNetworkId: string | null;
  dynamicCluster: string | null;
  dynamicGenesisHash: string | null;
  /** Human-readable explanation, populated when `aligned` is false. */
  reason: string | null;
  /** True when a programmatic switch is possible for this wallet account. */
  switchAvailable: boolean;
}

export type AlignResult =
  | { ok: true; alignment: NetworkAlignment; switched: boolean }
  | { ok: false; alignment: NetworkAlignment };

// ============================================================================
// HELPERS
// ============================================================================

function normalizeCluster(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  // Dynamic has used both `mainnet-beta` and `mainnet` for production Solana.
  if (trimmed === 'mainnet-beta' || trimmed === 'mainnet') return 'mainnet-beta';
  if (trimmed === 'devnet' || trimmed === 'development') return 'devnet';
  return trimmed;
}

/**
 * Decide whether Dynamic's active network is the app's cluster.
 *
 * The genesis hash is authoritative and must be compared first. Cluster labels
 * are not sufficient: a Dynamic project can label a network `devnet` while
 * pointing at an entirely different chain — for example an SVM L2 such as
 * Eclipse (`mainnetbeta-rpc.eclipse.xyz`, genesis
 * `EAQLJCV2mh23BsK2P9oYpV5CHVLDNHTxYss3URrNmg3s`). Solana devnet is
 * `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. Those two differ, and a
 * label-only comparison reports them as aligned while funds sit on a chain the
 * transaction never reaches.
 *
 * The cluster label is a fallback for networks configured without a genesis
 * hash. With no signal at all, alignment cannot be confirmed and this fails.
 */
function compare(appCluster: SupportedCluster, active: {
  cluster?: string | null;
  genesisHash?: string | null;
}): { aligned: boolean; matchedBy: NetworkMatch } {
  if (active.genesisHash) {
    return {
      aligned: genesisMatches(SOLANA_GENESIS_HASH[appCluster], active.genesisHash),
      matchedBy: 'genesis',
    };
  }

  const activeCluster = normalizeCluster(active.cluster);
  if (activeCluster) {
    return { aligned: activeCluster === appCluster, matchedBy: 'cluster' };
  }

  // No signal at all: cannot confirm alignment.
  return { aligned: false, matchedBy: 'unknown' };
}

function describe(active: { cluster?: string | null; networkId?: string | null }): string {
  const cluster = normalizeCluster(active.cluster);
  if (cluster) return cluster;
  return active.networkId ?? 'una red desconocida';
}

/**
 * Build a mismatch message that states what was compared, so a mis-detection is
 * obvious rather than self-contradictory.
 */
function mismatchReason(
  appCluster: SupportedCluster,
  active: { cluster?: string | null; genesisHash?: string | null; networkId?: string | null },
  matchedBy: NetworkMatch
): string {
  const where = `Dynamic está en ${describe(active)} (networkId: ${active.networkId ?? 'desconocido'})`;
  const app = `la app está en ${appCluster}`;

  if (matchedBy === 'genesis') {
    // A genesis mismatch means genuinely different chains, even when both are
    // labelled "devnet". Show both hashes so the divergence is legible instead
    // of reading as a contradiction.
    return `${where} y ${app}, pero son cadenas distintas. ` +
      `Genesis de la app (${appCluster}): ${SOLANA_GENESIS_HASH[appCluster]}. ` +
      `Genesis de Dynamic: ${active.genesisHash}. ` +
      'Revisá a qué RPC apunta la red en el proyecto de Dynamic.';
  }

  if (matchedBy === 'unknown') {
    return `${where} y ${app}, pero Dynamic no informa el cluster de esa red. ` +
      'No se puede confirmar la red antes de firmar.';
  }

  return `${where} y ${app}. Cambiá la red antes de firmar.`;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Read Dynamic's active network for a wallet account and compare it against the
 * app's configured cluster. Read-only: never mutates provider state.
 */
export async function inspectDynamicNetwork(
  walletAccount: SolanaWalletAccount
): Promise<NetworkAlignment> {
  const appCluster = network().cluster;

  let switchAvailable = false;
  try {
    switchAvailable = isProgrammaticNetworkSwitchAvailable({ walletAccount }, getDynamicClient());
  } catch {
    switchAvailable = false;
  }

  let active: { cluster?: string | null; genesisHash?: string | null; networkId?: string | null } | undefined;
  try {
    const result = await getActiveNetworkData({ walletAccount }, getDynamicClient());
    active = result.networkData as typeof active;
  } catch (error) {
    return {
      aligned: false,
      matchedBy: 'unknown',
      appCluster,
      dynamicNetworkId: null,
      dynamicCluster: null,
      dynamicGenesisHash: null,
      reason:
        'No se pudo determinar la red activa de Dynamic. ' +
        (error instanceof Error ? error.message : String(error)),
      switchAvailable,
    };
  }

  if (!active) {
    return {
      aligned: false,
      matchedBy: 'unknown',
      appCluster,
      dynamicNetworkId: null,
      dynamicCluster: null,
      dynamicGenesisHash: null,
      reason:
        'Dynamic no devolvió datos de red para esta wallet. ' +
        'Verificá que el proyecto tenga habilitada la red Solana esperada.',
      switchAvailable,
    };
  }

  const { aligned, matchedBy } = compare(appCluster, active);

  return {
    aligned,
    matchedBy,
    appCluster,
    dynamicNetworkId: active.networkId ?? null,
    dynamicCluster: normalizeCluster(active.cluster),
    dynamicGenesisHash: active.genesisHash ?? null,
    reason: aligned
      ? null
      : mismatchReason(appCluster, active, matchedBy),
    switchAvailable,
  };
}

/**
 * Ensure Dynamic signs against the app's configured cluster.
 *
 * Fails closed: when alignment cannot be confirmed, this reports failure rather
 * than letting a transaction be built for an unknown network.
 *
 * @param options.switch If true (default), attempts a programmatic switch when
 *   the provider exposes one and a matching network is configured.
 */
export async function ensureDynamicNetwork(
  walletAccount: SolanaWalletAccount,
  options: { switch?: boolean } = {}
): Promise<AlignResult> {
  const shouldSwitch = options.switch ?? true;

  const first = await inspectDynamicNetwork(walletAccount);
  if (first.aligned) return { ok: true, alignment: first, switched: false };

  if (!shouldSwitch || !first.switchAvailable || first.matchedBy === 'unknown') {
    return { ok: false, alignment: first };
  }

  const appCluster = network().cluster;

  let targetNetworkId: string | null = null;
  try {
    const networks = getNetworksData(getDynamicClient());
    // Genesis first, mirroring `compare`. Matching on the cluster label alone
    // could select a same-named network on a different chain.
    const byGenesis = networks.find(
      (data) =>
        data.chain === 'SOL' &&
        Boolean(data.genesisHash) &&
        genesisMatches(SOLANA_GENESIS_HASH[appCluster], data.genesisHash as string)
    );
    const byCluster = networks.find(
      (data) => data.chain === 'SOL' && normalizeCluster(data.cluster) === appCluster
    );
    targetNetworkId = (byGenesis ?? byCluster)?.networkId ?? null;
  } catch {
    targetNetworkId = null;
  }

  if (!targetNetworkId || targetNetworkId === first.dynamicNetworkId) {
    return { ok: false, alignment: first };
  }

  try {
    await switchActiveNetwork(
      { networkId: targetNetworkId, walletAccount },
      getDynamicClient()
    );
  } catch {
    return { ok: false, alignment: first };
  }

  const after = await inspectDynamicNetwork(walletAccount);
  if (!after.aligned) return { ok: false, alignment: after };

  return { ok: true, alignment: after, switched: true };
}