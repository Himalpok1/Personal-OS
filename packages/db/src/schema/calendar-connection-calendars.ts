import { boolean, check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { calendarConnections } from "./calendar-connections.js";
import { projects } from "./projects.js";

// One row per external calendar (Google or CalDAV collection) a connection has been
// told about, letting the user opt individual calendars in/out of sync
// independently.
export const calendarConnectionCalendars = pgTable(
  "calendar_connection_calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => calendarConnections.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id"),
    caldavCalendarUrl: text("caldav_calendar_url"),
    summary: text("summary").notNull(),
    syncEnabled: boolean("sync_enabled").notNull().default(false),
    // Provider-reported write capability (Checkpoint 9.5). Google: the
    // calendarList `accessRole` ('owner' | 'writer' | 'reader' |
    // 'freeBusyReader'), refreshed whenever the calendar list is read.
    // CalDAV: NULL (no equivalent is fetched). NULL means UNKNOWN, never
    // writable -- a Google calendar with no recorded role is not offered as
    // an authoring target. No CHECK (ADR-050: provider-defined vocabulary).
    accessRole: text("access_role"),
    // Inbound landing hint only -- which local project a newly-imported
    // event attaches to. Never used to decide outbound push behavior.
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    nextSyncToken: text("next_sync_token"),
    // Status/observability metadata only.
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: true }),
    lastFullSyncAt: timestamp("last_full_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("calendar_connection_calendars_connection_calendar_idx").on(
      table.connectionId,
      table.googleCalendarId,
    ),
    uniqueIndex("calendar_connection_calendars_caldav_idx")
      .on(table.connectionId, table.caldavCalendarUrl)
      .where(sql`${table.caldavCalendarUrl} IS NOT NULL`),
    check(
      "calendar_connection_calendars_invariants",
      sql`(${table.googleCalendarId} IS NOT NULL AND ${table.caldavCalendarUrl} IS NULL) OR (${table.googleCalendarId} IS NULL AND ${table.caldavCalendarUrl} IS NOT NULL)`,
    ),
  ],
);
