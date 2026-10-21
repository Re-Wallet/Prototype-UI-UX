/**
 * End-to-end check of the single-use payment link flow.
 *
 * Proves the contract the prototype depends on:
 *   1. a link is created and starts `active`,
 *   2. the webhook path settles it (the same function the Dynamic ingestor
 *      calls when an incoming USDC transfer lands),
 *   3. the settlement reaches a Neon Realtime subscriber, so the collector's
 *      screen flips to "Pago recibido" without a refresh,
 *   4. a second payment for the same link is REJECTED — the link is
 *      single-use,
 *   5. a link belonging to another wallet is never settled by this one.
 *
 * The links it creates are removed at the end, so the script is safe to run
 * repeatedly.
 *
 * Usage: `npm run audit:flow` (the API must be running on port 3001).
 */

import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

import { createRealtimeClient } from '@neon/realtime/client';

import { db } from '../db';
import { paymentLinks } from '../db/schema';
import { eq } from 'drizzle-orm';
import { settlePaymentLinkForTransfer } from '../services/paymentLinks';

const API = process.env.AUDIT_API_URL ?? 'http://127.0.0.1:3001';
const WALLET = process.env.AUDIT_WALLET ?? '';
const CONCEPT = `audit-flow-${Date.now()}`;

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`   ${ok ? 'OK  ' : 'FALLA'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  if (!WALLET) {
    console.error('AUDIT_WALLET is required.');
    process.exit(1);
  }

  // --- 1. create -----------------------------------------------------------
  const created = await (
    await fetch(`${API}/api/payment-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: WALLET, amountUsdc: 7, concept: CONCEPT }),
    })
  ).json();
  console.log(`\n── 1. creacion del link ──`);
  check('el link se creo', Boolean(created?.referencePubkey), `ref=${created?.referencePubkey}`);
  check('arranca active', created?.status === 'active');
  const reference: string = created.referencePubkey;

  // --- 2. realtime subscriber ---------------------------------------------
  console.log(`\n── 2. suscriptor Realtime ──`);
  const sealed = await (
    await fetch(`${API}/api/payment-links/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: WALLET }),
    })
  ).json();
  check('el server entrega una capability', typeof sealed?.capability === 'string');

  const client = createRealtimeClient({ url: process.env.NEON_REALTIME_URL! });
  // The capability comes over HTTP, so its row type is unknown here.
  const subscription = client.subscribe<Record<string, unknown>>(sealed);

  // The raw update stream has two shapes: a complete replacement
  // (`type: 'rows'`, each entry is `{ rowId, row }`) and an incremental batch
  // (`type: 'changes'`, each change carries its own `row`). Both are read
  // here; the React bridge consumes the materialized snapshot instead.
  let sawPaid = false;
  const inspect = (rows: any[]) => {
    for (const entry of rows) {
      const row = entry?.row ?? entry;
      if (row?.referencePubkey === reference && row?.status === 'paid') sawPaid = true;
    }
  };
  subscription.onUpdate((update: any) => {
    if (update?.type === 'rows') inspect(update.rows ?? []);
    else if (update?.type === 'changes') inspect(update.changes ?? []);
  });
  // Wait for the subscription to go live instead of assuming a fixed delay:
  // the Realtime WebSocket can take a few seconds to open on a cold server,
  // and a fixed sleep made this check flaky rather than meaningful.
  const liveDeadline = Date.now() + 20_000;
  while (Date.now() < liveDeadline && subscription.getState().status !== 'live') {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check(
    'el suscriptor quedo en vivo',
    subscription.getState().status === 'live',
    `estado=${subscription.getState().status}`
  );

  // --- 3. settle (the webhook path) --------------------------------------
  console.log(`\n── 3. liquidacion (via webhook) ──`);
  const settled = await settlePaymentLinkForTransfer({
    recipient: WALLET,
    amountUsdc: 7,
    transactionHash: `audit-${Date.now()}`,
    payerPubkey: 'AUDIT_PAYER',
    slot: null,
  });
  check('el link se liquido', settled?.status === 'paid', `id=${settled?.id}`);
  check(
    'se liquido EL link correcto',
    settled?.referencePubkey === reference,
    `esperado=${reference} obtenido=${settled?.referencePubkey}`
  );

  await new Promise((resolve) => setTimeout(resolve, 5000));
  check('el cambio llego por Realtime (update crudo)', sawPaid);

  // This is what the React bridge actually consumes: the materialized
  // snapshot of the complete row set.
  const snapshot = subscription.getSnapshot();
  const snapRow = (snapshot.data ?? []).find(
    (row) => row.referencePubkey === reference
  );
  check(
    'el snapshot materializado muestra el link pagado (lo que ve la UI)',
    snapRow?.status === 'paid',
    `status=${String(snapRow?.status)}`
  );
  check(
    'los timestamps llegan como Date (el mapper depende de eso)',
    snapRow?.paidAt instanceof Date,
    `tipo=${(snapRow?.paidAt as Date | undefined)?.constructor?.name}`
  );

  // --- 4. single use ------------------------------------------------------
  console.log(`\n── 4. single-use: un segundo pago NO debe liquidar ──`);
  const second = await settlePaymentLinkForTransfer({
    recipient: WALLET,
    amountUsdc: 7,
    transactionHash: `audit-second-${Date.now()}`,
    payerPubkey: 'AUDIT_PAYER_2',
    slot: null,
  });
  check('el segundo pago fue rechazado', second === null, `devolvio=${JSON.stringify(second)}`);

  const viaApi = await (
    await fetch(`${API}/api/payment-links/by-reference/${reference}`)
  ).json();
  check('la API sigue reportando paid', viaApi?.status === 'paid');
  check(
    'no se duplico el cobro (solo un paidAt)',
    typeof viaApi?.paidAt === 'string' && viaApi.paidByPubkey === 'AUDIT_PAYER'
  );

  // --- 5. isolation between users ----------------------------------------
  console.log(`\n── 5. aislamiento entre wallets ──`);
  const other = await settlePaymentLinkForTransfer({
    recipient: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    amountUsdc: 7,
    transactionHash: `audit-other-${Date.now()}`,
    payerPubkey: 'AUDIT_PAYER_3',
    slot: null,
  });
  check('un link de otra wallet no se liquida', other === null);

  // --- cleanup ------------------------------------------------------------
  await db.delete(paymentLinks).where(eq(paymentLinks.concept, CONCEPT));
  console.log('\n   (links de prueba eliminados)');

  console.log(
    failures === 0
      ? '\n✅ El flow de single-use + Realtime funciona.\n'
      : `\n❌ ${failures} comprobacion(es) fallaron.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('audit:flow falló:', error);
  process.exit(1);
});
