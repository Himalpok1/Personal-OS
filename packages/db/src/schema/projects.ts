import { pgTable, text, timestamp, uuid, date, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Lifecycle status (ADR-039): 'active' | 'paused' | 'completed', enforced
    // by the projects_status CHECK in migration 0010; transitions ship via
    // dedicated endpoints in Checkpoint 5.2. Deliberately disjoint from
    // archivedAt below -- lifecycle and soft-delete are separate axes.
    status: text("status").notNull().default("active"),
    color: text("color"),
    goal: text("goal"),
    targetDate: date("target_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Soft-delete: set by POST /projects/:id/archive. Does not cascade to
    // tasks/notes/events -- those keep their project_id (the existing
    // onDelete: "set null" FK is unaffected since nothing is being deleted).
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // ADR-039 lifecycle vocabulary; 'archived' is deliberately excluded --
    // archived_at above is the separate soft-delete axis.
    check("projects_status", sql`${table.status} in ('active', 'paused', 'completed')`),
    // Upcoming-deadline lookups for Today/project views (migration 0010).
    index("projects_target_date_active_idx")
      .on(table.targetDate)
      .where(sql`${table.archivedAt} is null and ${table.targetDate} is not null`),
  ],
);
