CREATE TABLE "device_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_pairing_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"push_token" text,
	"token_hash" text NOT NULL,
	"is_primary_reminder_device" boolean DEFAULT false NOT NULL,
	"reminder_priority" smallint,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"notify_reminders" boolean DEFAULT false NOT NULL,
	"notify_confirmations" boolean DEFAULT true NOT NULL,
	"notify_digests" boolean DEFAULT false NOT NULL,
	"notify_alerts" boolean DEFAULT true NOT NULL,
	"quiet_hours_start" time,
	"quiet_hours_end" time,
	"quiet_hours_timezone" text,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "devices_platform" CHECK ("devices"."platform" in ('ios','android','web'))
);
--> statement-breakpoint
CREATE TABLE "notification_dispatch_log" (
	"dedupe_key" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"last_error" text,
	"expo_ticket_id" text,
	CONSTRAINT "notification_dispatch_log_status" CHECK ("notification_dispatch_log"."status" in ('pending','accepted','failed'))
);
--> statement-breakpoint
ALTER TABLE "inbox_items" ALTER COLUMN "raw_text" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "one_primary_device" ON "devices" USING btree ("is_primary_reminder_device") WHERE "devices"."is_primary_reminder_device";