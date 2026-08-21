import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { calendarConnections } from "./calendar-connections.js";
import { events } from "./events.js";

// Occurrence-level exceptions under a recurring master (Google or CalDAV).
// Covers both the detached case (a real local child `events` row exists, mapping_status = 'detached')
// and the cancelled case (mapping_status = 'cancelled', local_detached_event_id null).
export const calendarEventInstances = pgTable(
  "calendar_event_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => calendarConnections.id, { onDelete: "cascade" }),
    // Google-specific fields
    googleCalendarId: text("google_calendar_id"),
    googleMasterEventId: text("google_master_event_id"),
    googleInstanceEventId: text("google_instance_event_id"),
    googleOriginalStartTime: timestamp("google_original_start_time", {
      withTimezone: true,
    }),
    // CalDAV-specific fields
    caldavCalendarUrl: text("caldav_calendar_url"),
    caldavResourceUrl: text("caldav_resource_url"),
    caldavRecurrenceId: text("caldav_recurrence_id"),
    caldavEtag: text("caldav_etag"),
    caldavUpdatedAt: timestamp("caldav_updated_at", { withTimezone: true }),
    // Common local recurrence linkage
    localParentEventId: uuid("local_parent_event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    localOriginalStartAt: timestamp("local_original_start_at", { withTimezone: true }).notNull(),
    localDetachedEventId: uuid("local_detached_event_id").references(() => events.id, {
      onDelete: "cascade",
    }),
    mappingStatus: text("mapping_status").notNull(),
    googleEtag: text("google_etag"),
    googleUpdatedAt: timestamp("google_updated_at", { withTimezone: true }),
    lastSyncedLocalUpdatedAt: timestamp("last_synced_local_updated_at", { withTimezone: true }),
    syncStatus: text("sync_status").notNull().default("synced"),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "calendar_event_instances_mapping_status",
      sql`${table.mappingStatus} in ('detached','cancelled')`,
    ),
    check(
      "calendar_event_instances_mapping_consistency",
      sql`(${table.mappingStatus} = 'detached') = (${table.localDetachedEventId} is not null)`,
    ),
    check(
      "calendar_event_instances_sync_status",
      sql`${table.syncStatus} in ('synced','pending_push','conflict','error')`,
    ),
    // Authoritative Google instance dedupe
    uniqueIndex("calendar_event_instances_connection_calendar_instance_idx").on(
      table.connectionId,
      table.googleCalendarId,
      table.googleInstanceEventId,
    ),
    // One mapping per local occurrence slot (provider-agnostic)
    uniqueIndex("calendar_event_instances_parent_original_start_idx").on(
      table.localParentEventId,
      table.localOriginalStartAt,
    ),
  ],
);
