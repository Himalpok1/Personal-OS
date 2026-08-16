import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";

// Not in docs/ARCHITECTURE.md's original Data model section, which defines
// create_note as a parser tool and entity_type = 'note' on inbox_items but
// never a table for it to point to -- added as the obvious missing piece
// (user-approved 2026-08-15), following the same shape as tasks/events.
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
