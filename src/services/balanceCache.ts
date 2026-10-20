/**
 * Server-side SOL/USDC balance reads with a cache and a shared pacing gate.
 *
 * Why this exists: the public RPC hard-limits by IP (~10 clean calls, then
 * 429s), and the client used to hit it once per wallet on every app load and
 * after every transfer. One process-wide gate means the wallets the app serves
 * share a single measured budget instead of amplifying each other.
 *
 * Deliberately NOT routed through `src/adapters`: those are client-facing
 * (Dynamic + browser bundling assumptions), and their RPC retry behaviour
 * cannot be paced from here. This file speaks raw JSON-RPC so every call,
 * including retries, passes through the same gate.
 */

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
/** Devnet USDC. Set USDC_MINT to point the app at another cluster's mint. */
const USDC_MINT =
  process.env.USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC_DECIMALS = 6;
const SOL_DECIMALS = 9;

/** Minimum spacing between RPC calls, process-wide. */
const RPC_PACE_MS = Number(process.env.RPC_PACE_MS ?? 400);
/**
 * A cache entry younger than this is served without touching the RPC.
 *
 * Correctness does not rest on this TTL: any movement ReWallet sees — via the
 * Dynamic webhook or the sweeper — calls {@link invalidateBalances}, so the
 * next read is fresh regardless. The TTL only bounds how stale an *external*
 * movement (one ReWallet never observed) can be, so it can be generous. 60s
 * keeps that window short while letting repeated app opens inside a minute
 * share one RPC read.
 */
const CACHE_TTL_MS = Number(process.env.BALANCE_CACHE_TTL_MS ?? 60_000);
/** One retry window for a 429 before the read fails. */
const RATE_LIMIT_RETRY_MS = 1_500;

export interface BalanceSnapshot {
  sol: number;
  usdc: number;
  /** Epoch millis the RPC values were actually read. */
  fetchedAt: number;
  source: 'rpc' | 'cache';
}

interface CacheEntry {
  snapshot: BalanceSnapshot;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Reads in flight, keyed by wallet. Two concurrent cache misses for the same
 * wallet share one RPC read instead of queuing two behind the pacing gate.
 */
const inFlight = new Map<string, Promise<BalanceSnapshot>>();

/**
 * Per-wallet generation, bumped by {@link invalidateBalances}. A read that
 * started under an older generation must not cache its (pre-movement) result,
 * so it checks the generation before writing.
 */
const generation = new Map<string, number>();

function bumpGeneration(key: string): number {
  const next = (generation.get(key) ?? 0) + 1;
  generation.set(key, next);
  return next;
}

// ---------------------------------------------------------------------------
// PACING GATE
// ---------------------------------------------------------------------------

let lastRpcAt = 0;
let tail: Promise<unknown> = Promise.resolve();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Serialize RPC work behind one gate: at most one in flight, at least
 * {@link RPC_PACE_MS} between starts. The chain stays alive even when a read
 * rejects, so one failed wallet never blocks the next one.
 */
function paced<T>(read: () => Promise<T>): Promise<T> {
  const run = tail.then(async () => {
    const wait = lastRpcAt + RPC_PACE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRpcAt = Date.now();
    return read();
  });
  tail = run.catch(() => undefined);
  return run as Promise<T>;
}

// ---------------------------------------------------------------------------
// RAW RPC
// ---------------------------------------------------------------------------

interface RpcResponse<T> {
  result?: T;
  error?: { code?: number; message?: string };
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const request = async (): Promise<T> => {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 429 || response.status === 503) {
      const error = new Error(`${method} rate limited (${response.status})`) as Error & {
        retryable?: boolean;
      };
      error.retryable = true;
      throw error;
    }
    if (!response.ok) throw new Error(`${method} responded ${response.status}`);
    const payload = (await response.json()) as RpcResponse<T>;
    if (payload.error) {
      throw new Error(`${method}: ${payload.error.message ?? payload.error.code ?? 'rpc error'}`);
    }
    if (payload.result === undefined) throw new Error(`${method} returned no result`);
    return payload.result;
  };

