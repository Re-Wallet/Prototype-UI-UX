/**
 * Process-wide RPC rate-limit signal.
 *
 * The public devnet endpoint answers bursts of `getSignaturesForAddress` /
 * `getTransaction` with 429 and no `Retry-After`, so a per-request backoff
 * cannot coordinate callers on its own. This module keeps one shared view of
 * observed pressure — read pacing in `solanaHistory` and sweep scheduling in
 * `historySync` both consult it — without importing each other (no cycle).
 */

const state = {
  /** Consecutive sweeps that completed without a 429. */
  cleanSweeps: 0,
  /** True once a 429 has been seen; raises the RPC read pace. */
  throttled: false,
};

export const BASE_RPC_PACE_MS = 400;
export const THROTTLED_RPC_PACE_MS = 900;

/** Record one 429 observed anywhere in the process. */
export function noteRateLimit(): void {
  state.throttled = true;
  state.cleanSweeps = 0;
}

/** Record one sweep that finished without hitting the limiter. */
export function noteCleanSweep(): void {
  state.cleanSweeps += 1;
  if (state.cleanSweeps >= 2) state.throttled = false;
}

export function isThrottled(): boolean {
  return state.throttled;
}

/**
 * Delay between successive RPC calls. Widens once the endpoint has tripped so
 * the recovery attempt does not recreate the burst that caused the 429.
 */
export function currentRpcPaceMs(): number {
  return state.throttled ? THROTTLED_RPC_PACE_MS : BASE_RPC_PACE_MS;
}
