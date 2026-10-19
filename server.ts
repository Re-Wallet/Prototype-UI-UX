/**
 * ReWallet local wallet API server.
 *
 * Express wrapper over persisted SQLite wallet records. Runs on port 3001.
 * Serves the read API for the UI, the Dynamic webhook receiver, and the
 * periodic chain sweeper that keeps `transactions` fresh where webhooks do
 * not reach (failed transactions are invisible to `wallet.activity`).
 *
 * Usage:
 *   npm run db:migrate
 *   npm run api            # then npm run dev in another terminal
 *
 * Environment:
 *   DYNAMIC_WEBHOOK_SECRET  HMAC secret for x-dynamic-signature-256. Without
 *                           it the signature check is skipped (dev only).
 *   SWEEPER_DISABLED=1      Disables the periodic history sweep.
 */

import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

import express, { type Request, type Response } from 'express';
import path from 'node:path';

import {
  countUnreadNotifications,
  getPrimaryUser,
  getPrimaryUser as getPrimaryUserProfile,
  getWalletSnapshot,
  getUserByPubkey,
  insertPendingTransfer,
  listNotifications,
  listRecentRecipients,
  listTransactions,
  markNotificationsRead,
  setUserLanguage,
  upsertContactByPubkey,
} from './src/services/wallet';
import { getBalances } from './src/services/balanceCache';
import { syncAllWallets } from './src/services/historySync';
import {
  markWebhookProcessed,
  parseEnvelope,
  parseWalletActivity,
  projectWalletActivity,
  recordWebhookDelivery,
  verifyDynamicSignature,
} from './src/services/webhookIngestor';

const app = express();
const PORT = Number(process.env.API_PORT ?? 3001);
const HOST = process.env.API_HOST ?? '127.0.0.1';

/**
 * `express.json` must keep the exact request bytes: Dynamic signs the RAW
 * body, and `JSON.stringify(parsed)` does not byte-match it in general.
 */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

// Base58 pubkey check: Solana addresses are 32-44 chars of the base58 alphabet.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = Buffer.from(buf);
    },
  })
);

// Permissive CORS for local development (vite dev server on another port).
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-dynamic-signature-256');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ============================================================================
// DYNAMIC WEBHOOK (write path — confirmations arrive here)
// ============================================================================

/**
 * `wallet.activity` receiver. Dynamic documents a <15s ack SLA and retries
 * only twice before auto-disabling the endpoint, so the handler:
 *   1. verifies the HMAC signature over the raw bytes,
 *   2. records the delivery (idempotent on `messageId`),
 *   3. ACKs 200 immediately,
 *   4. projects into `transactions` asynchronously.
 */
