/**
 * Measures the App's cold initial load: the three wallet requests the app
 * fires in parallel on open.
 *
 * Usage: `npm run audit:load` (the API must be running).
 */

const API = process.env.AUDIT_API_URL ?? 'http://127.0.0.1:3001';
const WALLET = process.env.AUDIT_WALLET ?? '';

const paths = [
  ['balances', `/api/wallet/balances?wallet=${WALLET}`],
  ['transactions', `/api/wallet/transactions?wallet=${WALLET}`],
  ['notifications', `/api/wallet/notifications?wallet=${WALLET}`],
] as const;

async function load(label: string): Promise<void> {
  const start = Date.now();
  const results = await Promise.all(
    paths.map(async ([name, path]) => {
      const at = Date.now();
      const response = await fetch(`${API}${path}`);
      const body = await response.text();
      return {
        name,
        ms: Date.now() - at,
        queries: Number(response.headers.get('x-db-queries') ?? '0'),
        bytes: body.length,
      };
    })
  );
  const total = Date.now() - start;
  console.log(`\n${label}: ${total}ms`);
  for (const row of results) {
    console.log(
      `   ${row.name.padEnd(14)} ${String(row.ms).padStart(5)}ms  ${row.queries} query(s)  ${row.bytes}b`
    );
  }
  const queries = results.reduce((sum, row) => sum + row.queries, 0);
  console.log(`   ${'TOTAL'.padEnd(14)} ${String(total).padStart(5)}ms  ${queries} query(s)`);
}

(async () => {
  if (!WALLET) {
    console.error('AUDIT_WALLET is required.');
    process.exit(1);
  }
  await load('primera carga (frio)');
  await load('segunda carga (tibio)');
  await load('tercera carga (tibio)');
  process.exit(0);
})();
