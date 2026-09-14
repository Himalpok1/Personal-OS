ALTER TABLE "events" ADD COLUMN "origin" text DEFAULT 'external' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_origin" CHECK ("origin" IN ('local', 'external'));--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "client_uuid" text;--> statement-breakpoint
CREATE UNIQUE INDEX "events_client_uuid_idx" ON "events" USING btree ("client_uuid") WHERE "client_uuid" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_connection_calendars" ADD COLUMN "access_role" text;
