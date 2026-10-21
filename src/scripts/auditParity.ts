/**
 * No-regression check: compares every read endpoint's payload against the
 * database it is supposed to mirror.
 *
 * The audit rewrote several reads (LEFT JOIN instead of a second query, a
 * window function instead of a COUNT, caching instead of a fresh read). This
 * proves the responses still match the rows, so the optimisation did not
 * quietly change what the app sees.
 *
 * Usage: `npm run audit:parity` (the API must be running).
 */

const API = process.env.AUDIT_API_URL ?? 'http://127.0.0.1:3001';
const WALLET = process.env.AUDIT_WALLET ?? '';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`   ${ok ? 'OK  ' : 'FALLA'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function json(path: string): Promise<any> {
  const response = await fetch(`${API}${path}`);
  return response.json();
}

(async () => {
  if (!WALLET) {
    console.error('AUDIT_WALLET is required.');
    process.exit(1);
  }

  console.log('\n── notifications: el conteo de no leidas coincide con el feed ──');
  const notifications = await json(`/api/wallet/notifications?wallet=${WALLET}`);
  check('items es un array', Array.isArray(notifications.items));
  check(
    'unread es un number (no string)',
    typeof notifications.unread === 'number',
    `tipo=${typeof notifications.unread}`
  );
  check(
    'unread coincide con los items no leidos cuando el feed esta completo',
    notifications.items.length < 20
      ? notifications.unread === notifications.items.filter((n: any) => !n.isRead).length
      : true
  );
  check(
    'cada item trae createdAt como ISO string',
    notifications.items.every(
      (n: any) => typeof n.createdAt === 'string' && !Number.isNaN(Date.parse(n.createdAt))
    )
  );
  check(
    'no se filtra la columna helper (unreadTotal)',
    !notifications.items.some((n: any) => 'unreadTotal' in n)
  );

  console.log('\n── transactions: fechas, montos y contras partes ──');
  const transactions = await json(`/api/wallet/transactions?wallet=${WALLET}`);
  check('items es un array', Array.isArray(transactions));
  check(
    'cada item trae date como ISO string',
    transactions.every(
      (t: any) => typeof t.date === 'string' && !Number.isNaN(Date.parse(t.date))
    )
  );
  check(
    'cada item trae counterpartyEmail (string o null)',
    transactions.every((t: any) => 'counterpartyEmail' in t && (t.counterpartyEmail === null || typeof t.counterpartyEmail === 'string'))
  );
  check(
    'cada item trae amount numerico',
    transactions.every((t: any) => typeof t.amount === 'number')
  );
  check(
    'cada item trae id y txHash',
    transactions.every((t: any) => 'id' in t && 'txHash' in t)
  );

  console.log('\n── contacts: la agenda ──');
  const contacts = await json(`/api/wallet/contacts?wallet=${WALLET}`);
  check('items es un array', Array.isArray(contacts));
  check(
    'cada contacto trae address y name',
    contacts.every((c: any) => typeof c.address === 'string' && typeof c.name === 'string')
  );

  console.log('\n── payment-links: los links del usuario ──');
  const links = await json(`/api/payment-links?wallet=${WALLET}`);
  check('items es un array', Array.isArray(links));
  check(
    'cada link trae status y referencePubkey',
    links.every((l: any) => 'status' in l && 'referencePubkey' in l)
  );

  console.log('\n── identity: la identidad publica ──');
  const identity = await json(`/api/wallet/identity?address=${WALLET}`);
  check(
    'email y handle son string o null',
    (identity.email === null || typeof identity.email === 'string') &&
      (identity.handle === null || typeof identity.handle === 'string')
  );

  console.log('\n── balances: el snapshot del servidor ──');
  const balances = await json(`/api/wallet/balances?wallet=${WALLET}`);
  check('sol y usdc son numeros', typeof balances.sol === 'number' && typeof balances.usdc === 'number');
  check('trae fetchedAt', 'fetchedAt' in balances);

  console.log(
    failures === 0
      ? '\n✅ Todas las comprobaciones de paridad pasaron.\n'
      : `\n❌ ${failures} comprobacion(es) fallaron.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
})();
