CREATE TABLE "ai_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text,
	"capabilities" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider_type" text NOT NULL,
	"base_url" text,
	"api_key_ciphertext" "bytea" NOT NULL,
	"api_key_iv" "bytea" NOT NULL,
	"api_key_auth_tag" "bytea" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_connections_provider_type" CHECK ("ai_provider_connections"."provider_type" in ('openai','anthropic','google','xai','openai_compatible'))
);
--> statement-breakpoint
CREATE TABLE "ai_task_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_name" text NOT NULL,
	"primary_model_id" uuid NOT NULL,
	"fallback_model_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_task_routes_task_name_unique" UNIQUE("task_name")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"start_local" timestamp,
	"end_local" timestamp,
	"timezone" text NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"start_date" date,
	"end_date" date,
	"rrule" text,
	"recurrence_timezone" text,
	"recurrence_until" timestamp with time zone,
	"recurrence_count" integer,
	"recurrence_exdates" date[],
	"parent_event_id" uuid,
	"original_start_at" timestamp with time zone,
	"external_id" text,
	"external_source" text,
	"external_etag" text,
	"external_synced_at" timestamp with time zone,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_uuid" uuid,
	"raw_text" text NOT NULL,
	"source" text NOT NULL,
	"audio_path" text,
	"captured_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"parse_result" jsonb,
	"confidence" real,
	"entity_type" text,
	"entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_items_client_uuid_unique" UNIQUE("client_uuid"),
	CONSTRAINT "inbox_items_status" CHECK ("inbox_items"."status" in ('pending','parsed','needs_confirm','confirmed','failed')),
	CONSTRAINT "inbox_items_source" CHECK ("inbox_items"."source" in ('siri','ptt','web','share','assistant')),
	CONSTRAINT "inbox_items_entity_type" CHECK ("inbox_items"."entity_type" is null or "inbox_items"."entity_type" in ('note','task','event'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "item_tags" (
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "item_tags_item_type_item_id_tag_id_pk" PRIMARY KEY("item_type","item_id","tag_id"),
	CONSTRAINT "item_tags_item_type" CHECK ("item_tags"."item_type" in ('task','note','event'))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"status" text DEFAULT 'inbox' NOT NULL,
	"due_at" timestamp with time zone,
	"due_local" timestamp,
	"remind_at" timestamp with time zone,
	"timezone" text NOT NULL,
	"priority" smallint,
	"project_id" uuid,
	"completed_at" timestamp with time zone,
	"rrule" text,
	"recurrence_timezone" text,
	"recurrence_anchor" text,
	"recurrence_until" timestamp with time zone,
	"recurrence_count" integer,
	"recurrence_exdates" date[],
	"parent_task_id" uuid,
	"original_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_status" CHECK ("tasks"."status" in ('inbox','active','done','dropped')),
	CONSTRAINT "tasks_recurrence_anchor" CHECK ("tasks"."recurrence_anchor" is null or "tasks"."recurrence_anchor" in ('due_date','completion_date'))
);
--> statement-breakpoint
CREATE TABLE "occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_type" text NOT NULL,
	"parent_id" uuid NOT NULL,
	"occurs_at" timestamp with time zone NOT NULL,
	"occurs_local" timestamp NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"lazy_generated" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "occurrences_parent_type" CHECK ("occurrences"."parent_type" in ('task','event')),
	CONSTRAINT "occurrences_status" CHECK ("occurrences"."status" in ('scheduled','done','skipped'))
);
--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_connection_id_ai_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."ai_provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task_routes" ADD CONSTRAINT "ai_task_routes_primary_model_id_ai_models_id_fk" FOREIGN KEY ("primary_model_id") REFERENCES "public"."ai_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_parent_event_id_events_id_fk" FOREIGN KEY ("parent_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_recurrence_due_idx" ON "events" USING btree ("rrule") WHERE "events"."rrule" is not null;--> statement-breakpoint
CREATE INDEX "inbox_items_status_idx" ON "inbox_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_recurrence_due_idx" ON "tasks" USING btree ("recurrence_anchor") WHERE "tasks"."rrule" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_parent_occurs_at_key" ON "occurrences" USING btree ("parent_type","parent_id","occurs_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_occurrence_per_lazy_parent" ON "occurrences" USING btree ("parent_type","parent_id") WHERE "occurrences"."status" = 'scheduled' and "occurrences"."lazy_generated";--> statement-breakpoint
CREATE INDEX "occurrences_occurs_at_idx" ON "occurrences" USING btree ("occurs_at");