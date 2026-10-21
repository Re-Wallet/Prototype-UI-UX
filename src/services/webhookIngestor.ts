/**
 * Dynamic webhook ingestor (write path for `wallet.activity`).
 *
 * Receives confirmed on-chain activity for WaaS wallets and projects it into
 * `transactions`, one movement per involved registered wallet. The projection
 * is idempotent on `(user_id, reference_id)` — the same key the sweeper uses —
 * so a webhook, the periodic sweep, and a send-time pending row all converge
 * on the same row instead of duplicating it.
 *
 * Payload facts this module is built on (captured from a real Solana devnet
 * delivery, see discovery notes):
 *   - Two messages per transaction, one per involved wallet, same
 *     `transactionHash`, different `messageId`.
 *   - `events` is `{}` on Solana — `parseWalletTransaction` cannot be reused.
 *   - `metadata.symbol`/`name` are empty strings on Solana; the mint is
 *     resolved against our own registry.
 *   - The payload carries `fee`/`feePayer`/slot/timestamp, so the happy path
 *     needs zero RPC calls.
 *   - `userId` in the envelope is Dynamic's, not ours; the subject wallet is
 *     resolved through `labels` + our `users` table.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { eq, inArray, lt } from 'drizzle-orm';

import { assetByMint, type SupportedCluster } from '../contracts/tokens';
import { db } from '../db';
import { users as usersTable, webhookEvents as webhookEventsTable } from '../db/schema';

import { upsertTransactions, insertNotification, type PersistedMovement } from './wallet';
import { settlePaymentLinkForTransfer } from './paymentLinks';

// ============================================================================
// SIGNATURE VERIFICATION
// ============================================================================

export interface SignatureVerdict {
  ok: boolean;
  reason?: string;
  /** True when no secret is configured and the check was skipped (dev). */
  skipped?: boolean;
}

/**
 * Verify Dynamic's `x-dynamic-signature-256` header: HMAC-SHA256 of the RAW
 * request bytes, `sha256=` prefixed, compared in constant time. The header may
 * carry several space-separated signatures (key rotation); any valid match
 * passes.
 *
 * With no `DYNAMIC_WEBHOOK_SECRET` configured the check is skipped with a
 * warning flag — acceptable for local dev, never for a public endpoint.
 */
export function verifyDynamicSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string | undefined
): SignatureVerdict {
  if (!secret?.trim()) {
    return { ok: true, skipped: true, reason: 'DYNAMIC_WEBHOOK_SECRET not set' };
  }
  if (!signatureHeader?.trim()) {
    return { ok: false, reason: 'missing x-dynamic-signature-256 header' };
  }

  const expected = createHmac('sha256', secret.trim()).update(rawBody).digest('hex');
  const expectedFull = `sha256=${expected}`;
  const expectedBytes = Buffer.from(expectedFull, 'utf8');

  const candidates = signatureHeader.trim().split(/\s+/);
  for (const candidate of candidates) {
    const candidateBytes = Buffer.from(candidate, 'utf8');
    if (
      candidateBytes.length === expectedBytes.length &&
      timingSafeEqual(candidateBytes, expectedBytes)
    ) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'signature mismatch' };
}

// ============================================================================
// PAYLOAD TYPES (structural — only the fields the projection reads)
// ============================================================================

/**
 * The largest transfer the ledger accepts.
 *
 * On devnet an amount this large is not a payment, it is a malformed
 * payload. The bound keeps a bad number from becoming a row that looks
 * real.
 */
const MAX_TRANSFER_AMOUNT = 1e12;

export interface DynamicEnvelope {
  messageId: string;
  eventId?: string | null;
  webhookId?: string | null;
  eventName: string;
  environmentId?: string | null;
  environmentName?: string | null;
  userId?: string | null;
  redelivery?: boolean;
  timestamp?: string | null;
}

interface DynamicAssetTransfer {
  tokenAddress: string;
  fromAddress: string;
  toAddress: string;
  amount: number;
  amountRaw?: string | undefined;
  metadata?: { name?: string; symbol?: string; decimals?: number };
}

export interface DynamicWalletActivity {
  transactionHash: string;
  blockNumber?: number;
  transactionTimestamp?: string;
  blockExplorerUrls?: string[];
  fromAddress: string;
  toAddress: string;
  labels?: string[];
  assetTransfers: DynamicAssetTransfer[];
  chainName?: string;
  networkId?: number;
  fee?: number;
  feePayer?: string;
  transactionError?: string | null;
  type?: string;
}