  try {
    return await request();
  } catch (error) {
    if (!(error as { retryable?: boolean }).retryable) throw error;
    // A 429 is not a failure until the retry window has elapsed: wait, then go
    // through the gate again rather than hammering the endpoint.
    await sleep(RATE_LIMIT_RETRY_MS);
    return request();
  }
}

/** SOL balance in human units. */
async function readSol(wallet: string): Promise<number> {
  const result = await rpcCall<{ value: number }>('getBalance', [
    wallet,
    { commitment: 'confirmed' },
  ]);
  return result.value / 10 ** SOL_DECIMALS;
}

/** USDC balance in human units, summed across the owner's token accounts. */
async function readUsdc(wallet: string): Promise<number> {
  const result = await rpcCall<{ value: Array<{ account: { data: unknown } }> }>(
    'getTokenAccountsByOwner',
    [wallet, { mint: USDC_MINT }, { encoding: 'jsonParsed', commitment: 'confirmed' }]
  );

  let base = 0n;
  for (const entry of result.value) {
    const data = entry.account.data as
      | { parsed?: { info?: { tokenAmount?: { amount?: string } } } }
      | null;
    const raw = data?.parsed?.info?.tokenAmount?.amount;
    if (raw) base += BigInt(raw);
  }
  return Number(base) / 10 ** USDC_DECIMALS;
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Balance for one wallet, cached for {@link CACHE_TTL_MS}.
 *
 * Pass `force` to bypass the cache — callers that just broadcast a transaction
 * do, so the follow-up read is not served the pre-transfer values. A failing
 * RPC with a cached entry resolves with that stale snapshot instead of an
 * error: an out-of-date balance beats a spinner for a wallet prototype.
 */
export async function getBalances(wallet: string, force = false): Promise<BalanceSnapshot> {
  const key = wallet.trim();
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return { ...hit.snapshot, source: 'cache' };
  }

  // Collapse concurrent misses for the same wallet onto one RPC read. A forced
  // read (post-signature) still shares an in-flight read: the values it wants
  // are the ones already being fetched.
  const pending = inFlight.get(key);
  if (pending) return pending;

  const read = readAndCache(key, hit, generation.get(key) ?? 0);
  inFlight.set(key, read);
  try {
    return await read;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Read SOL + USDC through the pacing gate and cache the result.
 *
 * `startedAt` is the wallet generation when the read began; if {@link invalidateBalances}
 * bumped it meanwhile, the values are pre-movement and are not cached.
 */
async function readAndCache(
  key: string,
  hit: CacheEntry | undefined,
  startedAt: number
): Promise<BalanceSnapshot> {
  try {
    const [sol, usdc] = await paced(async () => {
      // Sequential inside the gate: they are two separate RPC calls.
      const solValue = await readSol(key);
      const usdcValue = await readUsdc(key);
      return [solValue, usdcValue] as const;
    });
    const snapshot: BalanceSnapshot = { sol, usdc, fetchedAt: Date.now(), source: 'rpc' };
    // Only cache if no invalidation happened while we were reading.
    if ((generation.get(key) ?? 0) === startedAt) {
      cache.set(key, { snapshot, fetchedAt: snapshot.fetchedAt });
    }
    return snapshot;
  } catch (error) {
    if (hit) {
      console.warn(`⚠️  balance refresh for ${key.slice(0, 8)} failed, serving cache:`, error);
      return { ...hit.snapshot, source: 'cache' };
    }
    throw error;
  }
}

/**
 * Drop a wallet's cached balance (used when a write invalidated it).
 *
 * Also bumps the wallet generation so an in-flight read started before the
 * movement cannot later cache pre-movement values, and drops that read from
 * the dedupe map so the next caller starts a fresh one.
 */
export function invalidateBalances(wallet: string): void {
  const key = wallet.trim();
  cache.delete(key);
  bumpGeneration(key);
  inFlight.delete(key);
}
