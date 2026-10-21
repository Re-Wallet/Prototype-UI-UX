/**
 * ReWallet local wallet API server.
 *
 * Express wrapper over persisted wallet records (Neon Postgres). Runs on port
 * 3001. Serves the read API for the UI, the Dynamic webhook receiver, and the
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
 *   DYNAMIC_API_TOKEN       Dashboard API token for the landing metrics
 *                           topline (scope environment.analytics.read).
 *   DYNAMIC_ENVIRONMENT_ID  Environment UUID (falls back to
 *                           VITE_DYNAMIC_ENVIRONMENT_ID).
 *   DYNAMIC_METRICS_TTL_MS  Landing metrics snapshot TTL (default 5 min).
 *   SWEEPER_DISABLED=1      Disables the periodic history sweep.
 */

import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  countUnreadNotifications,
  getWalletSnapshot,
  getUserByPubkey,
  insertPendingTransfer,
  listNotifications,
  listRecentRecipients,
  listNotificationsWithUnread,
  listTransactions,
  markNotificationsRead,
  setUserLanguage,
  upsertContactByPubkey,
} from './src/services/wallet';
import { assetBySymbol, chain, confirmTransferToRecipient, type Address } from './src/adapters';
import { getBalances } from './src/services/balanceCache';
import { cacheKey, getCached } from './src/services/readCache';
import { getUserIdByPubkey } from './src/services/userCache';
import { dbQueryCounter } from './src/services/dbMetrics';
import { getSignatureFeePayer, verifySignatureOwnership } from './src/services/signatureOwnership';
import { pacedRpc } from './src/services/rpcThrottle';
import { getLandingMetrics } from './src/services/dynamicMetrics';
import { buildLandingMetricsResponse, getLedgerMetrics } from './src/services/ledgerMetrics';
import { syncAllWallets } from './src/services/historySync';
import { noteCleanSweep, noteRateLimit } from './src/services/rpcThrottle';
import { sealLiveTransactions, sealLivePaymentLinks } from './src/services/realtimeServer';
import {
  claimPaymentLinkByReference,
  createPaymentLink,
  getPaymentLinkRecipient,
  getPaymentLinkByReference,
  getPaymentLinkBySlug,
  listPaymentLinks,
  expireStalePaymentLinks,
} from './src/services/paymentLinks';
import {
  markWebhookProcessed,
  parseEnvelope,
  parseWalletActivity,
  projectWalletActivity,
  recordWebhookDelivery,
  verifyDynamicSignature,
} from './src/services/webhookIngestor';
import { eq } from 'drizzle-orm';

import { db, pool, warmPool } from './src/db';
import { landingSurveyResponses, users as usersTable } from './src/db/schema';
import {
  BASE58_RE,
  createCorsMiddleware,
  createDynamicSessionVerifier,
  createRateLimiter,
  defaultAllowedOrigins,
  parseOriginPatterns,
  requireSessionFor,
  securityHeaders,
  walletFromBody,
  walletFromQuery,
} from './src/server/security';

const app = express();
/**
 * Process-level guards.
 *
 * The API is the single point of contact for the wallet app: if one RPC read
 * rejects — the public devnet endpoint answers bursts with 429 — an
 * unhandled rejection would terminate the process and take every open screen
 * down with it. A rejected promise is a failed request, not a fatal error.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[process] uncaught exception:', error);
});

const PORT = Number(process.env.API_PORT ?? 3001);
const HOST = process.env.API_HOST ?? '127.0.0.1';

/**
 * `express.json` must keep the exact request bytes: Dynamic signs the RAW
 * body, and `JSON.stringify(parsed)` does not byte-match it in general.
 */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = Buffer.from(buf);
    },
  })
);

// ============================================================================
// SECURITY LAYER
// ============================================================================

/**
 * The Dynamic environment this deployment belongs to.
 *
 * It is also the path of the signing keys, so a token minted by another
 * Dynamic environment cannot verify here even when it is copied verbatim.
 */
const DYNAMIC_ENVIRONMENT_ID =
  process.env.DYNAMIC_ENVIRONMENT_ID ?? process.env.VITE_DYNAMIC_ENVIRONMENT_ID ?? '';

/**
 * The session verifier.
 *
 * A deployment without an environment id cannot verify anything, so every
 * user-scoped route answers 401. That is the safe default: an API that
 * cannot authenticate must not pretend it can.
 */
const sessionVerifier = createDynamicSessionVerifier({
  environmentId: DYNAMIC_ENVIRONMENT_ID,
});

