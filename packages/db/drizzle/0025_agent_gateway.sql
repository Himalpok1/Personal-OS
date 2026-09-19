CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"trust_level" text DEFAULT 'none' NOT NULL,
	"token_hash" text NOT NULL,
	"disclosure_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "agent_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"status" text NOT NULL,
	"error_class" text,
	"chars_returned" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "action_requests" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "action_requests" ADD COLUMN "correlation_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_trust_level" CHECK ("agents"."trust_level" in ('none','read','propose'));--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_name_length" CHECK (char_length("agents"."name") between 1 and 60);--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_tool_name" CHECK ("agent_tool_calls"."tool_name" in ('search_personal_items','get_item_context','get_today_context','get_calendar_context','get_task_context','get_academic_context'));--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_status" CHECK ("agent_tool_calls"."status" in ('completed','refused','failed'));--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_error_pair" CHECK (("agent_tool_calls"."status" = 'completed') = ("agent_tool_calls"."error_class" is null));--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_chars_nonneg" CHECK ("agent_tool_calls"."chars_returned" >= 0);--> statement-breakpoint
ALTER TABLE "action_requests" DROP CONSTRAINT "action_requests_source";--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_source" CHECK ("action_requests"."source" in ('focus_now','briefing','academic','manual','agent'));--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_agent_principal" CHECK (("action_requests"."principal" = 'agent') = ("action_requests"."agent_id" is not null));--> statement-breakpoint
CREATE UNIQUE INDEX "agents_token_hash_unique" ON "agents" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agent_tool_calls_agent_id_called_at_idx" ON "agent_tool_calls" USING btree ("agent_id","called_at");--> statement-breakpoint
CREATE INDEX "agent_tool_calls_correlation_id_idx" ON "agent_tool_calls" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "action_requests_agent_id_requested_at_idx" ON "action_requests" USING btree ("agent_id","requested_at");
