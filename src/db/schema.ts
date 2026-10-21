/**
 * ReWallet Database Schema (PostgreSQL via Drizzle ORM)
 * Deployed on Neon; mirrors the production MariaDB model.
 *
 * Type mapping:
 * - DECIMAL(18,6) -> doublePrecision (JS number end to end)
 * - TIMESTAMP     -> timestamptz
 * - ENUM          -> TEXT with CHECK-like validation in the service layer
 * - JSON          -> jsonb
 * - CHAR(44)      -> TEXT (length enforced in the service layer)
 */

import { sql, relations } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  serial,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// USERS
// ============================================================================

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),

    // Solana identity
    publicKey: text('public_key').notNull(),
    handle: text('handle').notNull(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),

    // UI
    avatarBg: text('avatar_bg'),
    avatarEmoji: text('avatar_emoji').default('◡̈'),
    country: text('country'),

    // Preferences (mirrored in user_settings for 1:1 detail)
    language: text('language').default('en').notNull(),

    // Balances
    balanceUsdc: doublePrecision('balance_usdc').default(0).notNull(),
    balanceSol: doublePrecision('balance_sol').default(0).notNull(),

    // Lifecycle
    isActive: boolean('is_active').default(true).notNull(),
    kycStatus: text('kyc_status').default('none').notNull(), // none | pending | verified | rejected
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    uniqueIndex('uk_users_public_key').on(table.publicKey),
    uniqueIndex('uk_users_handle').on(table.handle),
    uniqueIndex('uk_users_email').on(table.email),
    index('idx_users_country').on(table.country),
  ]
);

// ============================================================================
// CONTACTS
// ============================================================================

export const contacts = pgTable(
  'contacts',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contactUserId: integer('contact_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    handle: text('handle').notNull(),
    name: text('name').notNull(),
    publicKey: text('public_key'),
    avatarBg: text('avatar_bg'),
    avatarEmoji: text('avatar_emoji').default('◡̈'),

    isFavorite: boolean('is_favorite').default(false).notNull(),
    isVerified: boolean('is_verified').default(false).notNull(),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    uniqueIndex('uk_contacts_user_handle').on(table.userId, table.handle),
    index('idx_contacts_user_fav').on(table.userId, table.isFavorite),
    index('idx_contacts_pubkey').on(table.publicKey),
  ]
);

// ============================================================================
// PAYMENT LINKS
// ============================================================================

export const paymentLinks = pgTable(
  'payment_links',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    slug: text('slug').notNull(),
    referencePubkey: text('reference_pubkey').notNull(),

    amountUsdc: doublePrecision('amount_usdc'), // null = open amount
    currency: text('currency').default('USDC').notNull(),

    concept: text('concept').notNull(),
    clientName: text('client_name'),
    clientEmail: text('client_email'),
    clientPhone: text('client_phone'),

    status: text('status').default('active').notNull(), // active | paid | partial | expired | cancelled
    paidAmountUsdc: doublePrecision('paid_amount_usdc').default(0).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidByPubkey: text('paid_by_pubkey'),
    paidTxId: integer('paid_tx_id'),
    /**
     * Signature of the transaction that settled this link.
     *
     * It is the idempotency key between the two settlement paths: the payer
     * declares the link it is paying (the reference does not travel
     * on-chain), and the webhook later arrives for the same transfer. Without
     * this column the webhook would look for "some active link of this
     * amount" and could settle a DIFFERENT one — a second, wrong link.
     */
    paidTxSignature: text('paid_tx_signature'),

    expiresAt: timestamp('expires_at', { withTimezone: true }),
    metadataJson: jsonb('metadata_json'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    uniqueIndex('uk_pl_slug').on(table.slug),
    uniqueIndex('uk_pl_reference').on(table.referencePubkey),
    index('idx_pl_user_status').on(table.userId, table.status),
    index('idx_pl_expires').on(table.expiresAt),
  ]
);

// ============================================================================
// TRANSACTIONS
// ============================================================================