/**
 * The origins allowed to call this API.
 *
 * The local dev servers are always allowed; a deployment adds its own
 * through `APP_ORIGINS` (comma-separated, one wildcard segment allowed).
 */
const allowedOrigins = [
  ...defaultAllowedOrigins(),
  ...parseOriginPatterns(process.env.APP_ORIGINS),
];

/**
 * The gate for a user-scoped route.
 *
 * A verified session that controls the wallet the route is about. Both
 * checks run before the handler, so an unauthenticated request never
 * reaches the database.
 */
const sessionGate = (read: (req: Request) => unknown) => requireSessionFor(sessionVerifier, read);

/**
 * Rate limits, in requests per minute, per caller.
 *
 * The tiers follow what each route actually *costs*, not what it returns:
 *
 * - `CLAIM` (10): the endpoint verifies the transfer on-chain with up to
 *   seven paced RPC reads, so it is the one route where a caller spends the
 *   shared Solana RPC budget. Ten a minute leaves room for a real payer
 *   retrying a slow transaction and still stops a spammer.
 * - `CREATE_LINK` (30): a merchant creates charge links in bursts while
 *   preparing an invoice, but never in the hundreds.
 * - `WRITE` (60): marking notifications read or saving a contact is cheap,
 *   and the app batches them behind a poll.
 * - `READ` (120): the poll alone is two requests a minute per open tab, so
 *   the read tier has to leave room for several tabs plus the focus
 *   refetches.
 *
 * These counters live in the process, so the authoritative limit is a
 * Cloudflare WAF rate-limiting rule at the edge; this is the
 * application-level floor.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const CLAIM_RATE_LIMIT = 10;
const CREATE_LINK_RATE_LIMIT = 30;
const WRITE_RATE_LIMIT = 60;
const READ_RATE_LIMIT = 120;

const claimRateLimit = createRateLimiter({ limit: CLAIM_RATE_LIMIT, windowMs: RATE_LIMIT_WINDOW_MS });
const createLinkRateLimit = createRateLimiter({
  limit: CREATE_LINK_RATE_LIMIT,
  windowMs: RATE_LIMIT_WINDOW_MS,
});
const writeRateLimit = createRateLimiter({ limit: WRITE_RATE_LIMIT, windowMs: RATE_LIMIT_WINDOW_MS });
const readRateLimit = createRateLimiter({ limit: READ_RATE_LIMIT, windowMs: RATE_LIMIT_WINDOW_MS });

// Security headers first, so every response carries them — including the
// preflight answers below.
app.use(securityHeaders({ hsts: process.env.NODE_ENV === 'production' }));

// The CORS allowlist replaces the old wildcard.
app.use(createCorsMiddleware({ allowedOrigins }));

// Counts the database round-trips of each request and publishes the total in
// the `X-DB-Queries` header. With a remote database every round-trip costs a
// network RTT, so the query count is the metric that decides whether an
// endpoint is fast.
app.use(dbQueryCounter);

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

  // Fail CLOSED when no secret is configured.
  //
  // Without a secret the endpoint cannot authenticate the sender, and an
  // unauthenticated webhook writes rows into the transaction ledger. That
  // was only safe because the secret happened to be in the local env — a
  // fresh deploy that forgot it would have accepted forged transfers.
  //
  // Local development without Dynamic can opt into unsigned mode
  // explicitly with ALLOW_UNSIGNED_WEBHOOK=1.
  const allowUnsigned = process.env.ALLOW_UNSIGNED_WEBHOOK === '1';
  if (!secret?.trim() && !allowUnsigned) {
    console.error(
      '[webhook] DYNAMIC_WEBHOOK_SECRET is not set — rejecting. Set the secret, or opt into unsigned mode with ALLOW_UNSIGNED_WEBHOOK=1 for local development.'
    );
    return res.status(503).json({ error: 'webhook not configured' });
  }

  const verdict = verifyDynamicSignature(rawBody, signature, secret);
  if (!verdict.ok) {
    console.warn(`[webhook] rejected: ${verdict.reason}`);
    return res.status(401).json({ error: verdict.reason });
  }
  if (verdict.skipped) {
    console.warn(
      '[webhook] signature check SKIPPED — unsigned mode enabled explicitly (ALLOW_UNSIGNED_WEBHOOK=1)'
    );
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

app.get('/api/health', async (_req, res) => {
  // Postgres probe — proves the Neon ledger is reachable.
  //
  // The failure detail stays server-side: a raw driver error names the host,
  // the port and the branch, and a public health endpoint turns that into a
  // map of the infrastructure. The status is enough for a probe.
  let database: { status: string };
  try {
    await pool.query('SELECT 1');
    database = { status: 'ok' };
  } catch (error) {
    console.error('[health] database probe failed:', error);
    database = { status: 'error' };
  }

  // Neon Functions probe — hits the deployed `hello` function.
  const fnUrl = process.env.NEON_FUNCTION_HELLO_BASE_URL;
  let neonFunction: { status: string };
  if (!fnUrl) {
    neonFunction = { status: 'not_configured' };
  } else {
    try {
      const fnRes = await fetch(fnUrl, { signal: AbortSignal.timeout(4000) });
      neonFunction = { status: fnRes.ok ? 'ok' : `http_${fnRes.status}` };
    } catch (error) {
      console.error('[health] neon function probe failed:', error);
      neonFunction = { status: 'error' };
    }
  }

  res.json({
    status: database.status === 'ok' ? 'ok' : 'degraded',
    service: 'rewallet-prototype-api',
    cluster: process.env.VITE_SOLANA_CLUSTER ?? 'devnet',
    database,
    neonFunction,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// WALLET
// ============================================================================

app.get('/api/wallet', sessionGate(walletFromQuery), async (req: Request, res: Response) => {
  // Scoped by the wallet, like every other wallet endpoint. Without the
  // parameter this used to return the PRIMARY user's full profile — email,
  // phone, balance, history and contacts — to anyone who asked.
  const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
  if (!BASE58_RE.test(wallet)) {
    return res.status(400).json({ error: 'wallet query param must be a base58 Solana address.' });
  }
  const userId = await getUserIdByPubkey(wallet);
  if (userId === null) {
    return res.status(404).json({ error: 'No wallet data is available.' });
  }
  const snapshot = await getWalletSnapshot(userId);
  if (!snapshot) {
    return res.status(404).json({ error: 'No wallet data is available.' });
  }
  res.json(snapshot);
});

app.get('/api/wallet/transactions', sessionGate(walletFromQuery), async (req: Request, res: Response) => {
  // Scoped by the caller's wallet so a multi-user DB never mixes histories.
  // Falls back to the primary user for older callers that omit the param.
  const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
  const userId = wallet ? await getUserIdByPubkey(wallet) : null;
  if (userId === null) return res.status(404).json({ error: 'No wallet data is available.' });
  // Cached: the history only changes when a movement lands, and every write
  // path invalidates this key.
  res.json(await getCached(cacheKey.transactions(userId), () => listTransactions(userId)));
});

/**
 * Mint a sealed Neon Realtime capability for this user's transaction list
 * (roadmap: real-time propagation). The browser subscribes through the
 * Realtime WebSocket; inserts/updates to `transactions` that match the
 * query reach the UI without a refetch. The DB query itself never leaves
 * the server — only its encrypted, expiring capability does.
 */
