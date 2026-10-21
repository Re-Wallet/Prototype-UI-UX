/**
 * Audit harness: measures time and database round-trips per API endpoint.
 *
 * Why this exists: every database round-trip to Neon costs roughly the same
 * as a network RTT from wherever the API runs (~190ms measured from
 * Argentina against a us-east-2 compute). The query count IS the latency
 * budget, so "is this endpoint slow?" is answered by "how many round-trips
 * does it make?", not by how long the query itself takes.
 *
 * Usage: `npm run audit:api` (the API must be running on port 3001).
 *
 * The harness reads the API over HTTP and takes the round-trip count from the
 * server's `X-DB-Queries` header (see `src/services/dbMetrics.ts`). Each
 * endpoint is called twice: the first call warms any server-side cache, the
 * second is the path a returning user hits.
 */

const API = process.env.AUDIT_API_URL ?? 'http://127.0.0.1:3001';
const WALLET = process.env.AUDIT_WALLET ?? '';

/** Measured cost of one database round-trip. Used to price the query count. */
const RTT_MS = Number(process.env.AUDIT_RTT_MS ?? 190);

function endpoints(): Array<[string, string]> {
  const list: Array<[string, string]> = [
    ['health', '/api/health'],
    ['landing-metrics', '/api/landing/metrics'],
  ];
  if (!WALLET) return list;
  list.push(
    ['contacts', `/api/wallet/contacts?wallet=${WALLET}`],
    ['payment-links', `/api/payment-links?wallet=${WALLET}`],
    ['balances', `/api/wallet/balances?wallet=${WALLET}`],
    ['transactions', `/api/wallet/transactions?wallet=${WALLET}`],
    ['notifications', `/api/wallet/notifications?wallet=${WALLET}`],
    ['identity', `/api/wallet/identity?address=${WALLET}`]
  );
  return list;
}

(async () => {
  const rows: Array<{ endpoint: string; ms: number; queries: number; bytes: number }> = [];

  for (const [name, path] of endpoints()) {
    // First call warms any server-side cache; the second is the warm path.
    await fetch(`${API}${path}`);

    const start = Date.now();
    const response = await fetch(`${API}${path}`);
    const elapsed = Date.now() - start;
    const body = await response.text();
    const queries = Number(response.headers.get('x-db-queries') ?? '0');

    rows.push({ endpoint: name, ms: elapsed, queries, bytes: body.length });

    console.log(
      `\n── ${name} ── ${elapsed}ms | ${queries} query(s) | red estimado ${
        queries * RTT_MS
      }ms | HTTP ${response.status} | ${body.length} bytes`
    );
  }

  console.log('\n═══ RESUMEN ═══');
  console.log('endpoint           tiempo  queries  red est.  payload');
  for (const row of rows) {
    console.log(
      `${row.endpoint.padEnd(18)} ${String(row.ms).padStart(5)}ms ${String(row.queries).padStart(7)}  ${String(
        row.queries * RTT_MS
      ).padStart(7)}ms  ${String(row.bytes).padStart(7)}b`
    );
  }

  const totalQueries = rows.reduce((sum, row) => sum + row.queries, 0);
  const totalMs = rows.reduce((sum, row) => sum + row.ms, 0);
  console.log(
    `\nTOTAL: ${totalMs}ms | ${totalQueries} queries | red estimado ${totalQueries * RTT_MS}ms`
  );

  process.exit(0);
})();
