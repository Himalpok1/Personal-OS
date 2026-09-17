import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { canvasCourses } from "./canvas-courses.js";
import { memorySuggestions } from "./memory-suggestions.js";
import { projects } from "./projects.js";

// Checkpoint 10.7 (ADR-077): explicit, owner-controlled memories.
//
// Every row exists because the owner typed it (`source = 'user'`) or accepted
// a suggestion shown to them (`source = 'suggestion'`, `suggestion_id` set).
// Nothing writes here unprompted: no parser, no sync job, no heuristic. The
// table is deliberately flat -- a bounded `statement`, an optional bounded
// `note`, a closed `kind`, and TWO narrow, typed, nullable links -- rather
// than a jsonb `detail` or a generic `(ref_type, ref_id)` pair. This project
// already ran the generic-relationship experiment (`tags`/`item_tags`, zero
// adoption, ADR-074) and the export/bounds/reconcile discipline all assume
// every user-authored value is a bounded scalar or null.
//
// The links are `set null`, never cascade, for the reason tasks.project_id
// and tasks.canvas_assignment_id are: the memory is the owner's own record;
// the project or course it points at is context, not its reason to exist.
//
// Deletion is a real row delete (the only user-authored entity with no
// `archived_at`): "delete a memory" must mean gone, and ADR-024 (no backups)
// makes that unrecoverable by design -- GET /export is the only undo.
//
// No AI lane, no read model other than its own, and no worker file may name
// this table: Guard 6 in apps/api/src/ask/ai-egress-guard.test.ts.
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    statement: text("statement").notNull(),
    note: text("note"),
    source: text("source").notNull(),
    suggestionId: uuid("suggestion_id").references(() => memorySuggestions.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    canvasCourseId: uuid("canvas_course_id").references(() => canvasCourses.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("memories_kind", sql`${table.kind} in ('preference','goal','fact')`),
    check("memories_source", sql`${table.source} in ('user','suggestion')`),
    index("memories_project_id_idx").on(table.projectId),
    index("memories_canvas_course_id_idx").on(table.canvasCourseId),
    index("memories_suggestion_id_idx").on(table.suggestionId),
    // The Memory Center lists by kind, newest edit first.
    index("memories_kind_updated_at_idx").on(table.kind, table.updatedAt),
  ],
);
