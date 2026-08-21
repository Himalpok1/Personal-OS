import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { calendarConnections } from "./calendar-connections.js";
import { events } from "./events.js";

// Links a top-level local event (one-off, or a recurring MASTER -- never an
// occurrence exception) to its external calendar counterpart (Google or CalDAV).
// Occurrence-level exceptions under a recurring master are tracked separately in
// calendar-event-instances.ts.
export const eventExternalLinks = pgTable(
  "event_external_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // A local event links to at most one external calendar.
    eventId: uuid("event_id")
      .notNull()
      .unique()
      .references(() => events.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => calendarConnections.id, { onDelete: "cascade" }),
    // Google-specific fields
    googleCalendarId: text("google_calendar_id"),
    googleEventId: text("google_event_id"),
    googleIcalUid: text("google_ical_uid"),
    googleEtag: text("google_etag"),
    googleUpdatedAt: timestamp("google_updated_at", { withTimezone: true }),
    // CalDAV-specific fields
    caldavCalendarUrl: text("caldav_calendar_url"),
    caldavResourceUrl: text("caldav_resource_url"),
    caldavIcalUid: text("caldav_ical_uid"),
    caldavEtag: text("caldav_etag"),
    caldavUpdatedAt: timestamp("caldav_updated_at", { withTimezone: true }),
    // Common baseline & status
    lastSyncedLocalUpdatedAt: timestamp("last_synced_local_updated_at", { withTimezone: true }),
    syncStatus: text("sync_status").notNull().default("synced"),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "event_external_links_sync_status",
      sql`${table.syncStatus} in ('synced','pending_push','conflict','error')`,
    ),
    uniqueIndex("event_external_links_connection_calendar_event_idx").on(
      table.connectionId,
      table.googleCalendarId,
      table.googleEventId,
    ),
    uniqueIndex("event_external_links_caldav_resource_idx")
      .on(table.connectionId, table.caldavCalendarUrl, table.caldavResourceUrl)
      .where(sql`${table.caldavResourceUrl} IS NOT NULL`),
    check(
      "event_external_links_invariants",
      sql`(${table.googleCalendarId} IS NOT NULL AND ${table.caldavCalendarUrl} IS NULL) OR (${table.googleCalendarId} IS NULL AND ${table.caldavCalendarUrl} IS NOT NULL)`,
    ),
  ],
);
