import { bigint, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { canvasConnections } from "./canvas-connections.js";

// ADR-068 Canvas LMS integration (migration 0020).
//
// enrollment_state and workflow_state carry NO check constraint on purpose
// (ADR-050): both are Canvas-defined, provider-controlled vocabularies that
// can grow, so widening a CHECK later would need a DROP CONSTRAINT, which
// reconcile-drizzle-tracking.ts cannot process (the 0009 fallout). Zod
// (packages/schema) enforces them instead -- the same treatment
// mail_connections.provider and health_connections.source_family already get.
//
// This is deliberately narrower than what GET /courses returns: uuid,
// license, calendar.ics, storage_quota_mb, blueprint/template flags,
// is_public*, and every account/root-account id are all dropped as
// not-Personal-OS-functional (ADR-068 §3). name is truncated at write to this
// project's provider-string convention (text-bounds.ts); it is not rejected,
// because the owner didn't type it.
export const canvasCourses = pgTable(
  "canvas_courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => canvasConnections.id, { onDelete: "cascade" }),
    canvasCourseId: bigint("canvas_course_id", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    courseCode: text("course_code"),
    termName: text("term_name"),
    termStartAt: timestamp("term_start_at", { withTimezone: true }),
    termEndAt: timestamp("term_end_at", { withTimezone: true }),
    enrollmentState: text("enrollment_state"),
    workflowState: text("workflow_state"),
    htmlUrl: text("html_url"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("canvas_courses_connection_course_unique").on(
      table.connectionId,
      table.canvasCourseId,
    ),
  ],
);
