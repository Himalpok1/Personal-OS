import { inboxItems, notes, projects, tasks, type Db } from "@personal-os/db";
import {
  EXPORT_ENTITY_MAX_ROWS,
  EXPORT_FORMAT_VERSION,
  ExportResponseSchema,
  type ExportResponse,
} from "@personal-os/schema";
import { asc, count } from "drizzle-orm";
import { toProjectPayload } from "./project-summaries.js";

// GET /export -- the user-authored core, as JSON (Checkpoint 8.3).
//
// ===========================================================================
// THE ALLOWLIST IS THIS FILE PLUS packages/schema/src/export.ts, AND NOTHING
// ELSE IS REACHABLE FROM HERE
// ===========================================================================
//
// Two independent gates, and a column has to clear both:
//
//   1. A PROJECTION. Each `to*Payload` below names its fields one at a time.
//      There is no spread of a row, no `...row`, and no generic
//      column-enumerating helper -- so a column added to a table in a future
//      migration does not appear here by default. It appears when someone
//      writes its name.
//   2. A NON-PASSTHROUGH ZOD PARSE. `ExportResponseSchema.parse` drops or
//      rejects anything the contract does not declare, which is the same
//      mechanism `apps/api/src/routes/mail-connections.ts` relies on to make a
//      ciphertext column "structurally incapable of reaching the wire".
//
// Four tables are read. `SELECT *` over an arbitrary table is not expressible
// in this module, and neither is any table outside these four -- the imports at
// the top are the complete set, so a credential table is not merely omitted
// from a list, it is absent from the module's scope.
//
// WHY THE TASK/NOTE/INBOX PROJECTIONS ARE LOCAL rather than shared with the
// route files that build the same shapes: for an allowlist, locality beats
// reuse. Someone auditing "what leaves the system through /export" should read
// one file and be finished, not chase a helper that an unrelated route change
// could widen. `toProjectPayload` is the exception because it is ALREADY a
// shared, exported mapper (read-models/project-summaries.ts) -- re-typing it
// here would create a genuine second copy, which is the worse failure.

/**
 * The per-entity ceiling, applied as `limit + 0` with an honest total beside it.
 *
 * Deliberately NOT a `limit` query parameter. An export is complete or it is
 * not; a caller-tunable page size would turn "did I get everything" into a
 * question the caller has to know to ask.
 */
const ENTITY_LIMIT = EXPORT_ENTITY_MAX_ROWS;

function toTaskPayload(row: typeof tasks.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    due_at: row.dueAt ? row.dueAt.toISOString() : null,
    remind_at: row.remindAt ? row.remindAt.toISOString() : null,
    timezone: row.timezone,
    priority: row.priority,
    project_id: row.projectId,
    completed_at: row.completedAt ? row.completedAt.toISOString() : null,
    rrule: row.rrule,
    recurrence_anchor: row.recurrenceAnchor,
    recurrence_timezone: row.recurrenceTimezone,
    recurrence_until: row.recurrenceUntil ? row.recurrenceUntil.toISOString() : null,
    recurrence_count: row.recurrenceCount,
    recurrence_exdates: row.recurrenceExdates,
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function toNotePayload(row: typeof notes.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    project_id: row.projectId,
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * Narrower than what GET /inbox returns, on purpose.
 *
 * `client_uuid` (outbox plumbing), `confidence` (a column whose meaning changes
 * depending on whether parsing has run) and `parse_result` (unbounded LLM
 * output) are all excluded -- see InboxItemExportSchema for the reasoning.
 * `audio_path` is a server filesystem path and reaches no wire shape anywhere.
 */
function toInboxItemPayload(row: typeof inboxItems.$inferSelect) {
  return {
    id: row.id,
    raw_text: row.rawText,
    source: row.source,
    captured_at: row.capturedAt.toISOString(),
    timezone: row.timezone,
    status: row.status,
    entity_type: row.entityType,
    entity_id: row.entityId,
    created_at: row.createdAt.toISOString(),
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

/**
 * Assembles the export.
 *
 * `generatedAt` is injected rather than read from the clock here, so the route
 * owns the single instant the whole document is stamped with and a test can pin
 * it. Archived rows are included unconditionally (see ExportResponseSchema).
 */
export async function buildUserExport(db: Db, generatedAt: Date): Promise<ExportResponse> {
  const [
    projectRows,
    projectTotals,
    taskRows,
    taskTotals,
    noteRows,
    noteTotals,
    inboxRows,
    inboxTotals,
  ] = await Promise.all([
    db
      .select()
      .from(projects)
      .orderBy(asc(projects.createdAt), asc(projects.id))
      .limit(ENTITY_LIMIT),
    db.select({ total: count() }).from(projects),
    db.select().from(tasks).orderBy(asc(tasks.createdAt), asc(tasks.id)).limit(ENTITY_LIMIT),
    db.select({ total: count() }).from(tasks),
    db.select().from(notes).orderBy(asc(notes.createdAt), asc(notes.id)).limit(ENTITY_LIMIT),
    db.select({ total: count() }).from(notes),
    db
      .select()
      .from(inboxItems)
      .orderBy(asc(inboxItems.createdAt), asc(inboxItems.id))
      .limit(ENTITY_LIMIT),
    db.select({ total: count() }).from(inboxItems),
  ]);

  const counts = {
    projects: { returned: projectRows.length, total: projectTotals[0]?.total ?? 0 },
    tasks: { returned: taskRows.length, total: taskTotals[0]?.total ?? 0 },
    notes: { returned: noteRows.length, total: noteTotals[0]?.total ?? 0 },
    inbox_items: { returned: inboxRows.length, total: inboxTotals[0]?.total ?? 0 },
  };

  return ExportResponseSchema.parse({
    format_version: EXPORT_FORMAT_VERSION,
    generated_at: generatedAt.toISOString(),
    scope: "user_authored_core",
    truncated: Object.values(counts).some((entry) => entry.total > entry.returned),
    counts,
    projects: projectRows.map(toProjectPayload),
    tasks: taskRows.map(toTaskPayload),
    notes: noteRows.map(toNotePayload),
    inbox_items: inboxRows.map(toInboxItemPayload),
  });
}
