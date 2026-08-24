CREATE TABLE "health_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"health_user_id" text NOT NULL,
	"legacy_user_id" text,
	"access_token_ciphertext" bytea,
	"access_token_iv" bytea,
	"access_token_auth_tag" bytea,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_ciphertext" bytea,
	"refresh_token_iv" bytea,
	"refresh_token_auth_tag" bytea,
	"granted_scope" text,
	"source_family" text DEFAULT 'users/me/dataSourceFamilies/all-sources' NOT NULL,
	"identity_verified_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_error" text,
	"last_sync_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "health_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "health_metric_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"sync_enabled" boolean DEFAULT false NOT NULL,
	"capability_status" text,
	"capability_checked_at" timestamp with time zone,
	"verified_through_date" date,
	"earliest_verified_date" date,
	"first_data_date" date,
	"last_successful_sync_at" timestamp with time zone,
	"last_full_sync_at" timestamp with time zone,
	"backfill_status" text DEFAULT 'idle' NOT NULL,
	"backfill_target_date" date,
	"backfill_cursor_date" date,
	"backfill_cancel_requested" boolean DEFAULT false NOT NULL,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "health_daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"local_date" date NOT NULL,
	"has_data" boolean DEFAULT false NOT NULL,
	"value" numeric,
	"breakdown" jsonb,
	"source_count" integer,
	"source_family" text,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "health_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"external_key" text NOT NULL,
	"external_key_source" text NOT NULL,
	"data_point_name" text,
	"observed_at_utc" timestamp with time zone NOT NULL,
	"civil_local" timestamp NOT NULL,
	"local_date" date NOT NULL,
	"utc_offset_seconds" integer NOT NULL,
	"value" numeric NOT NULL,
	"source_family" text,
	"source_ref" text,
	"content_hash" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "health_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"external_key" text NOT NULL,
	"external_key_source" text NOT NULL,
	"data_point_name" text,
	"attributed_local_date" date NOT NULL,
	"civil_start_local" timestamp NOT NULL,
	"civil_end_local" timestamp NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"start_utc_offset_seconds" integer NOT NULL,
	"end_utc_offset_seconds" integer NOT NULL,
	"duration_seconds" integer NOT NULL,
	"detail" jsonb NOT NULL,
	"provider_created_at" timestamp with time zone,
	"provider_updated_at" timestamp with time zone,
	"content_hash" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "health_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"stream_id" uuid,
	"metric" text NOT NULL,
	"kind" text NOT NULL,
	"range_start_date" date NOT NULL,
	"range_end_date" date NOT NULL,
	"status" text NOT NULL,
	"failure_class" text,
	"http_status" integer,
	"request_count" integer DEFAULT 0 NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"rows_inserted" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"rows_unchanged" integer DEFAULT 0 NOT NULL,
	"rows_tombstoned" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"rows_collapsed" integer DEFAULT 0 NOT NULL,
	"expected_bucket_count" integer,
	"received_bucket_count" integer,
	"source_family" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "health_metric_streams" ADD CONSTRAINT "health_metric_streams_connection_id_health_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."health_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_daily_metrics" ADD CONSTRAINT "health_daily_metrics_connection_id_health_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."health_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_observations" ADD CONSTRAINT "health_observations_connection_id_health_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."health_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_sessions" ADD CONSTRAINT "health_sessions_connection_id_health_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."health_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_sync_runs" ADD CONSTRAINT "health_sync_runs_connection_id_health_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."health_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_sync_runs" ADD CONSTRAINT "health_sync_runs_stream_id_health_metric_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."health_metric_streams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_connections" ADD CONSTRAINT "health_connections_status" CHECK ("health_connections"."status" in ('active','needs_reauth','revoked','disconnected'));--> statement-breakpoint