// ============================================================================
// ENVELOPE PARSING
// ============================================================================

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Parse the shared envelope. Returns null when messageId is absent. */
export function parseEnvelope(raw: string): { envelope: DynamicEnvelope; data: unknown } | null {
  const record = asRecord(JSON.parse(raw));
  if (!record) return null;
  const messageId = asString(record.messageId);
  const eventName = asString(record.eventName);
  if (!messageId || !eventName) return null;

  return {
    envelope: {
      messageId,
      eventId: asString(record.eventId),
      webhookId: asString(record.webhookId),
      eventName,
      environmentId: asString(record.environmentId),
      environmentName: asString(record.environmentName),
      userId: asString(record.userId),
      redelivery: record.redelivery === true,
      timestamp: asString(record.timestamp),
    },
    data: record.data,
  };
}

export function parseWalletActivity(data: unknown): DynamicWalletActivity | null {
  const record = asRecord(data);
  if (!record) return null;

  const transactionHash = asString(record.transactionHash);
  const fromAddress = asString(record.fromAddress);
  const toAddress = asString(record.toAddress);
  if (!transactionHash || !fromAddress || !toAddress) return null;

  const assetTransfers = Array.isArray(record.assetTransfers)
    ? record.assetTransfers
        .map((entry): DynamicAssetTransfer | null => {
          const transfer = asRecord(entry);
          if (!transfer) return null;
          const tokenAddress = asString(transfer.tokenAddress);
          const from = asString(transfer.fromAddress);
          const to = asString(transfer.toAddress);
          const amount = typeof transfer.amount === 'number' ? transfer.amount : null;
          if (!tokenAddress || !from || !to || amount === null) return null;
          // A transfer amount is a positive, finite, bounded number. A zero, a
          // negative, a NaN or an absurd value is a malformed payload, not a
          // movement, and it must not become a row in the ledger.
          if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_TRANSFER_AMOUNT) {
            return null;
          }

          const metadata = asRecord(transfer.metadata);
          return {
            tokenAddress,
            fromAddress: from,
            toAddress: to,
            amount,
            amountRaw: asString(transfer.amountRaw) ?? undefined,
            metadata: metadata
              ? {
                  name: asString(metadata.name) ?? undefined,
                  symbol: asString(metadata.symbol) ?? undefined,
                  decimals: typeof metadata.decimals === 'number' ? metadata.decimals : undefined,
                }
              : undefined,
          };
        })
        .filter((entry): entry is DynamicAssetTransfer => entry !== null)
    : [];

  const labels = Array.isArray(record.labels)
    ? record.labels.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return {
    transactionHash,
    blockNumber: typeof record.blockNumber === 'number' ? record.blockNumber : undefined,
    transactionTimestamp: asString(record.transactionTimestamp) ?? undefined,
    blockExplorerUrls: Array.isArray(record.blockExplorerUrls)
      ? record.blockExplorerUrls.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
    fromAddress,
    toAddress,
    labels,
    assetTransfers,
    chainName: asString(record.chainName) ?? undefined,
    networkId: typeof record.networkId === 'number' ? record.networkId : undefined,
    fee: typeof record.fee === 'number' ? record.fee : undefined,
    feePayer: asString(record.feePayer) ?? undefined,
    transactionError: asString(record.transactionError),
    type: asString(record.type) ?? undefined,
  };
}

// ============================================================================
// DELIVERY LOG (dedupe by messageId)
// ============================================================================

export interface DeliveryRecord {
  id: number;
  duplicate: boolean;
}

/**
 * Append one delivery to `webhook_events`. `messageId` is Dynamic's documented
 * idempotency key (a redelivery reuses it; `eventId` does not — one event can
 * fan out to several messages).
 */
export async function recordWebhookDelivery(
  envelope: DynamicEnvelope,
  transactionHash: string | null,
  rawBody: string
): Promise<DeliveryRecord> {
  const inserted = await db
    .insert(webhookEventsTable)
    .values({
      messageId: envelope.messageId,
      eventId: envelope.eventId ?? null,
      webhookId: envelope.webhookId ?? null,
      eventName: envelope.eventName,
      environmentId: envelope.environmentId ?? null,
      dynamicUserId: envelope.userId ?? null,
      transactionHash,
      isRedelivery: envelope.redelivery === true,
      rawJson: rawBody,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEventsTable.id });

  if (inserted.length > 0) return { id: inserted[0].id, duplicate: false };

  const [existing] = await db
    .select({ id: webhookEventsTable.id, processedAt: webhookEventsTable.processedAt })
    .from(webhookEventsTable)
    .where(eq(webhookEventsTable.messageId, envelope.messageId))
    .limit(1);

  // "Seen" is not "processed". A delivery whose projection never completed
  // has to be projectable again: Dynamic redelivers, and the ledger upsert
  // and the link settlement are both idempotent, so the retry converges.
  // Treating an unprocessed delivery as a duplicate dropped the movement for
  // good.
  if (existing && !existing.processedAt) {
    return { id: existing.id, duplicate: false };
  }

  return { id: existing?.id ?? -1, duplicate: true };
}

