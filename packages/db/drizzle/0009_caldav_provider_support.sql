-- Migration 0009_caldav_provider_support.sql
-- Checkpoint 4.6: Add CalDAV support to calendar connections, calendars, external links, and instances

-- 1. Expand calendar_connections provider check
ALTER TABLE "calendar_connections" DROP CONSTRAINT IF EXISTS "calendar_connections_provider";
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_provider" CHECK ("provider" in ('google', 'caldav'));

-- 2. Make Google-specific connection columns nullable
ALTER TABLE "calendar_connections" ALTER COLUMN "google_account_email" DROP NOT NULL;
ALTER TABLE "calendar_connections" ALTER COLUMN "google_account_id" DROP NOT NULL;
ALTER TABLE "calendar_connections" ALTER COLUMN "granted_scope" DROP NOT NULL;

-- 3. Add CalDAV connection columns
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "server_url" text;
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "username" text;
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "auth_type" text DEFAULT 'basic';
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "principal_url" text;
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "calendar_home_set_url" text;
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "password_ciphertext" bytea;
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "password_iv" bytea;
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "password_auth_tag" bytea;

ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_provider_invariants" CHECK (
  ("provider" = 'google' AND "google_account_email" IS NOT NULL AND "google_account_id" IS NOT NULL) OR
  ("provider" = 'caldav' AND "server_url" IS NOT NULL AND "username" IS NOT NULL)
);

-- 4. Calendar collection URL for calendar_connection_calendars
ALTER TABLE "calendar_connection_calendars" ALTER COLUMN "google_calendar_id" DROP NOT NULL;
ALTER TABLE "calendar_connection_calendars" ADD COLUMN IF NOT EXISTS "caldav_calendar_url" text;
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_connection_calendars_caldav_idx"
  ON "calendar_connection_calendars" ("connection_id", "caldav_calendar_url")
  WHERE "caldav_calendar_url" IS NOT NULL;

ALTER TABLE "calendar_connection_calendars" ADD CONSTRAINT "calendar_connection_calendars_invariants" CHECK (
  ("google_calendar_id" IS NOT NULL AND "caldav_calendar_url" IS NULL) OR
  ("google_calendar_id" IS NULL AND "caldav_calendar_url" IS NOT NULL)
);

-- 5. CalDAV resource columns on event_external_links
ALTER TABLE "event_external_links" ALTER COLUMN "google_calendar_id" DROP NOT NULL;
ALTER TABLE "event_external_links" ADD COLUMN IF NOT EXISTS "caldav_calendar_url" text;
ALTER TABLE "event_external_links" ADD COLUMN IF NOT EXISTS "caldav_resource_url" text;
ALTER TABLE "event_external_links" ADD COLUMN IF NOT EXISTS "caldav_ical_uid" text;
ALTER TABLE "event_external_links" ADD COLUMN IF NOT EXISTS "caldav_etag" text;
ALTER TABLE "event_external_links" ADD COLUMN IF NOT EXISTS "caldav_updated_at" timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS "event_external_links_caldav_resource_idx"
  ON "event_external_links" ("connection_id", "caldav_calendar_url", "caldav_resource_url")
  WHERE "caldav_resource_url" IS NOT NULL;

ALTER TABLE "event_external_links" ADD CONSTRAINT "event_external_links_invariants" CHECK (
  ("google_calendar_id" IS NOT NULL AND "caldav_calendar_url" IS NULL) OR
  ("google_calendar_id" IS NULL AND "caldav_calendar_url" IS NOT NULL)
);

-- 6. CalDAV instance columns on calendar_event_instances
ALTER TABLE "calendar_event_instances" ALTER COLUMN "google_calendar_id" DROP NOT NULL;
ALTER TABLE "calendar_event_instances" ALTER COLUMN "google_master_event_id" DROP NOT NULL;
ALTER TABLE "calendar_event_instances" ALTER COLUMN "google_instance_event_id" DROP NOT NULL;
ALTER TABLE "calendar_event_instances" ALTER COLUMN "google_original_start_time" DROP NOT NULL;

ALTER TABLE "calendar_event_instances" ADD COLUMN IF NOT EXISTS "caldav_calendar_url" text;
ALTER TABLE "calendar_event_instances" ADD COLUMN IF NOT EXISTS "caldav_resource_url" text;
ALTER TABLE "calendar_event_instances" ADD COLUMN IF NOT EXISTS "caldav_recurrence_id" text;
ALTER TABLE "calendar_event_instances" ADD COLUMN IF NOT EXISTS "caldav_etag" text;
ALTER TABLE "calendar_event_instances" ADD COLUMN IF NOT EXISTS "caldav_updated_at" timestamp with time zone;