export const transactions = pgTable(
  'transactions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    type: text('type').notNull(), // deposit | withdrawal | sent | received
    status: text('status').default('pending').notNull(), // pending | confirming | completed | failed | cancelled | expired

    amountUsdc: doublePrecision('amount_usdc').notNull(),
    amountSol: doublePrecision('amount_sol'),

    fiatAmount: doublePrecision('fiat_amount'),
    fiatCurrency: text('fiat_currency'),
    fiatRate: doublePrecision('fiat_rate'),

    counterpartyId: integer('counterparty_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    counterpartyHandle: text('counterparty_handle'),
    counterpartyName: text('counterparty_name'),
    counterpartyPubkey: text('counterparty_pubkey'),

    method: text('method'),
    network: text('network').default('solana').notNull(), // solana | base | polygon | arbitrum

    // Solana Pay traceability
    referenceId: text('reference_id').notNull(),
    solanaSignature: text('solana_signature'),
    solanaSlot: integer('solana_slot'),
    referencePubkey: text('reference_pubkey'),
    paymentLinkId: integer('payment_link_id').references(() => paymentLinks.id, {
      onDelete: 'set null',
    }),

    memo: text('memo'),
    note: text('note'),

    feeUsdc: doublePrecision('fee_usdc').default(0).notNull(),
    feePayer: text('fee_payer').default('protocol').notNull(),

    confirmations: integer('confirmations').default(0).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    failedReason: text('failed_reason'),

    metadataJson: jsonb('metadata_json'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    // Idempotency is scoped per user. A single Solana transaction produces one
    // movement for each wallet involved (sender and receiver share the
    // signature), so `reference_id` alone is not unique across the table.
    uniqueIndex('uk_tx_user_reference').on(table.userId, table.referenceId),
    index('idx_tx_user_status').on(table.userId, table.status),
    index('idx_tx_user_type').on(table.userId, table.type),
    index('idx_tx_user_created').on(table.userId, table.createdAt),
    index('idx_tx_reference_pubkey').on(table.referencePubkey),
    index('idx_tx_signature').on(table.solanaSignature),
    index('idx_tx_payment_link').on(table.paymentLinkId),
  ]
);

// ============================================================================
// QR SCANS
// ============================================================================

export const qrScans = pgTable(
  'qr_scans',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    referencePubkey: text('reference_pubkey').notNull(),
    paymentLinkId: integer('payment_link_id').references(() => paymentLinks.id, {
      onDelete: 'set null',
    }),

    scannedAmountUsdc: doublePrecision('scanned_amount_usdc'),
    scannedConcept: text('scanned_concept'),
    scannedLabel: text('scanned_label'),
    scannedMessage: text('scanned_message'),

    status: text('status').default('scanned').notNull(), // scanned | payment_initiated | payment_sent | completed | failed | cancelled
    resultTxId: integer('result_tx_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),

    scannedAt: timestamp('scanned_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_qr_user_scanned').on(table.userId, table.scannedAt),
    index('idx_qr_reference').on(table.referencePubkey),
  ]
);

// ============================================================================
// USER SETTINGS (1:1)
// ============================================================================

export const userSettings = pgTable('user_settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),

  language: text('language').default('en').notNull(),
  currency: text('currency').default('USD').notNull(),
  hideBalance: boolean('hide_balance').default(false).notNull(),
  notificationsPush: boolean('notifications_push').default(true).notNull(),
  notificationsEmail: boolean('notifications_email').default(false).notNull(),
  securityPinHash: text('security_pin_hash'),
  securityBiometric: boolean('security_biometric').default(false).notNull(),
  autoLockMinutes: integer('auto_lock_minutes').default(5).notNull(),
  theme: text('theme').default('dark').notNull(), // dark | light | system

  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

// ============================================================================
// FIAT RATES
// ============================================================================

export const fiatRates = pgTable(
  'fiat_rates',
  {
    id: serial('id').primaryKey(),
    baseCurrency: text('base_currency').default('USDC').notNull(),
    quoteCurrency: text('quote_currency').notNull(),
    rate: doublePrecision('rate').notNull(),
    source: text('source').default('coingecko').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
  },
  (table) => [index('idx_rate_lookup').on(table.quoteCurrency, table.validFrom)]
);

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    type: text('type').notNull(), // deposit_received | payment_received | ...
    title: text('title').notNull(),
    message: text('message').notNull(),

    referenceTxId: integer('reference_tx_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    referencePlId: integer('reference_pl_id').references(() => paymentLinks.id, {
      onDelete: 'set null',
    }),

    isRead: boolean('is_read').default(false).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    dataJson: jsonb('data_json'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index('idx_notif_user_read').on(table.userId, table.isRead),
    index('idx_notif_user_created').on(table.userId, table.createdAt),
  ]
);

