/**
 * One-off backfill of on-chain activity into PostgreSQL.
 *
 *   npm run db:backfill
 *
 * Idempotent — re-running only refreshes rows that already exist. Wallets are
 * processed sequentially with a delay because the public devnet RPC
 * rate-limits bursts.
 */

import { pool } from '../db';
import { syncAllWallets } from '../services/historySync';

async function main(): Promise<void> {
  const { results, rateLimited } = await syncAllWallets();

  console.log('\nBackfill de historial on-chain\n');

  for (const result of results) {
    if (result.error) {
      console.log(`  ✗ ${result.publicKey}  → ${result.error}`);
      continue;
    }
    console.log(
      `  ✓ ${result.publicKey}  movimientos=${result.movements} nuevos=${result.inserted} actualizados=${result.updated}`
    );
  }

  const totals = results.reduce(
    (acc, result) => ({
      movements: acc.movements + result.movements,
      inserted: acc.inserted + result.inserted,
      updated: acc.updated + result.updated,
    }),
    { movements: 0, inserted: 0, updated: 0 }
  );

  console.log(
    `\n  Total: ${totals.inserted} nuevos, ${totals.updated} actualizados, ${totals.movements} movimientos leídos.\n`
  );

  if (rateLimited) {
    console.log('  ⚠️  El RPC público rate-limitó la corrida; reintentar más tarde.\n');
  }

  if (results.some((result) => result.error)) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    pool.end();
  });
