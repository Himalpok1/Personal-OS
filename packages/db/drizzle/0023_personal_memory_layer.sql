CREATE TABLE "memory_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "memory_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suggestion_key" text NOT NULL,
	"suggestion_kind" text NOT NULL,
	"project_id" uuid,
	"status" text NOT NULL,
	"ask_again_after" timestamp with time zone,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"statement" text NOT NULL,
	"note" text,
	"source" text NOT NULL,
	"suggestion_id" uuid,
	"project_id" uuid,
	"canvas_course_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "memory_suggestions" ADD CONSTRAINT "memory_suggestions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_suggestion_id_memory_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."memory_suggestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_canvas_course_id_canvas_courses_id_fk" FOREIGN KEY ("canvas_course_id") REFERENCES "public"."canvas_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_settings" ADD CONSTRAINT "memory_settings_singleton" CHECK ("memory_settings"."id" in ('singleton'));--> statement-breakpoint
ALTER TABLE "memory_suggestions" ADD CONSTRAINT "memory_suggestions_suggestion_kind" CHECK ("memory_suggestions"."suggestion_kind" in ('project_goal'));--> statement-breakpoint
ALTER TABLE "memory_suggestions" ADD CONSTRAINT "memory_suggestions_status" CHECK ("memory_suggestions"."status" in ('accepted','dismissed','never'));--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_kind" CHECK ("memories"."kind" in ('preference','goal','fact'));--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_source" CHECK ("memories"."source" in ('user','suggestion'));--> statement-breakpoint
CREATE UNIQUE INDEX "memory_suggestions_key_unique" ON "memory_suggestions" USING btree ("suggestion_key");--> statement-breakpoint
CREATE INDEX "memory_suggestions_project_id_idx" ON "memory_suggestions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "memories_project_id_idx" ON "memories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "memories_canvas_course_id_idx" ON "memories" USING btree ("canvas_course_id");--> statement-breakpoint
CREATE INDEX "memories_suggestion_id_idx" ON "memories" USING btree ("suggestion_id");--> statement-breakpoint
CREATE INDEX "memories_kind_updated_at_idx" ON "memories" USING btree ("kind","updated_at");
