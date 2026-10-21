/**
 * Reproduces the "wrong link settled" bug and proves it is fixed.
 *
 * The scenario: the same recipient has TWO active payment links of the SAME
 * amount — an old one and the one actually shared. The on-chain transfer
 * carries no reference, so the webhook could only guess, and it used to guess
 * the OLDEST one: the shared link stayed `active` and payable a second time.
 *
 * The check:
 *   1. two same-amount links for one recipient,
 *   2. the payer CLAIMS the newer one with a real on-chain signature,
 *   3. the newer link must be `paid` and the older one must stay `active`,
 *   4. the webhook arriving afterwards for the same transfer must not settle
 *      the older link (one signature settles exactly one link).
 *
 * Usage: `npm run audit:claim` (the API must be running on port 3001).
 */

import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

import { db } from '../db';
import { paymentLinks } from '../db/schema';
import { eq } from 'drizzle-orm';
import { settlePaymentLinkForTransfer } from '../services/paymentLinks';

const API = process.env.AUDIT_API_URL ?? 'http://127.0.0.1:3001';
const RECIPIENT = process.env.AUDIT_RECIPIENT ?? '';
const PAYER = process.env.AUDIT_PAYER ?? '';
/** A real, confirmed transfer of `AMOUNT` USDC from PAYER to RECIPIENT. */
const SIGNATURE = process.env.AUDIT_SIGNATURE ?? '';
const AMOUNT = Number(process.env.AUDIT_AMOUNT ?? '8');

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`   ${ok ? 'OK  ' : 'FALLA'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  if (!RECIPIENT || !PAYER || !SIGNATURE) {
    console.error('AUDIT_RECIPIENT, AUDIT_PAYER and AUDIT_SIGNATURE are required.');
    process.exit(1);
  }

  const stamp = Date.now();

  // --- 1. two active links of the same amount -----------------------------
  const create = async (concept: string) => {
    const res = await fetch(`${API}/api/payment-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: RECIPIENT, amountUsdc: AMOUNT, concept }),
    });
    const body = await res.json();
    return body as { referencePubkey: string; id: number };
  };

  const older = await create(`audit-claim-old-${stamp}`);
  const newer = await create(`audit-claim-new-${stamp}`);
  console.log(`\n── 1. dos links del mismo monto ──`);
  check('se crearon dos links', Boolean(older.referencePubkey && newer.referencePubkey));
  check('son distintos', older.referencePubkey !== newer.referencePubkey);

  // --- 2. the payer claims the NEWER link --------------------------------
  console.log(`\n── 2. el pagador declara el link que esta pagando ──`);
  const claim = await fetch(`${API}/api/payment-links/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference: newer.referencePubkey, signature: SIGNATURE }),
  });
  const claimBody = await claim.json();
  check('el claim fue aceptado', claim.status === 200 && claimBody.ok === true, `HTTP ${claim.status} ${JSON.stringify(claimBody).slice(0, 120)}`);

  const statusOf = async (reference: string) => {
    const res = await fetch(`${API}/api/payment-links/by-reference/${reference}`);
    const body = await res.json();
    return body.status as string;
  };

  check('el link declarado quedo pagado', (await statusOf(newer.referencePubkey)) === 'paid');
  check('el link viejo NO se toco', (await statusOf(older.referencePubkey)) === 'active');

  // --- 3. the webhook arrives for the same transfer ----------------------
  console.log(`\n── 3. el webhook llega despues por la misma transaccion ──`);
  const settled = await settlePaymentLinkForTransfer({
    recipient: RECIPIENT,
    amountUsdc: AMOUNT,
    transactionHash: SIGNATURE,
    payerPubkey: PAYER,
    slot: null,
  });
  // The webhook must not settle a DIFFERENT link. It returns the link this
  // signature already settled (idempotency), or nothing — either way, the
  // older link must stay untouched.
  check(
    'el webhook no liquido un link distinto al ya liquidado por esta firma',
    settled === null || settled.status === 'paid',
    `devolvio=${settled?.referencePubkey ?? 'null'} status=${settled?.status ?? '-'}`
  );
  check(
    'el link liquidado por esa firma es el que el pagador declaro',
    settled === null || settled.paidTxSignature === SIGNATURE,
    `firma=${settled?.paidTxSignature ?? '-'}`
  );
  check('el link viejo sigue activo', (await statusOf(older.referencePubkey)) === 'active');

  // --- 4. one signature, one link ------------------------------------------
  console.log(`\n── 4. una firma no puede liquidar dos links ──`);
  const twin = await create(`audit-claim-twin-${stamp}`);
  const secondClaim = await fetch(`${API}/api/payment-links/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference: twin.referencePubkey, signature: SIGNATURE }),
  });
  const twinStatus = await statusOf(twin.referencePubkey);
  check(
    'el segundo link con la misma firma NO se liquido',
    twinStatus === 'active',
    `HTTP ${secondClaim.status} status=${twinStatus}`
  );

  // --- cleanup ------------------------------------------------------------
  await db
    .delete(paymentLinks)
    .where(
      eq(paymentLinks.concept, `audit-claim-old-${stamp}`)
    );
  await db
    .delete(paymentLinks)
    .where(
      eq(paymentLinks.concept, `audit-claim-new-${stamp}`)
    );
  await db
    .delete(paymentLinks)
    .where(
      eq(paymentLinks.concept, `audit-claim-twin-${stamp}`)
    );
  console.log('\n   (links de prueba eliminados)');

  console.log(
    failures === 0
      ? '\n✅ El link correcto se liquida y el otro queda intacto.\n'
      : `\n❌ ${failures} comprobacion(es) fallaron.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('audit:claim falló:', error);
  process.exit(1);
});
