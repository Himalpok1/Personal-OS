CREATE TABLE "calendar_connection_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"google_calendar_id" text NOT NULL,
	"summary" text NOT NULL,
	"sync_enabled" boolean DEFAULT false NOT NULL,
	"project_id" uuid,
	"next_sync_token" text,
	"last_successful_sync_at" timestamp with time zone,
	"last_full_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"google_account_email" text NOT NULL,
	"google_account_id" text NOT NULL,
	"access_token_ciphertext" "bytea",
	"access_token_iv" "bytea",
	"access_token_auth_tag" "bytea",
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_ciphertext" "bytea",
	"refresh_token_iv" "bytea",
	"refresh_token_auth_tag" "bytea",
	"granted_scope" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_connections_google_account_id_unique" UNIQUE("google_account_id"),
	CONSTRAINT "calendar_connections_provider" CHECK ("calendar_connections"."provider" in ('google')),
	CONSTRAINT "calendar_connections_status" CHECK ("calendar_connections"."status" in ('active','needs_reauth','revoked','disconnected'))
);
--> statement-breakpoint
CREATE TABLE "calendar_event_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"google_calendar_id" text NOT NULL,
	"google_master_event_id" text NOT NULL,
	"google_instance_event_id" text NOT NULL,
	"google_original_start_time" timestamp with time zone NOT NULL,
	"local_parent_event_id" uuid NOT NULL,
	"local_original_start_at" timestamp with time zone NOT NULL,
	"local_detached_event_id" uuid,
	"mapping_status" text NOT NULL,
	"google_etag" text,
	"google_updated_at" timestamp with time zone,
	"last_synced_local_updated_at" timestamp with time zone,
	"sync_status" text DEFAULT 'synced' NOT NULL,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_instances_mapping_status" CHECK ("calendar_event_instances"."mapping_status" in ('detached','cancelled')),
	CONSTRAINT "calendar_event_instances_mapping_consistency" CHECK (("calendar_event_instances"."mapping_status" = 'detached') = ("calendar_event_instances"."local_detached_event_id" is not null)),
	CONSTRAINT "calendar_event_instances_sync_status" CHECK ("calendar_event_instances"."sync_status" in ('synced','pending_push','conflict','error'))
);
--> statement-breakpoint
CREATE TABLE "event_external_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"google_calendar_id" text NOT NULL,
	"google_event_id" text NOT NULL,
	"google_ical_uid" text,
	"google_etag" text,
	"google_updated_at" timestamp with time zone,
	"last_synced_local_updated_at" timestamp with time zone,
	"sync_status" text DEFAULT 'synced' NOT NULL,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_external_links_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "event_external_links_sync_status" CHECK ("event_external_links"."sync_status" in ('synced','pending_push','conflict','error'))
);
--> statement-breakpoint
ALTER TABLE "calendar_connection_calendars" ADD CONSTRAINT "calendar_connection_calendars_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connection_calendars" ADD CONSTRAINT "calendar_connection_calendars_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_instances" ADD CONSTRAINT "calendar_event_instances_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_instances" ADD CONSTRAINT "calendar_event_instances_local_parent_event_id_events_id_fk" FOREIGN KEY ("local_parent_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_instances" ADD CONSTRAINT "calendar_event_instances_local_detached_event_id_events_id_fk" FOREIGN KEY ("local_detached_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_external_links" ADD CONSTRAINT "event_external_links_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_external_links" ADD CONSTRAINT "event_external_links_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connection_calendars_connection_calendar_idx" ON "calendar_connection_calendars" USING btree ("connection_id","google_calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_instances_connection_calendar_instance_idx" ON "calendar_event_instances" USING btree ("connection_id","google_calendar_id","google_instance_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_instances_parent_original_start_idx" ON "calendar_event_instances" USING btree ("local_parent_event_id","local_original_start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_external_links_connection_calendar_event_idx" ON "event_external_links" USING btree ("connection_id","google_calendar_id","google_event_id");