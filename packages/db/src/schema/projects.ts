import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Free-text, unconstrained, not exposed as an editable field in Phase 2 --
  // deliberately left alone rather than given a check constraint, since
  // 'active'/'archived' as a status vocabulary would collide in meaning
  // with archivedAt below (organizational status vs. soft-delete are kept
  // as separate axes). A future status workflow should pick names that
  // don't collide with "archived".
  status: text("status").notNull().default("active"),
  color: text("color"),
  // Soft-delete: set by POST /projects/:id/archive. Does not cascade to
  // tasks/notes/events -- those keep their project_id (the existing
  // onDelete: "set null" FK is unaffected since nothing is being deleted).
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
