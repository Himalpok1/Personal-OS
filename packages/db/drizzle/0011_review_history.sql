CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"period_start" date NOT NULL,
	"timezone" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"content" jsonb,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_kind" CHECK ("reviews"."kind" in ('daily','weekly'));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_status" CHECK ("reviews"."status" in ('in_progress','completed','skipped'));--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_kind_period_start_unique" ON "reviews" USING btree ("kind","period_start");--> statement-breakpoint
CREATE INDEX "reviews_completed_at_idx" ON "reviews" USING btree ("completed_at");