app.post('/api/wallet/transactions/live', sessionGate(walletFromBody), async (req: Request, res: Response) => {
  const wallet = typeof req.body?.wallet === 'string' ? req.body.wallet.trim() : '';
  if (!wallet || !BASE58_RE.test(wallet)) {
    return res.status(400).json({ error: 'wallet body field must be a base58 Solana address.' });
  }
  try {
    const user = await getUserByPubkey(wallet);
    if (!user) return res.status(404).json({ error: 'No wallet data is available.' });
    res.json(await sealLiveTransactions(user.id));
  } catch (error) {
    // Fail soft: without a capability the UI keeps its REST + RPC paths.
    res.status(503).json({
      error: error instanceof Error ? error.message : 'Realtime is not configured.',
    });
  }
});

/**
 * Send-time state persistence: the client records a transfer as `pending`
 * right after signing, so the sender's history is real before any webhook
 * or sweep lands. The webhook projection later upserts the same
 * `(user, referenceId)` row with `completed`.
 */
app.post('/api/wallet/transactions/pending', sessionGate(walletFromBody), writeRateLimit, async (req: Request, res: Response) => {
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

  // Prove the signature belongs to this wallet before writing to its ledger.
  //
  // Without this, anyone who can reach the endpoint can post a row into any
  // wallet's history — a fabricated "sent 999999 USDC" entry in someone
  // else's balance screen.
  const ownership = await verifySignatureOwnership(signature.trim(), wallet.trim());
  if (ownership === 'not-owned') {
    return res.status(403).json({ error: 'signature does not belong to this wallet' });
  }
  if (ownership === 'unknown') {
    // The transaction is not visible yet. The row is optional: the webhook
    // projects the real movement when it lands.
    return res.status(409).json({ error: 'transaction not visible yet' });
  }

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
app.get('/api/wallet/notifications', sessionGate(walletFromQuery), async (req: Request, res: Response) => {
  const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
  const userId = wallet ? await getUserIdByPubkey(wallet) : null;
  if (userId === null) {
    // Unregistered wallet: an empty feed is not an error.
    return res.json({ unread: 0, items: [] });
  }
  // The feed and the unread badge come from one query (the count rides on a
  // window function), and the whole read is cached until a write lands.
  const { items, unread } = await getCached(
    cacheKey.notifications(userId),
    () => listNotificationsWithUnread(userId)
  );
  res.json({ unread, items });
});

/**
 * Mark notifications read once the user opens the feed. Body:
 * `{ wallet, ids? }` — omit `ids` to clear the whole feed.
 */
app.post('/api/wallet/notifications/read', sessionGate(walletFromBody), writeRateLimit, async (req: Request, res: Response) => {
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
app.get('/api/wallet/contacts', sessionGate(walletFromQuery), async (req: Request, res: Response) => {
  const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
  if (!BASE58_RE.test(wallet)) {
    return res.status(400).json({ error: 'wallet query param must be a base58 Solana address.' });
  }
  const userId = await getUserIdByPubkey(wallet);
  // Unregistered wallet: empty address book (not an error).
  if (userId === null) return res.json([]);
  // Read-through cache: the Transfer screen remounts on every tab switch and
  // the address book rarely changes between reads. The wallet → id resolution
  // is cached too, so a warm request touches the database zero times.
  res.json(
    await getCached(cacheKey.contacts(userId), () => listRecentRecipients(userId))
  );
});

app.get('/api/wallet/balances', sessionGate(walletFromQuery), readRateLimit, async (req: Request, res: Response) => {
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

// ============================================================================
// PAYMENT LINKS (single-use charge links)
// ============================================================================

/**
 * Create a single-use charge link.
 *
 * The merchant specifies a recipient (their wallet), an optional fixed amount
 * and a concept. The server generates a unique on-chain reference and a URL
 * slug, persists the row with `status: 'active'`, and returns the reference
 * so the client can embed it in the payment URL.
 */
app.post('/api/payment-links', sessionGate(walletFromBody), createLinkRateLimit, async (req: Request, res: Response) => {
  const { wallet, amountUsdc, concept } = req.body ?? {};
  if (typeof wallet !== 'string' || !BASE58_RE.test(wallet.trim())) {
    return res.status(400).json({ error: 'wallet must be the base58 recipient address.' });
  }
  const user = await getUserByPubkey(wallet);
  if (!user) return res.status(404).json({ error: 'No wallet data is available.' });

  const amount = typeof amountUsdc === 'number' && Number.isFinite(amountUsdc) && amountUsdc > 0
    ? amountUsdc
    : null;
  const conceptStr = typeof concept === 'string' ? concept.trim() : '';
  if (!conceptStr) return res.status(400).json({ error: 'concept is required.' });

  try {
    const link = await createPaymentLink(user.id, {
      recipient: wallet.trim(),
      amountUsdc: amount,
      concept: conceptStr,
    });
    res.json({
      id: link.id,
      slug: link.slug,
      referencePubkey: link.referencePubkey,
      amountUsdc: link.amountUsdc,
      currency: link.currency,
      concept: link.concept,
      status: link.status,
      paidAmountUsdc: link.paidAmountUsdc,
      paidAt: link.paidAt,
      paidByPubkey: link.paidByPubkey,
      paidTxId: link.paidTxId,
      paidTxSignature: link.paidTxSignature,
      expiresAt: link.expiresAt,
      createdAt: link.createdAt,
    });
  } catch (error) {
    console.error('⚠️  POST /api/payment-links:', error);
    res.status(500).json({ error: 'No se pudo crear el enlace de pago.' });
  }
});

/**
 * Fetch a payment link by its on-chain reference (for the /pay page status
 * check) or by its slug (public identifier).
 */
app.get('/api/payment-links/by-reference/:reference', async (req, res) => {
  const reference = typeof req.params.reference === 'string' ? req.params.reference.trim() : '';
  if (!reference) return res.status(400).json({ error: 'reference param is required.' });
  const link = await getPaymentLinkByReference(reference);
  if (!link) return res.status(404).json({ error: 'Enlace no encontrado.' });
  res.json({
    id: link.id,
    slug: link.slug,
    referencePubkey: link.referencePubkey,
    amountUsdc: link.amountUsdc,
    currency: link.currency,
    concept: link.concept,
    status: link.status,
    paidAmountUsdc: link.paidAmountUsdc,
    paidAt: link.paidAt,
    paidByPubkey: link.paidByPubkey,
    paidTxId: link.paidTxId,
      paidTxSignature: link.paidTxSignature,
    expiresAt: link.expiresAt,
    createdAt: link.createdAt,
  });
});

/**
 * Fetch a payment link by slug (public identifier for status checks).
 */
app.get('/api/payment-links/by-slug/:slug', async (req, res) => {
  const slug = typeof req.params.slug === 'string' ? req.params.slug.trim() : '';
  if (!slug) return res.status(400).json({ error: 'slug param is required.' });
  const link = await getPaymentLinkBySlug(slug);
  if (!link) return res.status(404).json({ error: 'Enlace no encontrado.' });
  res.json({
    id: link.id,
    slug: link.slug,
    referencePubkey: link.referencePubkey,
    amountUsdc: link.amountUsdc,
    currency: link.currency,
    concept: link.concept,
    status: link.status,
    paidAmountUsdc: link.paidAmountUsdc,
    paidAt: link.paidAt,
    paidByPubkey: link.paidByPubkey,
    paidTxId: link.paidTxId,
      paidTxSignature: link.paidTxSignature,
    expiresAt: link.expiresAt,
    createdAt: link.createdAt,
  });
});

/**
 * List a user's payment links, newest first.
 */
app.get('/api/payment-links', sessionGate(walletFromQuery), async (req: Request, res: Response) => {
  const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
  if (!BASE58_RE.test(wallet)) {
    return res.status(400).json({ error: 'wallet query param must be a base58 Solana address.' });
  }
  const userId = await getUserIdByPubkey(wallet);
  if (userId === null) return res.json([]);
  // Cached until a link is created or settled.
  res.json(
    await getCached(cacheKey.paymentLinks(userId), () => listPaymentLinks(userId))
  );
});

/**
 * Mint a sealed Neon Realtime capability for this user's payment links.
 *
 * When the webhook settles a link, the `payment_links` row flips to `paid`
 * and the browser learns about it through the Realtime WebSocket — the
 * collector's screen updates to "Pago recibido" without polling. The DB
 * query never leaves the server; only its encrypted, expiring capability does.
 */
app.post('/api/payment-links/live', sessionGate(walletFromBody), async (req: Request, res: Response) => {
  const wallet = typeof req.body?.wallet === 'string' ? req.body.wallet.trim() : '';
  if (!wallet || !BASE58_RE.test(wallet)) {
    return res.status(400).json({ error: 'wallet body field must be a base58 Solana address.' });
  }
  try {
    const user = await getUserByPubkey(wallet);
    if (!user) return res.status(404).json({ error: 'No wallet data is available.' });
    res.json(await sealLivePaymentLinks(user.id));
  } catch (error) {
    // Fail soft: without a capability the UI keeps its REST + polling paths.
    res.status(503).json({
      error: error instanceof Error ? error.message : 'Realtime is not configured.',
    });
  }
});

/**
 * Public identity for a wallet address: the display handle, so the payment
 * page can show "Pagar a {handle}" instead of a raw pubkey. Unknown
 * addresses answer nulls (not an error) and the client falls back.
 *
 * The account e-mail used to be part of this payload. It is not any more:
 * this route is public and its input is an on-chain address, which anybody
 * can enumerate, so publishing the e-mail behind it turned a lookup into a
 * scraper for the user directory. The handle is the name the user chose to
 * publish; the e-mail is not.
 */
app.get('/api/wallet/identity', async (req, res) => {
  const address = typeof req.query.address === 'string' ? req.query.address.trim() : '';
  if (!BASE58_RE.test(address)) {
    return res.status(400).json({ error: 'address query param must be a base58 Solana address.' });
  }
  // The display identity of a wallet changes only when the user edits their
  // profile, so it is cached. Only the display field is read.
  const identity = await getCached(
    cacheKey.identity(address),
    async () => {
      const [row] = await db
        .select({ handle: usersTable.handle })
        .from(usersTable)
        .where(eq(usersTable.publicKey, address))
        .limit(1);
      return { handle: row?.handle ?? null };
    },
    { ttlMs: 300_000 }
  );
  res.json(identity);
});

app.post('/api/wallet/contacts', sessionGate(walletFromBody), writeRateLimit, async (req: Request, res: Response) => {
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

app.patch('/api/settings/language', sessionGate(walletFromBody), writeRateLimit, async (req: Request, res: Response) => {
  // Scoped by the wallet: without it, any caller could rewrite the language
  // of whichever user happens to be first in the table.
  const wallet = typeof req.body?.wallet === 'string' ? req.body.wallet.trim() : '';
  if (!BASE58_RE.test(wallet)) {
    return res.status(400).json({ error: 'wallet body field must be a base58 Solana address.' });
  }
  const userId = await getUserIdByPubkey(wallet);
  if (userId === null) return res.status(404).json({ error: 'No wallet data is available.' });

  const { language } = req.body ?? {};
  if (language !== 'en' && language !== 'es') {
    return res.status(400).json({ error: 'language must be "en" or "es"' });
  }

  await setUserLanguage(userId, language);
  res.json({ language });
});

// ============================================================================
// LANDING METRICS (Dynamic topline, cached)
// ============================================================================

/**
 * The landing's metric strip (users / wallets / sessions) reads from here.
 * Numbers come from Dynamic's Dashboard API but are served from a SQLite
 * snapshot so the token stays server-side and the static landing only ever
 * calls our API. Fail-soft: always 200 with the best snapshot available.
 */
/**
 * Settle the link a payer declared.
 *
 * The payment reference does not travel on-chain, so the webhook can only
 * guess which link a transfer pays — by recipient and amount. It guesses
 * wrong whenever the same recipient has two active links of the same amount:
 * it settles the older one and leaves the shared one payable.
 *
 * The payer, on the other hand, knows exactly which link it opened: the
 * reference is in the URL it was given. This endpoint takes that reference
 * and verifies ON-CHAIN that the transaction really moved the link's amount
 * to its recipient, before settling that specific link.
 */
app.post('/api/payment-links/claim', claimRateLimit, async (req: Request, res: Response) => {
  const { reference, signature } = req.body ?? {};
  if (typeof reference !== 'string' || !reference.trim()) {
    return res.status(400).json({ error: 'reference is required.' });
  }
  if (typeof signature !== 'string' || signature.trim().length < 32) {
    return res.status(400).json({ error: 'signature must be the base58 transaction signature.' });
  }

  const link = await getPaymentLinkByReference(reference.trim());
  if (!link) return res.status(404).json({ error: 'Enlace no encontrado.' });
  if (link.status !== 'active') {
    return res.status(409).json({ error: 'El enlace ya no está disponible.' });
  }
  if (link.amountUsdc === null) {
    return res.status(409).json({ error: 'El enlace no tiene un monto fijo.' });
  }
  // Captured as a local so the narrowing survives into the closure below.
  const amountUsdc = link.amountUsdc;

  const recipient = await getPaymentLinkRecipient(reference.trim());
  if (!recipient) return res.status(404).json({ error: 'El enlace no tiene destinatario.' });

  const asset = assetBySymbol('USDC', chain.network().cluster);
  if (!asset) return res.status(503).json({ error: 'USDC no está configurado.' });

  // The transaction may not be visible the instant it was signed, and the
  // public RPC may answer 429. Both are transient, so the check is retried
  // with a growing delay — a rate-limited read is NOT the same as a
  // transaction that does not exist, and treating it as one would abandon
  // a perfectly good payment.
  let verdict: 'confirmed' | 'not-found' | 'mismatch' = 'not-found';
  let transientFailures = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      // The verification is an RPC read, so it goes through the shared pacing
      // gate: the public devnet endpoint answers bursts with 429, and every
      // RPC read in the process has to share one measured budget.
      verdict = await pacedRpc(() =>
        confirmTransferToRecipient(
          signature.trim(),
          recipient as Address,
          asset,
          amountUsdc
        )
      );
      transientFailures = 0;
    } catch {
      transientFailures += 1;
    }
    if (verdict !== 'not-found') break;
    await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 500));
  }

  if (verdict === 'not-found' && transientFailures > 0) {
    // The RPC was failing, not the transaction. Say so instead of claiming
    // the payment does not exist.
    return res.status(503).json({ error: 'El RPC de Solana no responde, reintenta.' });
  }

  if (verdict !== 'confirmed') {
    return res.status(verdict === 'not-found' ? 409 : 422).json({
      error:
        verdict === 'not-found'
          ? 'La transaccion todavia no es visible.'
          : 'La transaccion no coincide con el cobro.',
    });
  }

  const payer = (await getSignatureFeePayer(signature.trim())) ?? null;
  const settled = await claimPaymentLinkByReference(link.referencePubkey, {
    paidAmountUsdc: amountUsdc,
    paidByPubkey: payer ?? 'unknown',
    paidTxId: null,
    paidTxSignature: signature.trim(),
  });

  res.json({ ok: settled?.status === 'paid', link: settled });
});

/**
 * The tunnel's current public URL.
 *
 * The quick tunnel's hostname changes every time it is restarted. The
 * supervisor writes it to a file; this endpoint publishes it so the browser
 * can build payment links that a payer on another device can open, without
 * the frontend having to be rebuilt with a new URL baked in.
 */
app.get('/api/tunnel', async (_req, res) => {
  const file = process.env.TUNNEL_URL_FILE ?? '/tmp/opencode/tunnel.url';
  try {
    const { readFile } = await import('node:fs/promises');
    const url = (await readFile(file, 'utf8')).trim();
    res.json({ url: url || null });
  } catch {
    res.json({ url: null });
  }
});

/**
 * The landing's metric strip.
 *
 * Two sources, one payload: Dynamic's topline (adoption: users, wallets,
 * sessions) and our own ledger (payments: transactions, volume, success rate,
 * settlement time). The Dynamic fields are served exactly as before, so any
 * consumer of the current shape keeps working; the ledger fields are added
 * on top.
 *
 * Both sources fail soft on their own, and so does this endpoint: a public
 * page gets numbers, never an error.
 */
app.get('/api/landing/metrics', async (_req, res) => {
  try {
    const [dynamic, ledger] = await Promise.all([
      getLandingMetrics(),
      getLedgerMetrics(),
    ]);
    res.json(buildLandingMetricsResponse(dynamic, ledger));
  } catch (error) {
    console.error('⚠️  /api/landing/metrics:', error);
    res.json({
      users: 0,
      wallets: 0,
      sessions: 0,
      transactions: 0,
      volumeUsdc: 0,
      successRate: 0,
      avgProcessingMs: 0,
      fetchedAt: null,
    });
  }
});

// ============================================================================
// LANDING SURVEY (opiniones)
// ============================================================================

/**
 * The landing's "Opinion" section posts here. Answer keys mirror the option
 * values in landing/index.html; q2 is a JSON array (multi-select) and q4 is
 * optional. Validation is duplicated server-side so a crafted client cannot
 * write garbage into `landing_survey_responses`.
 */
const SURVEY_Q1 = new Set(['ahorrar', 'remesas']);
const SURVEY_Q2 = new Set(['efectivo', 'banco', 'apps', 'exchanges', 'sin_dolares']);
const SURVEY_Q3 = new Set(['miedo_claves', 'redes_gas', 'comisiones', 'no_necesito']);
const SURVEY_Q4 = new Set(['lt_50', '50_200', '200_1000', 'gt_1000']);
const SURVEY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/landing/survey', async (req, res) => {
  const { name, lastName, email, q1, q2, q3, q4 } = req.body ?? {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (typeof lastName !== 'string' || !lastName.trim()) {
    return res.status(400).json({ error: 'lastName is required' });
  }
  if (typeof email !== 'string' || !SURVEY_EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'a valid email is required' });
  }
  if (typeof q1 !== 'string' || !SURVEY_Q1.has(q1)) {
    return res.status(400).json({ error: 'q1 is required' });
  }
  if (!Array.isArray(q2) || q2.length === 0 || !q2.every((v) => SURVEY_Q2.has(v))) {
    return res.status(400).json({ error: 'q2 needs at least one option' });
  }
  if (typeof q3 !== 'string' || !SURVEY_Q3.has(q3)) {
    return res.status(400).json({ error: 'q3 is required' });
  }
  if (q4 !== undefined && q4 !== null && q4 !== '' && !SURVEY_Q4.has(q4)) {
    return res.status(400).json({ error: 'q4 has an invalid value' });
  }

  try {
    await db.insert(landingSurveyResponses).values({
      name: name.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      q1,
      q2: JSON.stringify(q2),
      q3,
      q4: q4 || null,
    });
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error('⚠️  POST /api/landing/survey:', error);
    res.status(500).json({ error: 'No se pudo guardar tu respuesta.' });
  }
});

// ============================================================================
// STATIC (production build)
// ============================================================================

if (process.env.NODE_ENV === 'production') {
  const distDir = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

/**
 * Should this process open the listening socket?
 *
 * `API_NO_LISTEN=1` is the explicit opt-out used by the test suite, which
 * mounts the app on an ephemeral port of its own. The entry-point check is
 * the normal path. When the entry point cannot be determined the answer is
 * *yes*: a server that silently does not start is far worse than one that
 * starts twice.
 */
function shouldListen(): boolean {
  if (process.env.API_NO_LISTEN === '1') return false;

  const entry = process.argv[1];
  if (!entry) return true;

  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return true;
  }
}

/**
 * Start the HTTP listener.
 *
 * The app is exported so a test can mount it on an ephemeral port and
 * exercise the real routes — including the ones that must answer 401
 * before they touch the database.
 */
export function startServer(): void {
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
    console.log(`   POST /api/wallet/notifications/read`);
    console.log(`   GET  /api/landing/metrics\n`);

    startHistorySweeper();

    // Warm the database pool in the background: the first user request should
    // not pay for the TCP + TLS handshake to Neon.
    void warmPool();
  });
}

