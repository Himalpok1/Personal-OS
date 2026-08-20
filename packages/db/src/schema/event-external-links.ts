import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { calendarConnections } from "./calendar-connections.js";
import { events } from "./events.js";

// Links a top-level local event (one-off, or a recurring MASTER -- never an
// occurrence exception) to its Google Calendar counterpart. Occurrence-level
// exceptions under a recurring master are tracked separately in
// calendar-event-instances.ts, because a cancelled occurrence (per
// Checkpoint 4.4's cancel-occurrence semantics) has no local `events` row to
// key this table's unique event_id on.
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
    googleCalendarId: text("google_calendar_id").notNull(),
    googleEventId: text("google_event_id").notNull(),
    // Correlation/debug metadata only -- never used for dedupe lookup. The
    // (connection_id, google_calendar_id, google_event_id) unique index
    // below is the authoritative dedupe identity.
    googleIcalUid: text("google_ical_uid"),
    googleEtag: text("google_etag"),
    // Remote half of the per-link conflict baseline.
    googleUpdatedAt: timestamp("google_updated_at", { withTimezone: true }),
    // Local half of the per-link conflict baseline -- sync logic compares
    // events.updated_at against THIS column, never
    // calendar_connection_calendars.last_successful_sync_at.
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
  ],
);
