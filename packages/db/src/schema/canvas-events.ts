import { bigint, boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { canvasConnections } from "./canvas-connections.js";
import { canvasCourses } from "./canvas-courses.js";

// ADR-068 Canvas LMS integration (migration 0020).
//
// course_id is NULLABLE, unlike canvas_assignments/canvas_announcements:
// some Canvas calendar events are personal (not scoped to any course), so a
// NOT NULL foreign key here would be false to the source data.
//
// ONLY real calendar_events(type=event) rows belong in this table. Assignment
// due dates are NEVER duplicated into it -- the assignment row is the one
// source of a due instant, mirroring this project's standing rule against a
// second source of truth for calendar data (see docs/ARCHITECTURE.md's
// "no second source of truth for tasks/reminders/calendar data" and the
// events.origin precedent, ADR-064). The live discovery probe found the
// endpoint reachable but zero live examples across the owner's account, so
// this table may legitimately stay empty -- that is expected, not a defect.
//
// title and location_name are truncated at write (text-bounds.ts convention),
// never rejected, since the owner didn't type them.
export const canvasEvents = pgTable(
  "canvas_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => canvasConnections.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").references(() => canvasCourses.id, { onDelete: "cascade" }),
    canvasEventId: bigint("canvas_event_id", { mode: "number" }).notNull(),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),
    locationName: text("location_name"),
    htmlUrl: text("html_url"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("canvas_events_connection_event_unique").on(
      table.connectionId,
      table.canvasEventId,
    ),
  ],
);
