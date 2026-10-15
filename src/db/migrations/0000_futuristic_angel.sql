CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`table_name` text NOT NULL,
	`record_id` integer NOT NULL,
	`action` text NOT NULL,
	`old_values` text,
	`new_values` text,
	`user_id` integer,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_table_record` ON `audit_log` (`table_name`,`record_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_user_time` ON `audit_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`contact_user_id` integer,
	`handle` text NOT NULL,
	`name` text NOT NULL,
	`public_key` text,
	`avatar_bg` text,
	`avatar_emoji` text DEFAULT '◡̈',
	`is_favorite` integer DEFAULT false NOT NULL,
	`is_verified` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uk_contacts_user_handle` ON `contacts` (`user_id`,`handle`);--> statement-breakpoint
CREATE INDEX `idx_contacts_user_fav` ON `contacts` (`user_id`,`is_favorite`);--> statement-breakpoint
CREATE INDEX `idx_contacts_pubkey` ON `contacts` (`public_key`);--> statement-breakpoint
CREATE TABLE `fiat_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`base_currency` text DEFAULT 'USDC' NOT NULL,
	`quote_currency` text NOT NULL,
	`rate` real NOT NULL,
	`source` text DEFAULT 'coingecko' NOT NULL,
	`valid_from` integer DEFAULT (unixepoch()) NOT NULL,
	`valid_until` integer
);
--> statement-breakpoint
CREATE INDEX `idx_rate_lookup` ON `fiat_rates` (`quote_currency`,`valid_from`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`reference_tx_id` integer,
	`reference_pl_id` integer,
	`is_read` integer DEFAULT false NOT NULL,
	`read_at` integer,
	`data_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_tx_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reference_pl_id`) REFERENCES `payment_links`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_notif_user_read` ON `notifications` (`user_id`,`is_read`);--> statement-breakpoint
CREATE INDEX `idx_notif_user_created` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`slug` text NOT NULL,
	`reference_pubkey` text NOT NULL,
	`amount_usdc` real,
	`currency` text DEFAULT 'USDC' NOT NULL,
	`concept` text NOT NULL,
	`client_name` text,
	`client_email` text,
	`client_phone` text,
	`status` text DEFAULT 'active' NOT NULL,
	`paid_amount_usdc` real DEFAULT 0 NOT NULL,
	`paid_at` integer,
	`paid_by_pubkey` text,
	`paid_tx_id` integer,
	`expires_at` integer,
	`metadata_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uk_pl_slug` ON `payment_links` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_pl_reference` ON `payment_links` (`reference_pubkey`);--> statement-breakpoint
CREATE INDEX `idx_pl_user_status` ON `payment_links` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_pl_expires` ON `payment_links` (`expires_at`);--> statement-breakpoint
CREATE TABLE `qr_scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`reference_pubkey` text NOT NULL,
	`payment_link_id` integer,
	`scanned_amount_usdc` real,
	`scanned_concept` text,
	`scanned_label` text,
	`scanned_message` text,
	`status` text DEFAULT 'scanned' NOT NULL,
	`result_tx_id` integer,
	`scanned_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_link_id`) REFERENCES `payment_links`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`result_tx_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_qr_user_scanned` ON `qr_scans` (`user_id`,`scanned_at`);--> statement-breakpoint
CREATE INDEX `idx_qr_reference` ON `qr_scans` (`reference_pubkey`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`amount_usdc` real NOT NULL,
	`amount_sol` real,
	`fiat_amount` real,
	`fiat_currency` text,
	`fiat_rate` real,
	`counterparty_id` integer,
	`counterparty_handle` text,
	`counterparty_name` text,
	`counterparty_pubkey` text,
	`method` text,
	`network` text DEFAULT 'solana' NOT NULL,
	`reference_id` text NOT NULL,
	`solana_signature` text,
	`solana_slot` integer,
	`reference_pubkey` text,
	`payment_link_id` integer,
	`memo` text,
	`note` text,
	`fee_usdc` real DEFAULT 0 NOT NULL,
	`fee_payer` text DEFAULT 'protocol' NOT NULL,
	`confirmations` integer DEFAULT 0 NOT NULL,
	`confirmed_at` integer,
	`failed_reason` text,
	`metadata_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`counterparty_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_link_id`) REFERENCES `payment_links`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uk_tx_reference` ON `transactions` (`reference_id`);--> statement-breakpoint
CREATE INDEX `idx_tx_user_status` ON `transactions` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tx_user_type` ON `transactions` (`user_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_tx_user_created` ON `transactions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_tx_reference_pubkey` ON `transactions` (`reference_pubkey`);--> statement-breakpoint
CREATE INDEX `idx_tx_signature` ON `transactions` (`solana_signature`);--> statement-breakpoint
CREATE INDEX `idx_tx_payment_link` ON `transactions` (`payment_link_id`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`hide_balance` integer DEFAULT false NOT NULL,
	`notifications_push` integer DEFAULT true NOT NULL,
	`notifications_email` integer DEFAULT false NOT NULL,
	`security_pin_hash` text,
	`security_biometric` integer DEFAULT false NOT NULL,
	`auto_lock_minutes` integer DEFAULT 5 NOT NULL,
	`theme` text DEFAULT 'dark' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_key` text NOT NULL,
	`handle` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`avatar_bg` text,
	`avatar_emoji` text DEFAULT '◡̈',
	`country` text,
	`language` text DEFAULT 'en' NOT NULL,
	`balance_usdc` real DEFAULT 0 NOT NULL,
	`balance_sol` real DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`kyc_status` text DEFAULT 'none' NOT NULL,
	`last_login_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uk_users_public_key` ON `users` (`public_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_users_handle` ON `users` (`handle`);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_country` ON `users` (`country`);