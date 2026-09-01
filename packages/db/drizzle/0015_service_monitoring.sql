CREATE TABLE "monitor_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"expected_status" integer DEFAULT 200 NOT NULL,
	"expect_healthy_payload" boolean DEFAULT false NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"interval_seconds" integer DEFAULT 300 NOT NULL,
	"failure_threshold" integer DEFAULT 3 NOT NULL,
	"recovery_threshold" integer DEFAULT 2 NOT NULL,
	"tls_warn_days" integer,
	"heartbeat_max_age_seconds" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"maintenance_start" time,
	"maintenance_end" time,
	"maintenance_timezone" text,
	"muted_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "monitor_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"latency_ms" integer,
	"failure_class" text,
	"tls_expires_at" timestamp with time zone,
	"tls_days_remaining" integer,
	"heartbeat_age_seconds" integer,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "monitor_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"failure_class" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "monitor_checks" ADD CONSTRAINT "monitor_checks_target_id_monitor_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."monitor_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_incidents" ADD CONSTRAINT "monitor_incidents_target_id_monitor_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."monitor_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_targets" ADD CONSTRAINT "monitor_targets_kind" CHECK ("monitor_targets"."kind" in ('http','worker_heartbeat'));--> statement-breakpoint
ALTER TABLE "monitor_targets" ADD CONSTRAINT "monitor_targets_timeout_positive" CHECK ("monitor_targets"."timeout_ms" > 0);--> statement-breakpoint
ALTER TABLE "monitor_targets" ADD CONSTRAINT "monitor_targets_interval_positive" CHECK ("monitor_targets"."interval_seconds" > 0);--> statement-breakpoint
ALTER TABLE "monitor_targets" ADD CONSTRAINT "monitor_targets_failure_threshold_positive" CHECK ("monitor_targets"."failure_threshold" > 0);--> statement-breakpoint
ALTER TABLE "monitor_targets" ADD CONSTRAINT "monitor_targets_recovery_threshold_positive" CHECK ("monitor_targets"."recovery_threshold" > 0);--> statement-breakpoint
ALTER TABLE "monitor_targets" ADD CONSTRAINT "monitor_targets_maintenance_window_complete" CHECK (("monitor_targets"."maintenance_start" is null and "monitor_targets"."maintenance_end" is null and "monitor_targets"."maintenance_timezone" is null) or ("monitor_targets"."maintenance_start" is not null and "monitor_targets"."maintenance_end" is not null and "monitor_targets"."maintenance_timezone" is not null));--> statement-breakpoint
ALTER TABLE "monitor_checks" ADD CONSTRAINT "monitor_checks_status" CHECK ("monitor_checks"."status" in ('up','down','skipped'));--> statement-breakpoint
ALTER TABLE "monitor_checks" ADD CONSTRAINT "monitor_checks_latency_nonnegative" CHECK ("monitor_checks"."latency_ms" is null or "monitor_checks"."latency_ms" >= 0);--> statement-breakpoint
ALTER TABLE "monitor_incidents" ADD CONSTRAINT "monitor_incidents_status" CHECK ("monitor_incidents"."status" in ('open','acknowledged','resolved'));--> statement-breakpoint
ALTER TABLE "monitor_incidents" ADD CONSTRAINT "monitor_incidents_resolved_consistency" CHECK (("monitor_incidents"."resolved_at" is null and "monitor_incidents"."status" in ('open','acknowledged')) or ("monitor_incidents"."resolved_at" is not null and "monitor_incidents"."status" = 'resolved'));--> statement-breakpoint
CREATE UNIQUE INDEX "monitor_targets_name_unique" ON "monitor_targets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "monitor_checks_target_checked_at_idx" ON "monitor_checks" USING btree ("target_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monitor_incidents_one_active_per_target" ON "monitor_incidents" USING btree ("target_id") WHERE "monitor_incidents"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "monitor_incidents_target_opened_at_idx" ON "monitor_incidents" USING btree ("target_id","opened_at");