/**
 * Drop the delivery log entries that are older than `days`.
 *
 * The log is the idempotency ledger for the webhook, so it is never pruned
 * while a delivery can still be projected. Once a delivery is days old, the
 * sweeper has already reconciled the chain, and the row is history.
 *
 * Without this the table grows with every delivery Dynamic ever sends.
 */
export async function pruneWebhookDeliveries(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(webhookEventsTable)
    .where(lt(webhookEventsTable.receivedAt, cutoff))
    .returning({ id: webhookEventsTable.id });
  return deleted.length;
}

export async function markWebhookProcessed(
  deliveryId: number,
  error?: string
): Promise<void> {
  if (deliveryId < 0) return;
  await db
    .update(webhookEventsTable)
    .set({
      processedAt: new Date(),
      ...(error ? { processError: error } : {}),
    })
    .where(eq(webhookEventsTable.id, deliveryId));
}

/**
 * Record that a delivery was understood but NOT applied, and leave it
 * reprojectable.
 *
 * This is the counterpart of `markWebhookProcessed`: it writes the reason
 * and nothing else, so `processed_at` stays null and the delivery can be
 * projected again. A delivery is only consumed once it actually wrote
 * something — a projection that found no registered wallet, or one that
 * failed halfway, has to stay available for the redelivery (or for the
 * sweeper) to pick it up.
 */
export async function markWebhookPending(
  deliveryId: number,
  reason: string
): Promise<void> {
  if (deliveryId < 0) return;
  await db
    .update(webhookEventsTable)
    .set({ processError: reason })
    .where(eq(webhookEventsTable.id, deliveryId));
}

// ============================================================================
// PROJECTION
// ============================================================================

/**
 * What a projection did.
 *
 * The union is the point: a result that wrote nothing ALWAYS carries the
 * reason, so the caller can record WHY instead of a generic placeholder.
 */
export type ProjectionResult =
  | { wrote: true; projected: number; ignored?: undefined }
  | { wrote: false; projected: 0; ignored: string };

const NATIVE_SOL = 'native';

function clusterForNetworkId(networkId: number | undefined): SupportedCluster {
  // Dynamic network ids: 101 = Solana mainnet-beta, 103 = devnet.
  return networkId === 101 ? 'mainnet-beta' : 'devnet';
}

function movementType(symbol: string, outgoing: boolean): PersistedMovement['type'] {
  if (symbol === 'SOL') return outgoing ? 'withdrawal' : 'deposit';
  return outgoing ? 'sent' : 'received';
}

/**
 * Human label for a counterparty: `@handle` when the peer is a registered
 * ReWallet user, otherwise a truncated address. Notifications must never show
 * a raw 44-char base58 string.
 */
