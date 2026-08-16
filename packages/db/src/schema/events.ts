import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("events_recurrence_due_idx")
      .on(table.rrule)
      .where(sql`${table.rrule} is not null`),
  ],
);
