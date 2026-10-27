CREATE TABLE "relay_apns_delivery_jobs" (
	"job_id" varchar(64) PRIMARY KEY,
	"payload_json" jsonb NOT NULL,
	"available_at" varchar(64) NOT NULL,
	"lease_until" varchar(64),
	"attempts" integer DEFAULT 0 NOT NULL,
	"state" varchar(16) DEFAULT 'queued' NOT NULL,
	"last_error" text,
	"created_at" varchar(64) NOT NULL,
	"updated_at" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_relay_apns_delivery_jobs_lease" ON "relay_apns_delivery_jobs" USING btree ("state","available_at");
