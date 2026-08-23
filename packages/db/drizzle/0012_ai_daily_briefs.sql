CREATE TABLE "ai_daily_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_date" date NOT NULL,
	"timezone" text NOT NULL,
	"content" jsonb NOT NULL,
	"model_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "ai_daily_briefs" ADD CONSTRAINT "ai_daily_briefs_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_daily_briefs_date_timezone_unique" ON "ai_daily_briefs" USING btree ("brief_date","timezone");
