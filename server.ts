/**
 * ReWallet read-only local wallet API server.
 *
 * Thin Express wrapper over persisted SQLite wallet records. Runs on port 3001.
 *
 * Usage:
 *   npm run db:migrate
 *   npm run api            # then npm run dev in another terminal
 */

import express from 'express';
import path from 'node:path';

import {
  countUnreadNotifications,
  getPrimaryUser,
  getWalletSnapshot,
  listNotifications,
  listTransactions,
  setUserLanguage,
} from './src/services/wallet';

const app = express();
const PORT = Number(process.env.API_PORT ?? 3001);
const HOST = process.env.API_HOST ?? '127.0.0.1';

app.use(express.json());

// Permissive CORS for local development (vite dev server on another port).
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,PATCH,OPTIONS');
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
    return res.status(404).json({ error: 'No wallet data is available.' });
  }
  res.json(snapshot);
});

app.get('/api/wallet/transactions', async (_req, res) => {
  const user = await getPrimaryUser();
  if (!user) return res.status(404).json({ error: 'No wallet data is available.' });
  res.json(await listTransactions(user.id));
});

app.get('/api/wallet/notifications', async (_req, res) => {
  const user = await getPrimaryUser();
  if (!user) return res.status(404).json({ error: 'No wallet data is available.' });
  res.json({
    unread: await countUnreadNotifications(user.id),
    items: await listNotifications(user.id),
  });
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
  console.log(`   GET  /api/wallet/transactions\n`);
});
