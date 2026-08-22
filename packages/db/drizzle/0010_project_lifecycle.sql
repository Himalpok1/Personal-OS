ALTER TABLE "projects" ADD COLUMN "goal" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "target_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_status" CHECK ("projects"."status" in ('active','paused','completed'));--> statement-breakpoint
CREATE INDEX "projects_target_date_active_idx" ON "projects" USING btree ("target_date") WHERE "projects"."archived_at" is null and "projects"."target_date" is not null;
