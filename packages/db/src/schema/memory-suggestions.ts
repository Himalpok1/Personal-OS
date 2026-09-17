import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";

// Checkpoint 10.7 (ADR-077): the owner's ANSWERS to memory suggestions --
// never the suggestions themselves.
//
// A suggestion ("Would you like me to remember the goal you set on Thesis?")
// is computed at request time from rows the owner already sees (today: a
// project with a goal and no goal memory linked to it) and is never stored
// while pending. Only the decision persists: `accepted` (the memory row
// points back here through memories.suggestion_id), `dismissed` (offer again
// after `ask_again_after`), or `never` (never offer this key again). This
// table therefore carries NO statement text -- the key is a deterministic
// `<suggestion_kind>:<entity id>`, and the proposed sentence is re-derived
// from the source row whenever it is shown. That is what keeps "never ask
// again" from being a second copy of the thing the owner declined to remember.
//
// `suggestion_kind` is a project-controlled closed vocabulary (ADR-050), so it
// is CHECKed; widening it is a migration, on purpose -- every new suggestion
// source is a reviewed decision about what may prompt the owner, not a string.
export const memorySuggestions = pgTable(
  "memory_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suggestionKey: text("suggestion_key").notNull(),
    suggestionKind: text("suggestion_kind").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    status: text("status").notNull(),
    askAgainAfter: timestamp("ask_again_after", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("memory_suggestions_suggestion_kind", sql`${table.suggestionKind} in ('project_goal')`),
    check("memory_suggestions_status", sql`${table.status} in ('accepted','dismissed','never')`),
    uniqueIndex("memory_suggestions_key_unique").on(table.suggestionKey),
    index("memory_suggestions_project_id_idx").on(table.projectId),
  ],
);
