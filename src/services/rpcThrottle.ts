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

// ---------------------------------------------------------------------------
// PACING GATE
// ---------------------------------------------------------------------------

/**
 * Serialize RPC reads behind one process-wide gate.
 *
 * The public devnet endpoint answers bursts with 429 and no `Retry-After`, so
 * every RPC read in the process has to share one measured budget. The balance
 * cache has its own gate; this is the shared one for the paths outside it
 * (the payment-link claim and the signature ownership check).
 *
 * At most one call is in flight and consecutive calls are spaced by the
 * current pace, which widens once the limiter has been observed.
 */
let lastRpcAt = 0;
let rpcTail: Promise<unknown> = Promise.resolve();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function pacedRpc<T>(read: () => Promise<T>): Promise<T> {
  const run = rpcTail.then(async () => {
    const wait = lastRpcAt + currentRpcPaceMs() - Date.now();
    if (wait > 0) await sleep(wait);
    lastRpcAt = Date.now();
    return read();
  });
  // The chain stays alive even when a read rejects, so one failed call never
  // blocks the next one.
  rpcTail = run.catch(() => undefined);
  return run as Promise<T>;
}
