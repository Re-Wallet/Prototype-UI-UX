CREATE TABLE "ledger_metrics" (
	"id" integer PRIMARY KEY NOT NULL,
	"transactions" integer DEFAULT 0 NOT NULL,
	"volume_usdc" double precision DEFAULT 0 NOT NULL,
	"success_rate" double precision DEFAULT 0 NOT NULL,
	"avg_processing_ms" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