app.post('/api/webhooks/dynamic', async (req: RawBodyRequest, res: Response) => {
  const rawBody = req.rawBody;
  if (!rawBody || rawBody.length === 0) {
    return res.status(400).json({ error: 'empty body' });
  }

  const secret = process.env.DYNAMIC_WEBHOOK_SECRET;
  const signature = req.header('x-dynamic-signature-256') ?? undefined;
  const verdict = verifyDynamicSignature(rawBody, signature, secret);
  if (!verdict.ok) {
    console.warn(`[webhook] rejected: ${verdict.reason}`);
    return res.status(401).json({ error: verdict.reason });
  }
  if (verdict.skipped) {
    console.warn('[webhook] signature check SKIPPED — DYNAMIC_WEBHOOK_SECRET is not set');
  }

  let parsed: ReturnType<typeof parseEnvelope>;
  try {
    parsed = parseEnvelope(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid JSON' });
  }
  if (!parsed) return res.status(400).json({ error: 'missing messageId or eventName' });

  const { envelope, data } = parsed;
  const activity = envelope.eventName === 'wallet.activity' ? parseWalletActivity(data) : null;
  const transactionHash = activity?.transactionHash ?? null;

  const delivery = await recordWebhookDelivery(envelope, transactionHash, rawBody.toString('utf8'));
  if (delivery.duplicate) {
    console.log(`[webhook] duplicate messageId=${envelope.messageId} — acked, not reprojected`);
    return res.status(200).json({ ok: true, duplicate: true });
  }

  // Ack before projecting: the projection can wait, Dynamic's retry cannot.
  res.status(200).json({ ok: true });

  try {
    if (envelope.eventName === 'wallet.activity') {
      if (!activity) {
        await markWebhookProcessed(delivery.id, 'unparseable wallet.activity payload');
        console.warn(`[webhook] unparseable wallet.activity messageId=${envelope.messageId}`);
        return;
      }
      const result = await projectWalletActivity(envelope, activity);
      await markWebhookProcessed(delivery.id);
      console.log(
        `[webhook] projected ${result.projected} movement(s) for ${transactionHash}` +
          (result.ignored ? ` (${result.ignored})` : '')
      );
    } else {
      // ping / wallet.activity.registered / anything else: acknowledge only.
      await markWebhookProcessed(delivery.id);
      console.log(`[webhook] acked non-activity event "${envelope.eventName}"`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markWebhookProcessed(delivery.id, message).catch(() => undefined);
    console.error(`[webhook] projection failed messageId=${envelope.messageId}: ${message}`);
  }
});

// ============================================================================
// HEALTH
// ============================================================================

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'rewallet-prototype-api',
    cluster: process.env.VITE_SOLANA_CLUSTER ?? 'devnet',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// WALLET
// ============================================================================

app.get('/api/wallet', async (_req, res) => {
  const snapshot = await getWalletSnapshot();
  if (!snapshot) {
    return res.status(404).json({ error: 'No wallet data is available.' });
  }
  res.json(snapshot);
});

app.get('/api/wallet/transactions', async (req, res) => {
  // Scoped by the caller's wallet so a multi-user DB never mixes histories.
  // Falls back to the primary user for older callers that omit the param.
  const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
  const user = wallet ? await getUserByPubkey(wallet) : await getPrimaryUser();
  if (!user) return res.status(404).json({ error: 'No wallet data is available.' });
  res.json(await listTransactions(user.id));
});

/**
 * Send-time state persistence: the client records a transfer as `pending`
 * right after signing, so the sender's history is real before any webhook
 * or sweep lands. The webhook projection later upserts the same
 * `(user, referenceId)` row with `completed`.
 */
app.post('/api/wallet/transactions/pending', async (req, res) => {
  const { wallet, signature, counterpartyPubkey, amountUsdc, assetSymbol, note } = req.body ?? {};
  if (typeof wallet !== 'string' || !BASE58_RE.test(wallet.trim())) {
    return res.status(400).json({ error: "wallet must be the sender's base58 Solana address." });
  }
  if (typeof signature !== 'string' || signature.trim().length < 32) {
    return res.status(400).json({ error: 'signature must be the base58 transaction signature.' });
  }
  if (typeof counterpartyPubkey !== 'string' || !BASE58_RE.test(counterpartyPubkey.trim())) {
    return res.status(400).json({ error: 'counterpartyPubkey must be a base58 Solana address.' });
  }
  if (typeof amountUsdc !== 'number' || !Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    return res.status(400).json({ error: 'amountUsdc must be a positive number.' });
  }
  if (assetSymbol !== undefined && assetSymbol !== 'USDC' && assetSymbol !== 'SOL') {
    return res.status(400).json({ error: 'assetSymbol must be "USDC" or "SOL".' });
  }

  const user = await getUserByPubkey(wallet.trim());
  if (!user) return res.status(404).json({ error: 'The sending wallet is not registered.' });

  const row = await insertPendingTransfer(user.id, {
    signature: signature.trim(),
    counterpartyPubkey: counterpartyPubkey.trim(),
    amountUsdc,
    assetSymbol: assetSymbol ?? 'USDC',
    note: typeof note === 'string' ? note : null,
  });
  res.status(row ? 200 : 500).json(row ?? { error: 'Could not persist the pending transfer.' });
});

/**
 * Notification feed for the signed-in wallet (bell in the Header).
 * Scoped by `wallet` like the transaction history so a multi-user DB never
 * mixes feeds; falls back to the primary user for older callers.
 */
app.get('/api/wallet/notifications', async (req, res) => {
  const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
  const user = wallet ? await getUserByPubkey(wallet) : await getPrimaryUser();
  if (!user) {
    // Unregistered wallet: an empty feed is not an error.
    return res.json({ unread: 0, items: [] });
  }
  res.json({
    unread: await countUnreadNotifications(user.id),
    items: await listNotifications(user.id),
  });
});

/**
 * Mark notifications read once the user opens the feed. Body:
 * `{ wallet, ids? }` — omit `ids` to clear the whole feed.
 */
app.post('/api/wallet/notifications/read', async (req, res) => {
  const { wallet, ids } = req.body ?? {};
  if (typeof wallet !== 'string' || !BASE58_RE.test(wallet.trim())) {
    return res.status(400).json({ error: 'wallet must be the base58 Solana address.' });
  }
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'number'))) {
    return res.status(400).json({ error: 'ids must be an array of notification ids.' });
  }

  const user = await getUserByPubkey(wallet.trim());
  if (!user) return res.status(404).json({ error: 'The wallet is not registered.' });

  const unread = await markNotificationsRead(user.id, ids);
  res.json({ unread });
});

// ============================================================================
// CONTACTS (Transfer screen recent recipients)
// ============================================================================

// Contacts are scoped to the authenticated session: the client sends the
// Dynamic wallet address so each user sees only the recipients THEY sent to.
app.get('/api/wallet/contacts', async (req, res) => {
  const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
  if (!BASE58_RE.test(wallet)) {
    return res.status(400).json({ error: 'wallet query param must be a base58 Solana address.' });
  }
  const user = await getUserByPubkey(wallet);
  // Unregistered wallet: empty address book (not an error).
  if (!user) return res.json([]);
  res.json(await listRecentRecipients(user.id));
});

