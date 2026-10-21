/**
 * The runtime configuration.
 *
 * A Worker's URL is not known until it is deployed, and the tunnel's URL
 * changes on every restart. So the values the browser needs — the app URL,
 * the RPC endpoints, the cluster, the Dynamic environment, the Realtime URL —
 * cannot be baked into the bundle: the build and the Worker would be two
 * sources of truth for the same fact, and they would drift.
 *
 * The Worker answers `/api/config` with the deployed values, and the browser
 * fetches it once before it renders. Until it arrives, the build-time values
 * stand — which is what the local development uses, and what keeps the
 * bundle working if the config endpoint is unreachable.
 */

/** The public values a deployment carries. */
export interface RuntimeConfig {
  /** The absolute URL the app is served from. */
  appUrl: string;
  /** The Solana RPC the browser reads the chain from. */
  rpcUrl?: string;
  /** The websocket RPC, for the subscriptions. */
  rpcSubscriptionsUrl?: string;
  /** `devnet` or `mainnet-beta`. */
  cluster?: string;
  /** The Dynamic environment the browser talks to. */
  dynamicEnvironmentId?: string;
  /** The Neon Realtime endpoint the browser subscribes to. */
  realtimeUrl?: string;
  /** The database name signed into the Realtime token. */
  realtimeDb?: string;
}

/**
 * The resolved configuration.
 *
 * Empty until the config endpoint answers, and merged with whatever the
 * endpoint returns, so a partial answer never removes a value that was
 * already known.
 */
let resolved: Partial<RuntimeConfig> = {};

/** Merge the values the deployment reported. */
export function applyRuntimeConfig(next: Partial<RuntimeConfig>): void {
  resolved = { ...resolved, ...next };
}

/** The values known right now. */
export function runtimeConfig(): Partial<RuntimeConfig> {
  return resolved;
}

/**
 * Fetch the deployment's configuration, once.
 *
 * A failure is not fatal: the build-time values stand, which is exactly what
 * the local development and a static preview need.
 */
let loaded = false;

export async function loadRuntimeConfig(): Promise<Partial<RuntimeConfig>> {
  if (loaded) return resolved;
  loaded = true;
  try {
    const response = await fetch('/api/config', { headers: { accept: 'application/json' } });
    if (response.ok) {
      const body = (await response.json()) as Partial<RuntimeConfig>;
      applyRuntimeConfig(body);
    }
  } catch {
    // The build-time values stand.
  }
  return resolved;
}
