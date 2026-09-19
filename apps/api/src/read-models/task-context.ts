// Checkpoint 10.9 (ADR-081) -- the `get_task_context` read tool's row loader.
//
// Selects a task's SCHEDULE columns and nothing else. Two columns are
// deliberately never read, not merely never emitted:
//
//   * `body` -- the ADR-054/066 body-free rule. This file is listed in
//     Guard 2's `EXPECTED_BODY_READERS` because it names the `tasks` table at
//     all; the column list below is what makes that listing honest.
//   * `rrule` -- only its PRESENCE is derived, in SQL, as a boolean
//     (`recurring`). The rule text describes the owner's routine and is
//     inexpressible in `GetTaskContextOutputSchema`, exactly as it is in the
//     prompt-facing TodayContext.
//
// Likewise `canvas_assignment_id` surfaces only as `canvasLinked`: whether an
// ADR-074 link exists, never the assignment (Guard 5 keeps academic rows out
// of every AI lane; this read model reaches no canvas_* table at all).
// The project join carries `{id, name}` only. Open occurrences are the
// `scheduled` rows of the parent, capped at READ_TOOL_TASK_OCCURRENCES_MAX
// with an honest `count(*)` total, ordered by `occurs_at` then `id` so two
// identical requests are byte-identical. Read-only.
import { occurrences, projects, tasks, type Db } from "@personal-os/db";
import { READ_TOOL_TASK_OCCURRENCES_MAX } from "@personal-os/schema";
import { and, asc, count, eq, sql } from "drizzle-orm";

export interface TaskContextTaskRow {
  id: string;
  title: string;
  status: string;
  priority: number | null;
  dueAt: Date | null;
  remindAt: Date | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  updatedAt: Date;
  /** `rrule IS NOT NULL` -- the rule text is never selected. */
  recurring: boolean;
  /** `canvas_assignment_id IS NOT NULL` -- the assignment is never selected. */
  canvasLinked: boolean;
}

export interface TaskContextOccurrenceRow {
  id: string;
  occursAt: Date;
  status: string;
  snoozedUntil: Date | null;
}

export interface TaskContextRow {
  task: TaskContextTaskRow;
  project: { id: string; name: string } | null;
  /** At most READ_TOOL_TASK_OCCURRENCES_MAX `scheduled` rows, `occurs_at asc, id asc`. */
  openOccurrences: TaskContextOccurrenceRow[];
  /** The honest count of every `scheduled` row, above the cap or not. */
  openOccurrencesTotal: number;
}

/**
 * Loads one task's schedule context by id, or `null` when no row exists.
 * Archived rows ARE returned (with `archivedAt` set) so the caller can say
 * "archived" rather than "unknown": the two are different answers to an
 * agent that holds a stale id.
 */
export async function loadTaskContextRow(db: Db, id: string): Promise<TaskContextRow | null> {
  const [row] = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueAt: tasks.dueAt,
      remindAt: tasks.remindAt,
      completedAt: tasks.completedAt,
      archivedAt: tasks.archivedAt,
      updatedAt: tasks.updatedAt,
      recurring: sql<boolean>`${tasks.rrule} is not null`,
      canvasLinked: sql<boolean>`${tasks.canvasAssignmentId} is not null`,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, id))
    .limit(1);
  if (row === undefined) return null;

  const openFilter = and(
    eq(occurrences.parentType, "task"),
    eq(occurrences.parentId, id),
    eq(occurrences.status, "scheduled"),
  );

  const [openRows, [totalRow]] = await Promise.all([
    db
      .select({
        id: occurrences.id,
        occursAt: occurrences.occursAt,
        status: occurrences.status,
        snoozedUntil: occurrences.snoozedUntil,
      })
      .from(occurrences)
      .where(openFilter)
      .orderBy(asc(occurrences.occursAt), asc(occurrences.id))
      .limit(READ_TOOL_TASK_OCCURRENCES_MAX),
    db.select({ total: count() }).from(occurrences).where(openFilter),
  ]);

  return {
    task: {
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      dueAt: row.dueAt,
      remindAt: row.remindAt,
      completedAt: row.completedAt,
      archivedAt: row.archivedAt,
      updatedAt: row.updatedAt,
      // node-postgres returns a real boolean for a `… is not null` expression.
      recurring: row.recurring === true,
      canvasLinked: row.canvasLinked === true,
    },
    project:
      row.projectId !== null && row.projectName !== null
        ? { id: row.projectId, name: row.projectName }
        : null,
    openOccurrences: openRows,
    openOccurrencesTotal: totalRow?.total ?? 0,
  };
}