// ============================================================================
// WEBHOOK EVENTS (delivery log / dedupe)
// ============================================================================

/**
 * Raw log of every webhook delivery accepted from Dynamic.
 *
 * This table dedupes *deliveries*, which is a different concern from the
 * idempotency of the `transactions` projection: a redelivery must not create a
 * second movement, and one transaction legitimately yields several deliveries
 * (one per involved wallet). `message_id` is the key Dynamic documents for
 * redelivery handling — `event_id` is shared by every message of one event, so
 * it cannot be used as the dedupe key.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: serial('id').primaryKey(),

    messageId: text('message_id').notNull(),
    eventId: text('event_id'),
    webhookId: text('webhook_id'),
    eventName: text('event_name').notNull(),
    environmentId: text('environment_id'),

    dynamicUserId: text('dynamic_user_id'),
    transactionHash: text('transaction_hash'),

    isRedelivery: boolean('is_redelivery').default(false).notNull(),
    /** Exact bytes of the request body, kept for signature verification and audit. */
    rawJson: text('raw_json'),

    receivedAt: timestamp('received_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processError: text('process_error'),
  },
  (table) => [
    uniqueIndex('uk_webhook_message').on(table.messageId),
    index('idx_webhook_event_name').on(table.eventName),
    index('idx_webhook_tx').on(table.transactionHash),
    index('idx_webhook_processed').on(table.processedAt),
  ]
);

// ============================================================================
// AUDIT LOG
// ============================================================================

export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    tableName: text('table_name').notNull(),
    recordId: integer('record_id').notNull(),
    action: text('action').notNull(), // INSERT | UPDATE | DELETE
    oldValues: jsonb('old_values'),
    newValues: jsonb('new_values'),
    userId: integer('user_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index('idx_audit_table_record').on(table.tableName, table.recordId),
    index('idx_audit_user_time').on(table.userId, table.createdAt),
  ]
);

// ============================================================================
// DYNAMIC METRICS (landing topline cache)
// ============================================================================

/**
 * Single-row cache of the environment topline analytics served to the
 * landing page (`GET /api/landing/metrics`).
 *
 * The landing is static (Cloudflare Pages), so it must never call Dynamic
 * directly: an API token would end up in the browser. The server fetches
 * `GET /environments/:environmentId/analytics/topline` with the token, keeps
 * the snapshot here, and serves it until the cache TTL expires — the landing
 * then animates the real numbers instead of placeholders.
 */
/**
 * Single-row snapshot of the ledger metrics served to the landing page.
 *
 * Same pattern as `dynamic_metrics`, but for the numbers that only exist in
 * our own ledger: Dynamic's analytics describe adoption (users, sessions,
 * retention) and say nothing about transactions, volume, success rate or
 * settlement time. Those come from the projection of Solana that this
 * database holds.
 *
 * The snapshot exists so a database hiccup never puts zeros on a public
 * page: the last known numbers are served until the next successful pull.
 */
