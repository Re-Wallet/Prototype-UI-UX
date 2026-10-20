CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"record_id" integer NOT NULL,
	"action" text NOT NULL,
	"old_values" jsonb,
	"new_values" jsonb,
	"user_id" integer,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"contact_user_id" integer,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"public_key" text,
	"avatar_bg" text,
	"avatar_emoji" text DEFAULT '◡̈',
	"is_favorite" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dynamic_metrics" (
	"id" integer PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"users" integer DEFAULT 0 NOT NULL,
	"wallets" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiat_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"base_currency" text DEFAULT 'USDC' NOT NULL,
	"quote_currency" text NOT NULL,
	"rate" double precision NOT NULL,
	"source" text DEFAULT 'coingecko' NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "landing_survey_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"q1" text NOT NULL,
	"q2" text NOT NULL,
	"q3" text NOT NULL,
	"q4" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"reference_tx_id" integer,
	"reference_pl_id" integer,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"data_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"slug" text NOT NULL,
	"reference_pubkey" text NOT NULL,
	"amount_usdc" double precision,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"concept" text NOT NULL,
	"client_name" text,
	"client_email" text,
	"client_phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"paid_amount_usdc" double precision DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_by_pubkey" text,
	"paid_tx_id" integer,
	"expires_at" timestamp with time zone,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"reference_pubkey" text NOT NULL,
	"payment_link_id" integer,
	"scanned_amount_usdc" double precision,
	"scanned_concept" text,
	"scanned_label" text,
	"scanned_message" text,
	"status" text DEFAULT 'scanned' NOT NULL,
	"result_tx_id" integer,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_usdc" double precision NOT NULL,
	"amount_sol" double precision,
	"fiat_amount" double precision,
	"fiat_currency" text,
	"fiat_rate" double precision,
	"counterparty_id" integer,
	"counterparty_handle" text,
	"counterparty_name" text,
	"counterparty_pubkey" text,
	"method" text,
	"network" text DEFAULT 'solana' NOT NULL,
	"reference_id" text NOT NULL,
	"solana_signature" text,
	"solana_slot" integer,
	"reference_pubkey" text,
	"payment_link_id" integer,
	"memo" text,
	"note" text,
	"fee_usdc" double precision DEFAULT 0 NOT NULL,
	"fee_payer" text DEFAULT 'protocol' NOT NULL,
	"confirmations" integer DEFAULT 0 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"failed_reason" text,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"hide_balance" boolean DEFAULT false NOT NULL,
	"notifications_push" boolean DEFAULT true NOT NULL,
	"notifications_email" boolean DEFAULT false NOT NULL,
	"security_pin_hash" text,
	"security_biometric" boolean DEFAULT false NOT NULL,
	"auto_lock_minutes" integer DEFAULT 5 NOT NULL,
	"theme" text DEFAULT 'dark' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"avatar_bg" text,
	"avatar_emoji" text DEFAULT '◡̈',
	"country" text,
	"language" text DEFAULT 'en' NOT NULL,
	"balance_usdc" double precision DEFAULT 0 NOT NULL,
	"balance_sol" double precision DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"kyc_status" text DEFAULT 'none' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"event_id" text,
	"webhook_id" text,
	"event_name" text NOT NULL,
	"environment_id" text,
	"dynamic_user_id" text,
	"transaction_hash" text,
	"is_redelivery" boolean DEFAULT false NOT NULL,
	"raw_json" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"process_error" text
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contact_user_id_users_id_fk" FOREIGN KEY ("contact_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_reference_tx_id_transactions_id_fk" FOREIGN KEY ("reference_tx_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_reference_pl_id_payment_links_id_fk" FOREIGN KEY ("reference_pl_id") REFERENCES "public"."payment_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_payment_link_id_payment_links_id_fk" FOREIGN KEY ("payment_link_id") REFERENCES "public"."payment_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_result_tx_id_transactions_id_fk" FOREIGN KEY ("result_tx_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_counterparty_id_users_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_link_id_payment_links_id_fk" FOREIGN KEY ("payment_link_id") REFERENCES "public"."payment_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_table_record" ON "audit_log" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "idx_audit_user_time" ON "audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_contacts_user_handle" ON "contacts" USING btree ("user_id","handle");--> statement-breakpoint
CREATE INDEX "idx_contacts_user_fav" ON "contacts" USING btree ("user_id","is_favorite");--> statement-breakpoint
CREATE INDEX "idx_contacts_pubkey" ON "contacts" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX "idx_rate_lookup" ON "fiat_rates" USING btree ("quote_currency","valid_from");--> statement-breakpoint
CREATE INDEX "idx_notif_user_read" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "idx_notif_user_created" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_pl_slug" ON "payment_links" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_pl_reference" ON "payment_links" USING btree ("reference_pubkey");--> statement-breakpoint
CREATE INDEX "idx_pl_user_status" ON "payment_links" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_pl_expires" ON "payment_links" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_qr_user_scanned" ON "qr_scans" USING btree ("user_id","scanned_at");--> statement-breakpoint
CREATE INDEX "idx_qr_reference" ON "qr_scans" USING btree ("reference_pubkey");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_tx_user_reference" ON "transactions" USING btree ("user_id","reference_id");--> statement-breakpoint
CREATE INDEX "idx_tx_user_status" ON "transactions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_tx_user_type" ON "transactions" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "idx_tx_user_created" ON "transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_tx_reference_pubkey" ON "transactions" USING btree ("reference_pubkey");--> statement-breakpoint
CREATE INDEX "idx_tx_signature" ON "transactions" USING btree ("solana_signature");--> statement-breakpoint
CREATE INDEX "idx_tx_payment_link" ON "transactions" USING btree ("payment_link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_users_public_key" ON "users" USING btree ("public_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_users_handle" ON "users" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_country" ON "users" USING btree ("country");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_webhook_message" ON "webhook_events" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_event_name" ON "webhook_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "idx_webhook_tx" ON "webhook_events" USING btree ("transaction_hash");--> statement-breakpoint
CREATE INDEX "idx_webhook_processed" ON "webhook_events" USING btree ("processed_at");