if (shouldListen()) {
  startServer();
}

export { app };

/**
 * Periodic RPC sweep over every registered wallet.
 *
 * Webhooks only fire for CONFIRMED transactions (and never for failures), so
 * the sweeper is the safety net that keeps `transactions` complete and
 * eventually corrects anything the webhook path missed. A re-entrancy guard
 * keeps overlapping runs from stacking when one sweep is slow.
 *
 * The public devnet endpoint rate-limits by burst with no `Retry-After`, so a
 * fixed cadence keeps hitting it while it is already saturated. Instead the
 * interval stretches on failure: after a run that saw 429s the next tick is
 * skipped and the delay doubles (base → 2x → 4x, capped), then collapses back
 * to the base interval after a couple of clean runs. Scheduled with a
 * self-rescheduling timeout rather than `setInterval` so the delay can change
 * between runs.
 *
 * Tune with SWEEPER_INTERVAL_MS (default 300s); disable with SWEEPER_DISABLED=1.
 */
function startHistorySweeper(): void {
  if (process.env.SWEEPER_DISABLED === '1') {
    console.log('   ⏹  history sweeper disabled (SWEEPER_DISABLED=1)\n');
    return;
  }

  const baseIntervalMs = Number(process.env.SWEEPER_INTERVAL_MS ?? 300_000);
  const maxBackoffMs = 30 * 60_000;
  let currentDelayMs = baseIntervalMs;
  let running = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = (delayMs: number) => {
    timer = setTimeout(tick, delayMs);
  };

  function tick(): void {
    if (running) {
      schedule(currentDelayMs);
      return;
    }
    running = true;

    void (async () => {
      try {
        const { results, rateLimited } = await syncAllWallets(500);

        if (rateLimited) {
          noteRateLimit();
          currentDelayMs = Math.min(currentDelayMs * 2, maxBackoffMs);
          console.warn(
            `[sweeper] RPC rate-limited; backing off to ${currentDelayMs / 1000}s`
          );
        } else {
          noteCleanSweep();
          if (currentDelayMs !== baseIntervalMs) {
            currentDelayMs = baseIntervalMs;
            console.log(`[sweeper] RPC healthy again; cadence back to ${baseIntervalMs / 1000}s`);
          }
          const changed = results.filter((r) => r.inserted + r.updated > 0);
          if (changed.length > 0) {
            console.log(
              `[sweeper] ${changed.length}/${results.length} wallet(s) updated: ` +
                changed
                  .map((r) => `${r.publicKey.slice(0, 8)}… (+${r.inserted}/~${r.updated})`)
                  .join(', ')
            );
          }
          // Expire payment links whose `expiresAt` has passed.
          const expired = await expireStalePaymentLinks();
          if (expired > 0) console.log(`[sweeper] ${expired} payment links expirados`);
        }
      } catch (error) {
        console.error(
          `[sweeper] run failed: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        running = false;
        schedule(currentDelayMs);
      }
    })();
  }

  schedule(5_000); // first pass shortly after boot
  console.log(`   🧹 history sweeper every ${baseIntervalMs / 1000}s (adaptive backoff)\n`);
  process.on('SIGTERM', () => clearTimeout(timer));
}