export const ledgerMetrics = pgTable('ledger_metrics', {
  /** Pinned single row (always 1): one ledger, one shared snapshot. */
  id: integer('id').primaryKey(),

  /** Distinct on-chain movements projected into the ledger. */
  transactions: integer('transactions').default(0).notNull(),
  /** USDC moved, counted once per on-chain movement. */
  volumeUsdc: doublePrecision('volume_usdc').default(0).notNull(),
  /** Share of settled movements that completed, in percent (0-100). */
  successRate: doublePrecision('success_rate').default(0).notNull(),
  /** Average time from the webhook landing to the movement being projected. */
  avgProcessingMs: integer('avg_processing_ms').default(0).notNull(),

  /** Last successful computation; null until the first one. */
  fetchedAt: timestamp('fetched_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const dynamicMetrics = pgTable('dynamic_metrics', {
  /** Pinned single row (always 1): one environment, one shared snapshot. */
  id: integer('id').primaryKey(),
  environmentId: text('environment_id').notNull(),

  users: integer('users').default(0).notNull(),
  wallets: integer('wallets').default(0).notNull(),
  sessions: integer('sessions').default(0).notNull(),

  /** Last successful pull from the Dynamic API; null until the first fetch. */
  fetchedAt: timestamp('fetched_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

// ============================================================================
// LANDING SURVEY (opiniones del formulario de contacto)
// ============================================================================

/**
 * One row per submitted survey on the landing's "Opinion" section. The answer
 * keys mirror the option values in landing/index.html (q1..q4); q2 is a JSON
 * array because it accepts multiple selections. q4 is optional (nullable).
 */
export const landingSurveyResponses = pgTable('landing_survey_responses', {
  id: serial('id').primaryKey(),

  name: text('name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email').notNull(),

  q1: text('q1').notNull(), // ahorrar | remesas
  q2: text('q2').notNull(), // JSON array: efectivo | banco | apps | exchanges | sin_dolares
  q3: text('q3').notNull(), // miedo_claves | redes_gas | comisiones | no_necesito
  q4: text('q4'), // lt_50 | 50_200 | 200_1000 | gt_1000 (opcional)

  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

// ============================================================================
// RELATIONS (for relational queries)
// ============================================================================

export const usersRelations = relations(users, ({ many, one }) => ({
  contacts: many(contacts),
  transactions: many(transactions),
  paymentLinks: many(paymentLinks),
  qrScans: many(qrScans),
  notifications: many(notifications),
  settings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  user: one(users, {
    fields: [contacts.userId],
    references: [users.id],
  }),
  contactUser: one(users, {
    fields: [contacts.contactUserId],
    references: [users.id],
  }),
}));

export const paymentLinksRelations = relations(paymentLinks, ({ one, many }) => ({
  user: one(users, {
    fields: [paymentLinks.userId],
    references: [users.id],
  }),
  transactions: many(transactions),
  qrScans: many(qrScans),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, {
    fields: [transactions.userId],
    references: [users.id],
  }),
  counterparty: one(users, {
    fields: [transactions.counterpartyId],
    references: [users.id],
  }),
  paymentLink: one(paymentLinks, {
    fields: [transactions.paymentLinkId],
    references: [paymentLinks.id],
  }),
}));

export const qrScansRelations = relations(qrScans, ({ one }) => ({
  user: one(users, {
    fields: [qrScans.userId],
    references: [users.id],
  }),
  paymentLink: one(paymentLinks, {
    fields: [qrScans.paymentLinkId],
    references: [paymentLinks.id],
  }),
  resultTx: one(transactions, {
    fields: [qrScans.resultTxId],
    references: [transactions.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// INFERRED TYPES
// ============================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;

export type PaymentLink = typeof paymentLinks.$inferSelect;
export type NewPaymentLink = typeof paymentLinks.$inferInsert;

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

export type QrScan = typeof qrScans.$inferSelect;
export type NewQrScan = typeof qrScans.$inferInsert;

export type UserSettings = typeof userSettings.$inferSelect;
export type NewUserSettings = typeof userSettings.$inferInsert;

export type FiatRate = typeof fiatRates.$inferSelect;
export type NewFiatRate = typeof fiatRates.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;

export type DynamicMetrics = typeof dynamicMetrics.$inferSelect;
export type NewDynamicMetrics = typeof dynamicMetrics.$inferInsert;

export type LedgerMetrics = typeof ledgerMetrics.$inferSelect;
export type NewLedgerMetrics = typeof ledgerMetrics.$inferInsert;