ALTER TABLE "health_connections" ADD CONSTRAINT "health_connections_access_token_triple" CHECK (("health_connections"."access_token_ciphertext" is null and "health_connections"."access_token_iv" is null and "health_connections"."access_token_auth_tag" is null) or ("health_connections"."access_token_ciphertext" is not null and "health_connections"."access_token_iv" is not null and "health_connections"."access_token_auth_tag" is not null));--> statement-breakpoint
ALTER TABLE "health_connections" ADD CONSTRAINT "health_connections_refresh_token_triple" CHECK (("health_connections"."refresh_token_ciphertext" is null and "health_connections"."refresh_token_iv" is null and "health_connections"."refresh_token_auth_tag" is null) or ("health_connections"."refresh_token_ciphertext" is not null and "health_connections"."refresh_token_iv" is not null and "health_connections"."refresh_token_auth_tag" is not null));--> statement-breakpoint
ALTER TABLE "health_metric_streams" ADD CONSTRAINT "health_metric_streams_backfill_status" CHECK ("health_metric_streams"."backfill_status" in ('idle','running','paused','cancelled','complete','failed'));--> statement-breakpoint
ALTER TABLE "health_metric_streams" ADD CONSTRAINT "health_metric_streams_backfill_invariants" CHECK (("health_metric_streams"."backfill_status" = 'idle' and "health_metric_streams"."backfill_target_date" is null and "health_metric_streams"."backfill_cursor_date" is null) or ("health_metric_streams"."backfill_status" <> 'idle' and "health_metric_streams"."backfill_target_date" is not null));--> statement-breakpoint
ALTER TABLE "health_metric_streams" ADD CONSTRAINT "health_metric_streams_verified_range" CHECK ("health_metric_streams"."earliest_verified_date" is null or "health_metric_streams"."verified_through_date" is null or "health_metric_streams"."earliest_verified_date" <= "health_metric_streams"."verified_through_date");--> statement-breakpoint
ALTER TABLE "health_daily_metrics" ADD CONSTRAINT "health_daily_metrics_has_data_invariants" CHECK (("health_daily_metrics"."has_data" and ("health_daily_metrics"."value" is not null or "health_daily_metrics"."breakdown" is not null)) or (not "health_daily_metrics"."has_data" and "health_daily_metrics"."value" is null and "health_daily_metrics"."breakdown" is null));--> statement-breakpoint
ALTER TABLE "health_observations" ADD CONSTRAINT "health_observations_external_key_source" CHECK ("health_observations"."external_key_source" in ('data_point_name','reconcile_derived','list_derived'));--> statement-breakpoint
ALTER TABLE "health_sessions" ADD CONSTRAINT "health_sessions_external_key_source" CHECK ("health_sessions"."external_key_source" in ('data_point_name','reconcile_derived','list_derived'));--> statement-breakpoint
ALTER TABLE "health_sessions" ADD CONSTRAINT "health_sessions_time_invariants" CHECK ("health_sessions"."end_at" >= "health_sessions"."start_at" and "health_sessions"."duration_seconds" >= 0);--> statement-breakpoint
ALTER TABLE "health_sync_runs" ADD CONSTRAINT "health_sync_runs_kind" CHECK ("health_sync_runs"."kind" in ('hot','warm','backfill','manual'));--> statement-breakpoint
ALTER TABLE "health_sync_runs" ADD CONSTRAINT "health_sync_runs_status" CHECK ("health_sync_runs"."status" in ('succeeded','failed','skipped','cancelled'));--> statement-breakpoint
CREATE UNIQUE INDEX "health_connections_health_user_id_unique" ON "health_connections" USING btree ("health_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "health_oauth_states_state_hash_unique" ON "health_oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "health_oauth_states_expires_at_idx" ON "health_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "health_metric_streams_connection_metric_unique" ON "health_metric_streams" USING btree ("connection_id","metric");--> statement-breakpoint
CREATE UNIQUE INDEX "health_daily_metrics_connection_metric_local_date_unique" ON "health_daily_metrics" USING btree ("connection_id","metric","local_date");--> statement-breakpoint
CREATE INDEX "health_daily_metrics_local_date_idx" ON "health_daily_metrics" USING btree ("local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "health_observations_connection_metric_external_key_unique" ON "health_observations" USING btree ("connection_id","metric","external_key");--> statement-breakpoint
CREATE INDEX "health_observations_metric_local_date_idx" ON "health_observations" USING btree ("metric","local_date");--> statement-breakpoint
CREATE INDEX "health_observations_metric_observed_at_idx" ON "health_observations" USING btree ("metric","observed_at_utc");--> statement-breakpoint
CREATE UNIQUE INDEX "health_sessions_connection_metric_external_key_unique" ON "health_sessions" USING btree ("connection_id","metric","external_key");--> statement-breakpoint
CREATE INDEX "health_sessions_metric_attributed_local_date_idx" ON "health_sessions" USING btree ("metric","attributed_local_date");--> statement-breakpoint
CREATE INDEX "health_sessions_metric_civil_end_idx" ON "health_sessions" USING btree ("metric","civil_end_local");--> statement-breakpoint
CREATE INDEX "health_sessions_metric_civil_start_idx" ON "health_sessions" USING btree ("metric","civil_start_local");--> statement-breakpoint
CREATE INDEX "health_sync_runs_metric_started_at_idx" ON "health_sync_runs" USING btree ("metric","started_at");