app.get('/api/wallet/balances', async (req, res) => {
  const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
  if (!BASE58_RE.test(wallet)) {
    return res.status(400).json({ error: 'wallet query param must be a base58 Solana address.' });
  }
  // `fresh=1` bypasses the cache: callers that just broadcast a transaction use
  // it so the follow-up read is not served pre-transfer values.
  const force = req.query.fresh === '1' || req.query.fresh === 'true';
  try {
    res.json(await getBalances(wallet, force));
  } catch (error) {
    console.error('⚠️  /api/wallet/balances:', error);
    res.status(502).json({ error: 'No se pudo leer el saldo de la red.' });
  }
});

/**
 * Public identity for a wallet address: the registered email/handle so the
 * payment page can show "Pagar a {email}" instead of a raw pubkey. Unknown
 * addresses answer nulls (not an error) and the client falls back.
 */
app.get('/api/wallet/identity', async (req, res) => {
  const address = typeof req.query.address === 'string' ? req.query.address.trim() : '';
  if (!BASE58_RE.test(address)) {
    return res.status(400).json({ error: 'address query param must be a base58 Solana address.' });
  }
  const user = await getUserByPubkey(address);
  res.json({ email: user?.email ?? null, handle: user?.handle ?? null });
});

app.post('/api/wallet/contacts', async (req, res) => {
  const { wallet, publicKey, name } = req.body ?? {};
  if (typeof wallet !== 'string' || !BASE58_RE.test(wallet.trim())) {
    return res.status(400).json({ error: 'wallet must be the sender\'s base58 Solana address.' });
  }
  if (typeof publicKey !== 'string' || !BASE58_RE.test(publicKey.trim())) {
    return res.status(400).json({ error: 'publicKey must be a base58 Solana address.' });
  }
  if (name !== undefined && typeof name !== 'string') {
    return res.status(400).json({ error: 'name must be a string.' });
  }

  const user = await getUserByPubkey(wallet.trim());
  if (!user) {
    return res.status(404).json({ error: 'The sending wallet is not registered.' });
  }

  const contact = await upsertContactByPubkey(user.id, publicKey, name);
  res.status(contact ? 200 : 400).json(contact ?? { error: 'Could not save the recipient.' });
});

// ============================================================================
// SETTINGS
// ============================================================================

app.patch('/api/settings/language', async (req, res) => {
  const user = await getPrimaryUser();
  if (!user) return res.status(404).json({ error: 'No wallet data is available.' });

  const { language } = req.body ?? {};
  if (language !== 'en' && language !== 'es') {
    return res.status(400).json({ error: 'language must be "en" or "es"' });
  }

  await setUserLanguage(user.id, language);
  res.json({ language });
});

// ============================================================================
// STATIC (production build)
// ============================================================================

if (process.env.NODE_ENV === 'production') {
  const distDir = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(PORT, HOST, () => {
  console.log(`\n🚀 ReWallet prototype API listening on http://localhost:${PORT}`);
  console.log(`   GET  /api/health`);
  console.log(`   GET  /api/wallet`);
  console.log(`   GET  /api/wallet/transactions?wallet=<address>`);
  console.log(`   POST /api/wallet/transactions/pending`);
  console.log(`   POST /api/webhooks/dynamic`);
  console.log(`   GET  /api/wallet/contacts`);
  console.log(`   POST /api/wallet/contacts`);
  console.log(`   GET  /api/wallet/balances?wallet=<address>&fresh=1`);
  console.log(`   GET  /api/wallet/notifications?wallet=<address>`);
  console.log(`   POST /api/wallet/notifications/read\n`);

  startHistorySweeper();
});

/**
 * Periodic RPC sweep over every registered wallet.
 *
 * Webhooks only fire for CONFIRMED transactions (and never for failures), so
 * the sweeper is the safety net that keeps `transactions` complete and
 * eventually corrects anything the webhook path missed. A re-entrancy guard
 * keeps overlapping runs from stacking when one sweep is slow.
 *
 * Tune with SWEEPER_INTERVAL_MS (default 120s); disable with SWEEPER_DISABLED=1.
 */
function startHistorySweeper(): void {
  if (process.env.SWEEPER_DISABLED === '1') {
    console.log('   ⏹  history sweeper disabled (SWEEPER_DISABLED=1)\n');
    return;
  }

  const intervalMs = Number(process.env.SWEEPER_INTERVAL_MS ?? 120_000);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const results = await syncAllWallets(500);
      const changed = results.filter((r) => r.inserted + r.updated > 0);
      if (changed.length > 0) {
        console.log(
          `[sweeper] ${changed.length}/${results.length} wallet(s) updated: ` +
            changed
              .map((r) => `${r.publicKey.slice(0, 8)}… (+${r.inserted}/~${r.updated})`)
              .join(', ')
        );
      }
    } catch (error) {
      console.error(
        `[sweeper] run failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      running = false;
    }
  };

  setTimeout(tick, 5_000); // first pass shortly after boot
  setInterval(tick, intervalMs);
  console.log(`   🧹 history sweeper every ${intervalMs / 1000}s\n`);
}
