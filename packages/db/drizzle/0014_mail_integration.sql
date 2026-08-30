CREATE TABLE "mail_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"access_token_ciphertext" bytea,
	"access_token_iv" bytea,
	"access_token_auth_tag" bytea,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_ciphertext" bytea,
	"refresh_token_iv" bytea,
	"refresh_token_auth_tag" bytea,
	"granted_scope" text,
	"identity_verified_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_error" text,
	"last_sync_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "mail_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "mail_sync_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"cursor_value" text,
	"cursor_kind" text NOT NULL,
	"needs_full_resync" boolean DEFAULT true NOT NULL,
	"last_successful_sync_at" timestamp with time zone,
	"last_full_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"internal_date" timestamp with time zone NOT NULL,
	"from_address" text,
	"from_domain" text,
	"from_display_name" text,
	"subject" text,
	"provider_labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"has_attachment" boolean DEFAULT false NOT NULL,
	"size_estimate" integer,
	"content_hash" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "mail_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"digest_date" date NOT NULL,
	"timezone" text NOT NULL,
	"content" jsonb NOT NULL,
	"model_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "mail_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"cursor_id" uuid,
	"scope_key" text NOT NULL,
	"kind" text NOT NULL,
	"range_start_at" timestamp with time zone,
	"range_end_at" timestamp with time zone,
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
	"cursor_expired" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "mail_sync_cursors" ADD CONSTRAINT "mail_sync_cursors_connection_id_mail_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mail_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_connection_id_mail_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mail_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_digests" ADD CONSTRAINT "mail_digests_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_runs" ADD CONSTRAINT "mail_sync_runs_connection_id_mail_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mail_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_runs" ADD CONSTRAINT "mail_sync_runs_cursor_id_mail_sync_cursors_id_fk" FOREIGN KEY ("cursor_id") REFERENCES "public"."mail_sync_cursors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_connections" ADD CONSTRAINT "mail_connections_status" CHECK ("mail_connections"."status" in ('active','needs_reauth','revoked','disconnected'));--> statement-breakpoint
ALTER TABLE "mail_connections" ADD CONSTRAINT "mail_connections_access_token_triple" CHECK (("mail_connections"."access_token_ciphertext" is null and "mail_connections"."access_token_iv" is null and "mail_connections"."access_token_auth_tag" is null) or ("mail_connections"."access_token_ciphertext" is not null and "mail_connections"."access_token_iv" is not null and "mail_connections"."access_token_auth_tag" is not null));--> statement-breakpoint
ALTER TABLE "mail_connections" ADD CONSTRAINT "mail_connections_refresh_token_triple" CHECK (("mail_connections"."refresh_token_ciphertext" is null and "mail_connections"."refresh_token_iv" is null and "mail_connections"."refresh_token_auth_tag" is null) or ("mail_connections"."refresh_token_ciphertext" is not null and "mail_connections"."refresh_token_iv" is not null and "mail_connections"."refresh_token_auth_tag" is not null));--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_size_estimate_nonnegative" CHECK ("mail_messages"."size_estimate" is null or "mail_messages"."size_estimate" >= 0);--> statement-breakpoint
ALTER TABLE "mail_sync_runs" ADD CONSTRAINT "mail_sync_runs_kind" CHECK ("mail_sync_runs"."kind" in ('incremental','full','backfill','manual'));--> statement-breakpoint
ALTER TABLE "mail_sync_runs" ADD CONSTRAINT "mail_sync_runs_status" CHECK ("mail_sync_runs"."status" in ('succeeded','failed','skipped','cancelled'));--> statement-breakpoint
ALTER TABLE "mail_sync_runs" ADD CONSTRAINT "mail_sync_runs_range_order" CHECK ("mail_sync_runs"."range_start_at" is null or "mail_sync_runs"."range_end_at" is null or "mail_sync_runs"."range_end_at" >= "mail_sync_runs"."range_start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_connections_provider_account_unique" ON "mail_connections" USING btree ("provider","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_oauth_states_state_hash_unique" ON "mail_oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "mail_oauth_states_expires_at_idx" ON "mail_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_sync_cursors_connection_scope_unique" ON "mail_sync_cursors" USING btree ("connection_id","scope_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_messages_connection_external_id_unique" ON "mail_messages" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "mail_messages_connection_internal_date_idx" ON "mail_messages" USING btree ("connection_id","internal_date");--> statement-breakpoint
CREATE INDEX "mail_messages_connection_thread_idx" ON "mail_messages" USING btree ("connection_id","thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_digests_date_timezone_unique" ON "mail_digests" USING btree ("digest_date","timezone");--> statement-breakpoint
CREATE INDEX "mail_sync_runs_connection_started_at_idx" ON "mail_sync_runs" USING btree ("connection_id","started_at");
