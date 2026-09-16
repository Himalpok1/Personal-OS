CREATE TABLE "canvas_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canvas_base_url" text NOT NULL,
	"canvas_user_id" bigint NOT NULL,
	"canvas_user_name" text,
	"access_token_ciphertext" bytea,
	"access_token_iv" bytea,
	"access_token_auth_tag" bytea,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" text,
	"last_sync_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "canvas_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"canvas_course_id" bigint NOT NULL,
	"name" text NOT NULL,
	"course_code" text,
	"term_name" text,
	"term_start_at" timestamp with time zone,
	"term_end_at" timestamp with time zone,
	"enrollment_state" text,
	"workflow_state" text,
	"html_url" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "canvas_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"canvas_assignment_id" bigint NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"points_possible" real,
	"submission_types" text[],
	"html_url" text,
	"published" boolean DEFAULT true NOT NULL,
	"submission_state" text,
	"submission_missing" boolean,
	"submission_late" boolean,
	"submitted_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "canvas_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"canvas_announcement_id" bigint NOT NULL,
	"title" text NOT NULL,
	"message_preview" text,
	"posted_at" timestamp with time zone,
	"html_url" text,
	"read_state" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "canvas_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"course_id" uuid,
	"canvas_event_id" bigint NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"location_name" text,
	"html_url" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "canvas_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"courses_synced" integer,
	"assignments_synced" integer,
	"announcements_synced" integer,
	"events_synced" integer,
	"failure_class" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "canvas_courses" ADD CONSTRAINT "canvas_courses_connection_id_canvas_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."canvas_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_assignments" ADD CONSTRAINT "canvas_assignments_connection_id_canvas_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."canvas_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_assignments" ADD CONSTRAINT "canvas_assignments_course_id_canvas_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."canvas_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_announcements" ADD CONSTRAINT "canvas_announcements_connection_id_canvas_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."canvas_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_announcements" ADD CONSTRAINT "canvas_announcements_course_id_canvas_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."canvas_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_events" ADD CONSTRAINT "canvas_events_connection_id_canvas_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."canvas_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_events" ADD CONSTRAINT "canvas_events_course_id_canvas_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."canvas_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_sync_runs" ADD CONSTRAINT "canvas_sync_runs_connection_id_canvas_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."canvas_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_connections" ADD CONSTRAINT "canvas_connections_status" CHECK ("canvas_connections"."status" in ('active','disconnected','invalid_token'));--> statement-breakpoint
ALTER TABLE "canvas_connections" ADD CONSTRAINT "canvas_connections_access_token_triple" CHECK (("canvas_connections"."access_token_ciphertext" is null and "canvas_connections"."access_token_iv" is null and "canvas_connections"."access_token_auth_tag" is null)
        or ("canvas_connections"."access_token_ciphertext" is not null and "canvas_connections"."access_token_iv" is not null and "canvas_connections"."access_token_auth_tag" is not null));--> statement-breakpoint
ALTER TABLE "canvas_sync_runs" ADD CONSTRAINT "canvas_sync_runs_kind" CHECK ("canvas_sync_runs"."kind" in ('manual','cron'));--> statement-breakpoint
ALTER TABLE "canvas_sync_runs" ADD CONSTRAINT "canvas_sync_runs_status" CHECK ("canvas_sync_runs"."status" in ('succeeded','failed','skipped'));--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_connections_base_url_unique" ON "canvas_connections" USING btree ("canvas_base_url");--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_courses_connection_course_unique" ON "canvas_courses" USING btree ("connection_id","canvas_course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_assignments_connection_assignment_unique" ON "canvas_assignments" USING btree ("connection_id","canvas_assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_announcements_connection_announcement_unique" ON "canvas_announcements" USING btree ("connection_id","canvas_announcement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_events_connection_event_unique" ON "canvas_events" USING btree ("connection_id","canvas_event_id");--> statement-breakpoint
CREATE INDEX "canvas_sync_runs_connection_started_at_idx" ON "canvas_sync_runs" USING btree ("connection_id","started_at");
