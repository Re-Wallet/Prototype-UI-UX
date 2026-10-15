/**
 * ReWallet Prototype API server.
 *
 * Thin Express wrapper over the wallet service layer. Runs on port 3001 and
 * exposes the same data contracts the UI already consumes, so screens can move
 * from mock data to the database without changing their state shape.
 *
 * Usage:
 *   npm run db:push && npm run db:seed
 *   npm run api            # then npm run dev in another terminal
 */

import express from 'express';
import path from 'node:path';

import {
  adjustBalance,
  countUnreadNotifications,
  createPaymentLink,
  getPrimaryUser,
  getWalletSnapshot,
  listNotifications,
  listTransactions,
  markPaymentLinkPaid,
  recordTransaction,
  setUserLanguage,
} from './src/services/wallet';
import { generateReferenceId } from './src/lib/devnet';

const app = express();
const PORT = Number(process.env.API_PORT ?? 3001);

app.use(express.json());

// Permissive CORS for local development (vite dev server on another port).
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
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
    return res.status(404).json({ error: 'No user seeded. Run: npm run db:seed' });
  }
  res.json(snapshot);
});

app.get('/api/wallet/transactions', async (_req, res) => {
  const user = await getPrimaryUser();
  if (!user) return res.status(404).json({ error: 'No user seeded' });
  res.json(await listTransactions(user.id));
});

app.get('/api/wallet/notifications', async (_req, res) => {
  const user = await getPrimaryUser();
  if (!user) return res.status(404).json({ error: 'No user seeded' });
  res.json({
    unread: await countUnreadNotifications(user.id),
    items: await listNotifications(user.id),
  });
});

// ============================================================================
// TRANSACTIONS
// ============================================================================

app.post('/api/transactions', async (req, res) => {
  const user = await getPrimaryUser();
  if (!user) return res.status(404).json({ error: 'No user seeded' });

  const {
    type,
    amountUsdc,
    counterpartyHandle,
    counterpartyName,
    note,
    method,
    network,
  } = req.body ?? {};

  if (!type || typeof amountUsdc !== 'number' || amountUsdc <= 0) {
    return res.status(400).json({ error: 'type and positive amountUsdc are required' });
  }

  const incoming = type === 'deposit' || type === 'received';

  const transaction = await recordTransaction({
    userId: user.id,
    type,
    status: 'completed',
    amountUsdc,
    counterpartyHandle,
    counterpartyName,
    note,
    method,
    network,
    referenceId: generateReferenceId(incoming ? 'DEP' : 'MOZ'),
  });

  const balance = await adjustBalance(user.id, incoming ? amountUsdc : -amountUsdc);

  res.status(201).json({ transaction, balance });
});

// ============================================================================
// PAYMENT LINKS
// ============================================================================

app.post('/api/payment-links', async (req, res) => {
  const user = await getPrimaryUser();
  if (!user) return res.status(404).json({ error: 'No user seeded' });

  const { concept, amountUsdc, clientName } = req.body ?? {};
  if (!concept) return res.status(400).json({ error: 'concept is required' });

  const slug = `${String(concept)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)}-${Date.now().toString(36)}`;

  const link = await createPaymentLink({
    userId: user.id,
    slug,
    referencePubkey: user.publicKey,
    amountUsdc: typeof amountUsdc === 'number' ? amountUsdc : null,
    concept,
    clientName,
  });

  res.status(201).json({
    ...link,
    url: `https://rewallet.app/pay/${user.handle.replace('@', '')}/${slug}`,
  });
});

app.post('/api/payment-links/:id/simulate-payment', async (req, res) => {
  const user = await getPrimaryUser();
  if (!user) return res.status(404).json({ error: 'No user seeded' });

  const linkId = Number(req.params.id);
  if (!Number.isFinite(linkId)) {
    return res.status(400).json({ error: 'Invalid link id' });
  }

  const { amountUsdc, payerName } = req.body ?? {};
  const amount = typeof amountUsdc === 'number' ? amountUsdc : null;
  if (amount === null || amount <= 0) {
    return res.status(400).json({ error: 'amountUsdc is required' });
  }

  await markPaymentLinkPaid(linkId, user.publicKey, amount);

  const transaction = await recordTransaction({
    userId: user.id,
    type: 'received',
    status: 'completed',
    amountUsdc: amount,
    counterpartyName: payerName,
    method: 'ReWallet Payment Link',
    network: 'solana',
    referenceId: generateReferenceId('PAY'),
    paymentLinkId: linkId,
    note: payerName ? `Cobro pagado por ${payerName}` : 'Cobro por payment link',
  });

  const balance = await adjustBalance(user.id, amount);

  res.json({ transaction, balance });
});

// ============================================================================
// SETTINGS
// ============================================================================

app.patch('/api/settings/language', async (req, res) => {
  const user = await getPrimaryUser();
  if (!user) return res.status(404).json({ error: 'No user seeded' });

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

app.listen(PORT, () => {
  console.log(`\n🚀 ReWallet prototype API listening on http://localhost:${PORT}`);
  console.log(`   GET  /api/health`);
  console.log(`   GET  /api/wallet`);
  console.log(`   POST /api/transactions`);
  console.log(`   POST /api/payment-links\n`);
});