function counterpartyLabel(
  peer: { handle: string | null; name: string | null } | undefined,
  address: string
): string {
  if (peer?.handle) return `@${peer.handle}`;
  if (peer?.name) return peer.name;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Direction of a movement, refined beyond sent/received by whether the peer is
 * another ReWallet user. This is the discriminator the notifications key off:
 *
 *   - `transfer`  — peer is a registered ReWallet wallet (in-app P2P)
 *   - `deposit`   — funds arriving from an external wallet
 *   - `withdrawal`— funds leaving to an external wallet
 */
type MovementDirection = 'transfer' | 'deposit' | 'withdrawal';

function movementDirection(outgoing: boolean, peerRegistered: boolean): MovementDirection {
  if (peerRegistered) return 'transfer';
  return outgoing ? 'withdrawal' : 'deposit';
}

/** `directionTitle` mirrors the same three-way split for the transaction label. */
function directionTitle(symbol: string, direction: MovementDirection): string {
  if (direction === 'transfer') return `Transferencia ${symbol}`;
  return `${direction === 'withdrawal' ? 'Retiro' : 'Depósito'} ${symbol}`;
}

/**
 * Which registered wallets this message speaks about.
 *
 * Dynamic emits one message per involved wallet and tags it via `labels`
 * (`["sent"]` on the sender, `["received"]` on the receiver). When labels are
 * absent or ambiguous we fall back to both sides, filtered by registration —
 * which is the same outcome, just less precise.
 */
function resolveSubjects(
  activity: DynamicWalletActivity,
  registered: Map<string, { id: number }>
): string[] {
  const { fromAddress, toAddress, labels = [] } = activity;
  const hasSent = labels.includes('sent');
  const hasReceived = labels.includes('received');

  const candidates =
    hasSent && !hasReceived
      ? [fromAddress]
      : hasReceived && !hasSent
        ? [toAddress]
        : [fromAddress, toAddress];

  return candidates.filter((address) => registered.has(address));
}

/**
 * Project one `wallet.activity` message into `transactions`.
 *
 * Design notes:
 *   - Reference key is `<signature>-<symbol>` — byte-identical to the
 *     sweeper's, so the send-time `pending` row, this projection, and a later
 *     sweep all address the same row and the status flip is a plain upsert.
 *   - The payload's native-SOL entry is skipped whenever the transaction also
 *     moved tokens: in that case it is the recipient's ATA rent, not a user
 *     movement (the exact regression `hasNativeSolTransfer` guards against on
 *     the RPC path).
 *   - `transactionError` populates `failed`/`failed_reason` defensively; on
 *     Solana Dynamic only emits confirmed transactions today, so the normal
 *     outcome is `completed`.
 */
export async function projectWalletActivity(
  envelope: DynamicEnvelope,
  activity: DynamicWalletActivity
): Promise<ProjectionResult> {
  const sides = [...new Set([activity.fromAddress, activity.toAddress])];
  const userRows = await db
    .select({
      id: usersTable.id,
      publicKey: usersTable.publicKey,
      handle: usersTable.handle,
      name: usersTable.name,
    })
    .from(usersTable)
    .where(inArray(usersTable.publicKey, sides));

  const registered = new Map(userRows.map((row) => [row.publicKey, row]));
  const subjects = resolveSubjects(activity, registered);
  if (subjects.length === 0) {
    return { wrote: false, projected: 0, ignored: 'no registered wallet among the transaction parties' };
  }

  const cluster = clusterForNetworkId(activity.networkId);
  const failed = Boolean(activity.transactionError);
  const timestamp = activity.transactionTimestamp
    ? new Date(activity.transactionTimestamp)
    : new Date();
  const explorerUrl = activity.blockExplorerUrls?.[0] ?? null;
  const hasTokenTransfer = activity.assetTransfers.some(
    (transfer) => transfer.tokenAddress !== NATIVE_SOL
  );
  // The payload already ships explorer links with the right cluster query.
  const canonicalExplorerUrl = explorerUrl ? new URL(explorerUrl).toString() : null;

  let projected = 0;
  let projectable = false;

  for (const subject of subjects) {
    const user = registered.get(subject);
    if (!user) continue;

    const outgoing = subject === activity.fromAddress;
    const counterpartyPubkey = outgoing ? activity.toAddress : activity.fromAddress;
    // A peer present in `registered` is another ReWallet user; that turns a
    // generic sent/received into an in-app transfer with a named counterparty.
    const peer = registered.get(counterpartyPubkey);
    const peerRegistered = peer !== undefined;
    const peerLabel = counterpartyLabel(peer, counterpartyPubkey);

    const movements: PersistedMovement[] = [];
    /** Notification copies built alongside the movements, written after the upsert. */
    const notificationDrafts: Array<{
      type: string;
      title: string;
      message: string;
      symbol: string;
      outgoing: boolean;
      amount: number;
    }> = [];

    for (const transfer of activity.assetTransfers) {
      // A wallet that is party to this transfer (some payloads batch transfers
      // where the monitored wallet only participates in one of them).
      if (transfer.fromAddress !== subject && transfer.toAddress !== subject) continue;
      // ATA-rent guard: a native-SOL entry alongside a token transfer is the
      // rent paid to create the recipient's account, not a user movement.
      if (transfer.tokenAddress === NATIVE_SOL && hasTokenTransfer) continue;

      const asset =
        transfer.tokenAddress === NATIVE_SOL
          ? { symbol: 'SOL', decimals: 9 }
          : assetByMint(transfer.tokenAddress, cluster);
      if (!asset) continue; // unrecognised mint — the sweeper covers the row

      const isSol = asset.symbol === 'SOL';
      const transferOutgoing = transfer.fromAddress === subject;
      const direction = movementDirection(transferOutgoing, peerRegistered);
      const amount = `${transfer.amount} ${asset.symbol}`;

      movements.push({
        referenceId: `${activity.transactionHash}-${asset.symbol}`,
        type: movementType(asset.symbol, transferOutgoing),
        status: failed ? 'failed' : 'completed',
        amountUsdc: isSol ? 0 : transfer.amount,
        amountSol: isSol ? transfer.amount : null,
        fiatAmount: isSol ? null : transfer.amount,
        fiatCurrency: 'USD',
        method: isSol ? 'Solana' : `Solana ${asset.symbol}`,
        solanaSignature: activity.transactionHash,
        solanaSlot: activity.blockNumber ?? null,
        counterpartyPubkey,
        confirmations: failed ? 0 : 1,
        confirmedAt: failed ? null : timestamp,
        failedReason: activity.transactionError ?? null,
        metadataJson: {
          assetSymbol: asset.symbol,
          walletAddress: subject,
          title: directionTitle(asset.symbol, direction),
          counterparty: counterpartyPubkey,
          ...(peerRegistered ? { counterpartyHandle: peer?.handle ?? null } : {}),
          source: 'dynamic-webhook',
          ...(canonicalExplorerUrl ? { explorerUrl: canonicalExplorerUrl } : {}),
          ...(activity.fee !== undefined
            ? { feeLamports: activity.fee, ...(activity.feePayer ? { feePayer: activity.feePayer } : {}) }
            : {}),
          messageId: envelope.messageId,
          ...(activity.blockNumber !== undefined ? { slot: activity.blockNumber } : {}),
        },
        createdAt: timestamp,
      });

      // One precise banner per movement. Row 1 is the amount (the headline the
      // user scans first); row 2 is the action and counterparty.
      const signedAmount = `${transferOutgoing || direction === 'withdrawal' ? '−' : '+'}${amount}`;
      notificationDrafts.push(
        failed
          ? {
              type: 'transfer_failed',
              title: `${amount} no se completó`,
              message: `Tu ${transferOutgoing ? 'envío' : 'recepción'} falló.`,
              symbol: asset.symbol,
              outgoing: transferOutgoing,
              amount: transfer.amount,
            }
          : direction === 'transfer'
            ? {
                type: transferOutgoing ? 'transfer_sent' : 'transfer_received',
                title: signedAmount,
                message: transferOutgoing
                  ? `Enviaste a ${peerLabel}`
                  : `Recibiste de ${peerLabel}`,
                symbol: asset.symbol,
                outgoing: transferOutgoing,
                amount: transfer.amount,
              }
            : direction === 'withdrawal'
              ? {
                  type: 'withdrawal_sent',
                  title: signedAmount,
                  message: `Retiro a ${peerLabel}`,
                  symbol: asset.symbol,
                  outgoing: true,
                  amount: transfer.amount,
                }
              : {
                  type: 'deposit_received',
                  title: signedAmount,
                  message: `Depósito de ${peerLabel}`,
                  symbol: asset.symbol,
                  outgoing: false,
                  amount: transfer.amount,
                }
      );
    }

    if (movements.length === 0) continue;
    projectable = true;

    const result = await upsertTransactions(user.id, movements, subject);
    projected += result.inserted + result.updated;

    // Single-use payment links: if this was an incoming USDC transfer, try to
    // settle an active payment link for the recipient. The link's fixed
    // amount must match the transfer amount (or be open). This runs only on
    // successful transfers — failed ones are skipped.
    if (!failed && hasTokenTransfer) {
      const usdcTransfer = activity.assetTransfers.find(
        (t) => t.toAddress === subject && assetByMint(t.tokenAddress, cluster)?.symbol === 'USDC'
      );
      if (usdcTransfer) {
        await settlePaymentLinkForTransfer({
          recipient: subject,
          amountUsdc: usdcTransfer.amount,
          transactionHash: activity.transactionHash,
          payerPubkey: activity.fromAddress,
          slot: activity.blockNumber ?? null,
        });
      }
    }

    for (const draft of notificationDrafts) {
      await insertNotification(user.id, {
        type: draft.type,
        title: draft.title,
        message: draft.message,
        signature: activity.transactionHash,
        dataJson: {
          assetSymbol: draft.symbol,
          amount: draft.amount,
          outgoing: draft.outgoing,
          walletAddress: subject,
          counterparty: counterpartyPubkey,
          ...(canonicalExplorerUrl ? { explorerUrl: canonicalExplorerUrl } : {}),
        },
      });
    }
  }

  if (!projectable) {
    return { wrote: false, projected: 0, ignored: 'no projectable asset transfer for the registered wallet' };
  }
  if (projected === 0) {
    return { wrote: false, projected: 0, ignored: 'the movements were already in the ledger' };
  }
  return { wrote: true, projected };
}
