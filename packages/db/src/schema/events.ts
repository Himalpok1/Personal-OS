import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { projects } from "./projects.js";

// Modeled now even though calendar UI/sync is Phase 4 -- adding these
// columns later to a populated table is a worse migration than adding them
// empty (see docs/ARCHITECTURE.md). Events have no recurrence_anchor: unlike
// tasks, recurring events are always due-date-style (pre-expanded), never
// completion-anchored.
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    startLocal: timestamp("start_local"),
    endLocal: timestamp("end_local"),
    timezone: text("timezone").notNull(),
    allDay: boolean("all_day").notNull().default(false),
    // All-day events use dates, never midnight-timestamptz.
    startDate: date("start_date"),
    endDate: date("end_date"),
    rrule: text("rrule"),
    recurrenceTimezone: text("recurrence_timezone"),
    recurrenceUntil: timestamp("recurrence_until", { withTimezone: true }),
    recurrenceCount: integer("recurrence_count"),
    recurrenceExdates: date("recurrence_exdates").array(),
    parentEventId: uuid("parent_event_id").references((): AnyPgColumn => events.id),
    originalStartAt: timestamp("original_start_at", { withTimezone: true }),
    // External sync, unused until Phase 4.
    externalId: text("external_id"),
    externalSource: text("external_source"),
    externalEtag: text("external_etag"),
    externalSyncedAt: timestamp("external_synced_at", { withTimezone: true }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    // Soft-delete: set by POST /events/:id/archive (Checkpoint 4.1). See
    // tasks.ts's archivedAt comment for the full rationale (independent of
    // any lifecycle state; occurrences/item_tags lineage are never touched).
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Ownership (Checkpoint 9.5). 'local' = authored in Personal OS (POST
    // /events, capture commit) and editable/cancellable here; 'external' =
    // originated in a connected calendar and synced inward, read-only through
    // the ordinary edit/cancel surface. The DB default is 'external' ON
    // PURPOSE: every pre-9.5 production row was sync-ingested, a backfill
    // UPDATE is not reconcilable, and an insert path that forgets to set the
    // column fails SAFE (read-only) rather than editable. Every local writer
    // sets "local" explicitly and a test pins each one.
    origin: text("origin").notNull().default("external"),
    // Client-supplied idempotency key for POST /events (Checkpoint 9.5) --
    // the same role inbox_items.client_uuid plays for /capture. text rather
    // than uuid because the migration reconcile allowlist binds ADD COLUMN to
    // text/bytea/date/timestamptz/timestamp.
    clientUuid: text("client_uuid"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("events_origin", sql`${table.origin} in ('local', 'external')`),
    uniqueIndex("events_client_uuid_idx")
      .on(table.clientUuid)
      .where(sql`${table.clientUuid} is not null`),
    index("events_recurrence_due_idx")
      .on(table.rrule)
      .where(sql`${table.rrule} is not null`),
    // No event API/UI ships in Phase 2 -- added now (free additive DDL at
    // near-zero row counts) so Phase 4's calendar UI doesn't need a second
    // migration to close the same indexing gap tasks/notes had.
    index("events_project_id_idx").on(table.projectId),
    index("events_starts_at_idx").on(table.startsAt),
    // Partial variant added alongside archivedAt (Checkpoint 4.1) -- serves
    // GET /events' default list query, which (like tasks_status_due_at_idx)
    // always carries the archived_at is null predicate and orders by
    // starts_at. Left events_starts_at_idx itself untouched rather than
    // rewriting it in place, so this migration stays additive-only (no
    // DROP INDEX).
    index("events_starts_at_active_idx")
      .on(table.startsAt)
      .where(sql`${table.archivedAt} is null`),
    // Ensures at most one active detached event row per (parent, original_start_at)
    // occurrence slot.
    uniqueIndex("events_detached_unique_idx")
      .on(table.parentEventId, table.originalStartAt)
      .where(sql`${table.parentEventId} is not null and ${table.archivedAt} is null`),
  ],
);
