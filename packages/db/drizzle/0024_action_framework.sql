CREATE TABLE "permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal" text NOT NULL,
	"permission" text NOT NULL,
	"disclosure_version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "action_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_uuid" uuid,
	"action_id" text NOT NULL,
	"principal" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"reason" text,
	"input" jsonb NOT NULL,
	"input_summary" text NOT NULL,
	"result_summary" text,
	"target_type" text,
	"target_id" uuid,
	"error_class" text,
	"reverses_request_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_reverses_request_id_action_requests_id_fk" FOREIGN KEY ("reverses_request_id") REFERENCES "public"."action_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_principal" CHECK ("permission_grants"."principal" in ('app','agent'));--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_principal" CHECK ("action_requests"."principal" in ('app','agent'));--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_status" CHECK ("action_requests"."status" in ('pending','executing','completed','failed','cancelled','expired'));--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_source" CHECK ("action_requests"."source" in ('focus_now','briefing','academic','manual'));--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_target_type" CHECK ("action_requests"."target_type" is null or "action_requests"."target_type" in ('task','event'));--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_target_pair" CHECK (("action_requests"."target_type" is null) = ("action_requests"."target_id" is null));--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_no_self_reversal" CHECK ("action_requests"."reverses_request_id" is null or "action_requests"."reverses_request_id" <> "action_requests"."id");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grants_live_unique" ON "permission_grants" USING btree ("principal","permission") WHERE "permission_grants"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "permission_grants_permission_idx" ON "permission_grants" USING btree ("permission");--> statement-breakpoint
CREATE UNIQUE INDEX "action_requests_client_uuid_idx" ON "action_requests" USING btree ("client_uuid") WHERE "action_requests"."client_uuid" is not null;--> statement-breakpoint
CREATE INDEX "action_requests_status_requested_at_idx" ON "action_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "action_requests_action_id_requested_at_idx" ON "action_requests" USING btree ("action_id","requested_at");--> statement-breakpoint
CREATE INDEX "action_requests_reverses_request_id_idx" ON "action_requests" USING btree ("reverses_request_id");--> statement-breakpoint
CREATE INDEX "action_requests_target_idx" ON "action_requests" USING btree ("target_type","target_id");
