CREATE TABLE `webhook_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`event_id` text,
	`webhook_id` text,
	`event_name` text NOT NULL,
	`environment_id` text,
	`dynamic_user_id` text,
	`transaction_hash` text,
	`is_redelivery` integer DEFAULT false NOT NULL,
	`raw_json` text,
	`received_at` integer DEFAULT (unixepoch()) NOT NULL,
	`processed_at` integer,
	`process_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uk_webhook_message` ON `webhook_events` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_webhook_event_name` ON `webhook_events` (`event_name`);--> statement-breakpoint
CREATE INDEX `idx_webhook_tx` ON `webhook_events` (`transaction_hash`);--> statement-breakpoint
CREATE INDEX `idx_webhook_processed` ON `webhook_events` (`processed_at`);--> statement-breakpoint
DROP INDEX `uk_tx_reference`;--> statement-breakpoint
CREATE UNIQUE INDEX `uk_tx_user_reference` ON `transactions` (`user_id`,`reference_id`);