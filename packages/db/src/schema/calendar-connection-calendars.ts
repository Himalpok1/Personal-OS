import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { calendarConnections } from "./calendar-connections.js";
import { projects } from "./projects.js";

// One row per Google calendar (not just per account) a connection has been
// told about, letting the user opt individual calendars in/out of sync
// independently (Phase 4 Checkpoint 4.5 Stage B).
export const calendarConnectionCalendars = pgTable(
  "calendar_connection_calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => calendarConnections.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id").notNull(),
    summary: text("summary").notNull(),
    syncEnabled: boolean("sync_enabled").notNull().default(false),
    // Inbound landing hint only -- which local project a newly-imported
    // Google event attaches to. Never used to decide outbound push
    // behavior.
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    nextSyncToken: text("next_sync_token"),
    // Status/observability metadata only. Sync conflict decisions compare
    // event_external_links.last_synced_local_updated_at against
    // event_external_links.google_updated_at -- never this column.
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
  ],
);
