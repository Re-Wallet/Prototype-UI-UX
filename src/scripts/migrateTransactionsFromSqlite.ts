/**
 * One-off copy of the SQLite ledger history that predates the Neon migration.
 *
 *   npx tsx src/scripts/migrateTransactionsFromSqlite.ts
 *
 * Users were migrated with the ledger; their `transactions` history was left
 * behind on purpose at the time, and the Activity feed now reads Postgres
 * only — so the old rows land here too. Idempotent on (user_id, reference_id):
 * re-running skips whatever already migrated.
 */

import Database from 'better-sqlite3';
import { pool, db } from '../db';
import { transactions } from '../db/schema';

const SQLITE_PATH = 'data/rewallet.db';

interface SqliteTxRow {
  user_id: number;
  type: string;
  status: string;
  amount_usdc: number;
  amount_sol: number | null;
  fiat_amount: number | null;
  fiat_currency: string | null;
  fiat_rate: number | null;
  counterparty_id: number | null;
  counterparty_handle: string | null;
  counterparty_name: string | null;
  counterparty_pubkey: string | null;
  method: string | null;
  network: string;
  reference_id: string;
  solana_signature: string | null;
  solana_slot: number | null;
  reference_pubkey: string | null;
  payment_link_id: number | null;
  memo: string | null;
  note: string | null;
  fee_usdc: number;
  fee_payer: string;
  confirmations: number;
  confirmed_at: number | null;
  failed_reason: string | null;
  metadata_json: string | null;
  created_at: number;
  updated_at: number;
}

async function main(): Promise<void> {
  const sqlite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
  const rows = sqlite
    .prepare('SELECT * FROM transactions ORDER BY id')
    .all() as SqliteTxRow[];
  sqlite.close();

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const result = await db
      .insert(transactions)
      .values({
        userId: row.user_id,
        type: row.type,
        status: row.status,
        amountUsdc: row.amount_usdc,
        amountSol: row.amount_sol,
        fiatAmount: row.fiat_amount,
        fiatCurrency: row.fiat_currency,
        fiatRate: row.fiat_rate,
        counterpartyId: row.counterparty_id,
        counterpartyHandle: row.counterparty_handle,
        counterpartyName: row.counterparty_name,
        counterpartyPubkey: row.counterparty_pubkey,
        method: row.method,
        network: row.network,
        referenceId: row.reference_id,
        solanaSignature: row.solana_signature,
        solanaSlot: row.solana_slot,
        referencePubkey: row.reference_pubkey,
        paymentLinkId: row.payment_link_id,
        memo: row.memo,
        note: row.note,
        feeUsdc: row.fee_usdc,
        feePayer: row.fee_payer,
        confirmations: row.confirmations,
        confirmedAt: row.confirmed_at ? new Date(row.confirmed_at * 1000) : null,
        failedReason: row.failed_reason,
        metadataJson: row.metadata_json ? JSON.parse(row.metadata_json) : null,
        createdAt: new Date(row.created_at * 1000),
        updatedAt: new Date(row.updated_at * 1000),
      })
      .onConflictDoNothing()
      .returning({ id: transactions.id });

    if (result.length > 0) inserted += 1;
    else skipped += 1;
  }

  console.log('\nMigración de historial SQLite → Neon\n');
  console.log(`  Filas leídas:    ${rows.length}`);
  console.log(`  Insertadas:      ${inserted}`);
  console.log(`  Ya existían:     ${skipped}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    pool.end();
  });
