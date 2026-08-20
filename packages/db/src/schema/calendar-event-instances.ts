import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { calendarConnections } from "./calendar-connections.js";
import { events } from "./events.js";

// Occurrence-level exceptions under a recurring master. Covers both the
// detached case (a real local child `events` row exists, mapping_status =
// 'detached') and the cancelled case (per Checkpoint 4.4's own
// cancel-occurrence semantics, no local row exists for a cancelled
// occurrence -- only a parent exdate -- mapping_status = 'cancelled',
// local_detached_event_id null). A single event_external_links
// (event_id UNIQUE) table cannot represent the cancelled case since there's
// no event_id to key on; this table is what makes that representable.
//
// Invariant: mapping_status = 'detached' iff local_detached_event_id is not
// null. Enforced both as a DB check constraint below and documented here
// for anything reading the schema without the SQL in front of it.
export const calendarEventInstances = pgTable(
  "calendar_event_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => calendarConnections.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id").notNull(),
    // The recurring master's Google event id.
    googleMasterEventId: text("google_master_event_id").notNull(),
    // The exception/instance's OWN Google event id -- cancelled instances
    // still have their own id.
    googleInstanceEventId: text("google_instance_event_id").notNull(),
    // Google's originalStartTime -- the correlation key.
    googleOriginalStartTime: timestamp("google_original_start_time", {
      withTimezone: true,
    }).notNull(),
    // The local recurring parent.
    localParentEventId: uuid("local_parent_event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    // Mirrors events.original_start_at semantics -- the local occurrence
    // identity, same shape as events.ts's events_detached_unique_idx.
    localOriginalStartAt: timestamp("local_original_start_at", { withTimezone: true }).notNull(),
    // Null when cancelled; set to the detached child's id when detached.
    localDetachedEventId: uuid("local_detached_event_id").references(() => events.id, {
      onDelete: "cascade",
    }),
    mappingStatus: text("mapping_status").notNull(),
    googleEtag: text("google_etag"),
    googleUpdatedAt: timestamp("google_updated_at", { withTimezone: true }),
    // Null when cancelled (nothing local to compare against); set when
    // detached -- the per-link baseline for this occurrence.
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
    // Authoritative dedupe, mirrors event_external_links.
    uniqueIndex("calendar_event_instances_connection_calendar_instance_idx").on(
      table.connectionId,
      table.googleCalendarId,
      table.googleInstanceEventId,
    ),
    // One mapping per local occurrence slot.
    uniqueIndex("calendar_event_instances_parent_original_start_idx").on(
      table.localParentEventId,
      table.localOriginalStartAt,
    ),
  ],
);
