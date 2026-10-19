/**
 * ReWallet Database Schema (SQLite via Drizzle ORM)
 * Prototype schema for devnet testing.
 *
 * Mirrors the production MariaDB model with SQLite-compatible types:
 * - DECIMAL(18,6) -> REAL (SQLite has no fixed-point; JS number is fine for prototype)
 * - TIMESTAMP     -> INTEGER (unix epoch, mode: 'timestamp')
 * - ENUM          -> TEXT with CHECK-like validation in the service layer
 * - JSON          -> TEXT (mode: 'json')
 * - CHAR(44)      -> TEXT (length enforced in the service layer)
 */

import { sql, relations } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// ============================================================================
// USERS
// ============================================================================

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

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
    balanceUsdc: real('balance_usdc').default(0).notNull(),
    balanceSol: real('balance_sol').default(0).notNull(),

    // Lifecycle
    isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
    kycStatus: text('kyc_status').default('none').notNull(), // none | pending | verified | rejected
    lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
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

export const contacts = sqliteTable(
  'contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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

    isFavorite: integer('is_favorite', { mode: 'boolean' }).default(false).notNull(),
    isVerified: integer('is_verified', { mode: 'boolean' }).default(false).notNull(),
    notes: text('notes'),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
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

export const paymentLinks = sqliteTable(
  'payment_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    slug: text('slug').notNull(),
    referencePubkey: text('reference_pubkey').notNull(),

    amountUsdc: real('amount_usdc'), // null = open amount
    currency: text('currency').default('USDC').notNull(),

    concept: text('concept').notNull(),
    clientName: text('client_name'),
    clientEmail: text('client_email'),
    clientPhone: text('client_phone'),

    status: text('status').default('active').notNull(), // active | paid | partial | expired | cancelled
    paidAmountUsdc: real('paid_amount_usdc').default(0).notNull(),
    paidAt: integer('paid_at', { mode: 'timestamp' }),
    paidByPubkey: text('paid_by_pubkey'),
    paidTxId: integer('paid_tx_id'),

    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    metadataJson: text('metadata_json', { mode: 'json' }),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
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

export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    type: text('type').notNull(), // deposit | withdrawal | sent | received
    status: text('status').default('pending').notNull(), // pending | confirming | completed | failed | cancelled | expired

    amountUsdc: real('amount_usdc').notNull(),
    amountSol: real('amount_sol'),

    fiatAmount: real('fiat_amount'),
    fiatCurrency: text('fiat_currency'),
    fiatRate: real('fiat_rate'),

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

    feeUsdc: real('fee_usdc').default(0).notNull(),
    feePayer: text('fee_payer').default('protocol').notNull(),

    confirmations: integer('confirmations').default(0).notNull(),
    confirmedAt: integer('confirmed_at', { mode: 'timestamp' }),
    failedReason: text('failed_reason'),

    metadataJson: text('metadata_json', { mode: 'json' }),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
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

export const qrScans = sqliteTable(
  'qr_scans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    referencePubkey: text('reference_pubkey').notNull(),
    paymentLinkId: integer('payment_link_id').references(() => paymentLinks.id, {
      onDelete: 'set null',
    }),

    scannedAmountUsdc: real('scanned_amount_usdc'),
    scannedConcept: text('scanned_concept'),
    scannedLabel: text('scanned_label'),
    scannedMessage: text('scanned_message'),

    status: text('status').default('scanned').notNull(), // scanned | payment_initiated | payment_sent | completed | failed | cancelled
    resultTxId: integer('result_tx_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),

    scannedAt: integer('scanned_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (table) => [
    index('idx_qr_user_scanned').on(table.userId, table.scannedAt),
    index('idx_qr_reference').on(table.referencePubkey),
  ]
);

// ============================================================================
// USER SETTINGS (1:1)
// ============================================================================

export const userSettings = sqliteTable('user_settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),

  language: text('language').default('en').notNull(),
  currency: text('currency').default('USD').notNull(),
  hideBalance: integer('hide_balance', { mode: 'boolean' }).default(false).notNull(),
  notificationsPush: integer('notifications_push', { mode: 'boolean' }).default(true).notNull(),
  notificationsEmail: integer('notifications_email', { mode: 'boolean' }).default(false).notNull(),
  securityPinHash: text('security_pin_hash'),
  securityBiometric: integer('security_biometric', { mode: 'boolean' }).default(false).notNull(),
  autoLockMinutes: integer('auto_lock_minutes').default(5).notNull(),
  theme: text('theme').default('dark').notNull(), // dark | light | system

  createdAt: integer('created_at', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull(),
});

// ============================================================================
// FIAT RATES
// ============================================================================

export const fiatRates = sqliteTable(
  'fiat_rates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    baseCurrency: text('base_currency').default('USDC').notNull(),
    quoteCurrency: text('quote_currency').notNull(),
    rate: real('rate').notNull(),
    source: text('source').default('coingecko').notNull(),
    validFrom: integer('valid_from', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    validUntil: integer('valid_until', { mode: 'timestamp' }),
  },
  (table) => [index('idx_rate_lookup').on(table.quoteCurrency, table.validFrom)]
);

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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

    isRead: integer('is_read', { mode: 'boolean' }).default(false).notNull(),
    readAt: integer('read_at', { mode: 'timestamp' }),
    dataJson: text('data_json', { mode: 'json' }),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
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
export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    messageId: text('message_id').notNull(),
    eventId: text('event_id'),
    webhookId: text('webhook_id'),
    eventName: text('event_name').notNull(),
    environmentId: text('environment_id'),

    dynamicUserId: text('dynamic_user_id'),
    transactionHash: text('transaction_hash'),

    isRedelivery: integer('is_redelivery', { mode: 'boolean' }).default(false).notNull(),
    /** Exact bytes of the request body, kept for signature verification and audit. */
    rawJson: text('raw_json'),

    receivedAt: integer('received_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp' }),
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

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tableName: text('table_name').notNull(),
    recordId: integer('record_id').notNull(),
    action: text('action').notNull(), // INSERT | UPDATE | DELETE
    oldValues: text('old_values', { mode: 'json' }),
    newValues: text('new_values', { mode: 'json' }),
    userId: integer('user_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index('idx_audit_table_record').on(table.tableName, table.recordId),
    index('idx_audit_user_time').on(table.userId, table.createdAt),
  ]
);

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
