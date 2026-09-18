import {
  computeNextLazyOccurrence,
  expandDueDateWindow,
  resolveSeriesAnchor,
  toWallClockComponents,
  wallClockToNaiveDate,
  wallTimeOfNaiveTimestamp,
  type DueDateRecurrenceRule,
} from "@personal-os/core";
import { errorToken } from "@personal-os/core/logging/logger";
import { canvasAssignments, occurrences, tasks, type Db } from "@personal-os/db";
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";

// Task write services (Checkpoint 10.8, ADR-078 §2). Extracted VERBATIM from
// routes/tasks.ts so an approved action (actions/handlers.ts) and the
// owner's direct route call the identical code. Every write here takes the
// caller's transaction; nothing here opens one. The routes keep every
// pre-check a service function cannot express (the 404/409 vocabulary, the
// recurring-task redirect to its open occurrence) and call these for the
// write itself.
//
// This file names `tasks` in a query only through `loadTaskForAction` below,
// which selects the handful of columns an action needs to decide and to
// summarise -- never `body`.

export type TaskRow = typeof tasks.$inferSelect;
export type TaskTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const DUE_DATE_WINDOW_DAYS = 90;

// Checkpoint 10.5 (ADR-074): the same 400 validation_failed / `code: "custom"`
// issue shape rruleValidationIssue already uses -- there is no existing
// project_id existence check to mirror (an unknown project_id relies on the
// tasks_project_id_projects_id_fk constraint and would surface as a raw,
// unhandled 500), so this is the closest reviewed convention in this file
// rather than a new error shape.
export function canvasAssignmentValidationIssue(): {
  code: "custom";
  path: ["canvas_assignment_id"];
  message: string;
} {
  return {
    code: "custom",
    path: ["canvas_assignment_id"],
    message: "canvas_assignment_id does not reference an existing assignment",
  };
}

// True only when `id` names a real canvas_assignments row. Read-only --
// never touches canvas_connections/canvas_courses, never imports
// @personal-os/canvas-providers.
export async function canvasAssignmentExists(db: Db | TaskTx, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: canvasAssignments.id })
    .from(canvasAssignments)
    .where(eq(canvasAssignments.id, id))
    .limit(1);
  return row !== undefined;
}

// min(occurs_at) over ALL of a parent's occurrence rows, any status -- the
// second input of resolveSeriesAnchor (packages/core), so a due_at-less series
// is re-expanded from the instant it was first materialised, never from
// `now`. `.mapWith(occurrences.occursAt)` runs the aggregate through the
// column's own timestamptz mapper (a bare sql<T> would hand back a string --
// the trap today.ts's toDateOrNull guards against). Postgres returns a
// single NULL row for an empty group, which maps to null here.
export async function earliestOccurrenceInstant(tx: TaskTx, taskId: string): Promise<Date | null> {
  const [row] = await tx
    .select({
      earliest: sql<Date | null>`min(${occurrences.occursAt})`.mapWith(occurrences.occursAt),
    })
    .from(occurrences)
    .where(and(eq(occurrences.parentType, "task"), eq(occurrences.parentId, taskId)));
  return row?.earliest ?? null;
}

// Materialises a due_date series' rolling window (DUE_DATE_WINDOW_DAYS from
// effectiveNow) as non-lazy scheduled rows. Idempotent: the insert targets
// occurrences_parent_occurs_at_key, so a row already present at an instant --
// scheduled, done or skipped -- is left exactly as it is. Shared by POST
// /tasks, PATCH branches A/D and POST /tasks/:id/reopen, so every writer
// expands from the same anchor rule and the same window length.
export async function materializeDueDateWindow(
  tx: TaskTx,
  taskId: string,
  rule: DueDateRecurrenceRule,
  effectiveNow: Date,
): Promise<void> {
  const generated = expandDueDateWindow(rule, DUE_DATE_WINDOW_DAYS, effectiveNow);
  for (const occurrence of generated) {
    await tx
      .insert(occurrences)
      .values({
        parentType: "task",
        parentId: taskId,
        occursAt: occurrence.occursAt,
        occursLocal: wallClockToNaiveDate(occurrence.occursLocal),
        status: "scheduled",
        lazyGenerated: false,
      })
      .onConflictDoNothing({
        target: [occurrences.parentType, occurrences.parentId, occurrences.occursAt],
      });
  }
}

// Wraps the validator's own error (as `cause`) so the route can map it to a
// token; the wrapper's message is fixed and never carries the rule.
export class InvalidEffectiveRuleError extends Error {
  constructor(cause: unknown) {
    super("invalid effective recurrence rule", { cause });
    this.name = "InvalidEffectiveRuleError";
  }
}

// Where a completion_date-anchored task's single open occurrence belongs
// after a PATCH (branches C and F in routes/tasks.ts) or a task reopen.
// Precedence:
//   1. a due_at supplied in this request -- the owner just said when;
//   2. the most recent done/skipped occurrence's completion instant, run
//      through the (new) rule -- what generate-lazy would have produced,
//      which is the honest meaning of "regenerate" for a rule edit and the
//      repair for a dead-lettered successor (seeding at a due_at that
//      predates several completions would resurrect an overdue instance);
//   3. due_at ?? effectiveNow -- the same seed POST /tasks uses when there is
//      no history to anchor from.
//
// Step 2 hands computeNextLazyOccurrence the SAME options every other writer
// of a lazy successor does (9.4 review): the terminal row's occurs_local
// time-of-day as `wallTime` and its occurs_at as the exclusive `after` bound.
// Without them this path computed a successor at the completion's own
// time-of-day, while POST /occurrences/:id/complete, the worker's re-check
// and the nightly reconciliation all compute from the row's wall clock -- so
// a rule edit could move an instance that a plain complete would have left
// where it was. The computation is wrapped so a rule the engine cannot step
// -- one stored before write-time validation existed, or a bound it cannot
// clear -- reaches the route as InvalidEffectiveRuleError (400 invalid_rrule,
// token only) rather than the 500 handler, which would log the thrown
// message and with it the rule text. This was the one call site of the
// engine in the routes with no such guard.
export async function resolveLazyOccurrenceTarget(
  tx: TaskTx,
  input: {
    taskId: string;
    rrule: string;
    recurrenceTimezone: string;
    /** `undefined` when the request did not mention due_at; null when it
     * cleared it. */
    explicitDueAt: Date | null | undefined;
    fallbackDueAt: Date | null;
    effectiveNow: Date;
  },
): Promise<{ occursAt: Date; occursLocal: Date }> {
  const wall = (instant: Date) =>
    wallClockToNaiveDate(toWallClockComponents(instant, input.recurrenceTimezone));

  if (input.explicitDueAt) {
    return { occursAt: input.explicitDueAt, occursLocal: wall(input.explicitDueAt) };
  }

  const [lastTerminal] = await tx
    .select({
      status: occurrences.status,
      completedAt: occurrences.completedAt,
      occursAt: occurrences.occursAt,
      occursLocal: occurrences.occursLocal,
    })
    .from(occurrences)
    .where(
      and(
        eq(occurrences.parentType, "task"),
        eq(occurrences.parentId, input.taskId),
        ne(occurrences.status, "scheduled"),
        isNotNull(occurrences.completedAt),
      ),
    )
    .orderBy(desc(occurrences.completedAt), desc(occurrences.occursAt), desc(occurrences.id))
    .limit(1);
  if (lastTerminal?.completedAt) {
    let next;
    try {
      next = computeNextLazyOccurrence(
        { rrule: input.rrule, recurrenceTimezone: input.recurrenceTimezone },
        lastTerminal.completedAt,
        lastTerminal.status === "done" ? "completed" : "skipped",
        {
          wallTime: wallTimeOfNaiveTimestamp(lastTerminal.occursLocal),
          after: lastTerminal.occursAt,
        },
      );
    } catch (err: unknown) {
      throw new InvalidEffectiveRuleError(err);
    }
    return { occursAt: next.occursAt, occursLocal: wallClockToNaiveDate(next.occursLocal) };
  }

  const seed = input.fallbackDueAt ?? input.effectiveNow;
  return { occursAt: seed, occursLocal: wall(seed) };
}

// Seeds the single open lazy occurrence of a completion_date parent at
// `target`. onConflictDoNothing with no target covers both unique indexes
// (see routes/occurrences.ts): an open lazy row already present, or a
// done/skipped row already holding that instant. Returns whether a row was
// written so callers can tell "seeded" from "collided".
export async function seedLazyOccurrence(
  tx: TaskTx,
  taskId: string,
  target: { occursAt: Date; occursLocal: Date },
): Promise<boolean> {
  const inserted = await tx
    .insert(occurrences)
    .values({
      parentType: "task",
      parentId: taskId,
      occursAt: target.occursAt,
      occursLocal: target.occursLocal,
      status: "scheduled",
      lazyGenerated: true,
    })
    .onConflictDoNothing()
    .returning({ id: occurrences.id });
  return inserted.length > 0;
}

/**
 * The values `POST /tasks` inserts, already parsed by the caller: instants
 * resolved through parseFlexibleDatetime against the request's own timezone,
 * the recurrence fields derived (all null when there is no rule) and a
 * due_date rule already validated. `canvasAssignmentId` is the one field the
 * route never sends (TaskCreateSchema has no such key; ADR-074's write path
 * is PATCH and, since 10.8, the `create_task` action, both existence-checked
 * before the transaction opens).
 */
export interface CreateTaskParams {
  title: string;
  body?: string | null;
  status: "inbox" | "active";
  dueAt: Date | null;
  remindAt: Date | null;
  timezone: string;
  priority?: number | null;
  projectId?: string | null;
  canvasAssignmentId?: string | null;
  rrule: string | null;
  recurrenceTimezone: string | null;
  recurrenceAnchor: "due_date" | "completion_date" | null;
  recurrenceUntil: Date | null;
  recurrenceCount: number | null;
  recurrenceExdates: string[] | null;
}

/**
 * The transaction body of `POST /tasks`. Checkpoint 9.4: a recurring task
 * always persists its series anchor. When the caller supplies no due_at the
 * anchor is effectiveNow (resolveSeriesAnchor's last fallback) and it is
 * WRITTEN to due_at, so the nightly job, PATCH and the capture commit path
 * all re-derive the same DTSTART later instead of each inventing a fresh
 * `now`. For a completion_date rule the anchor is also the first seeded
 * occurrence's instant; a due_date rule has its rolling window materialised.
 */
export async function createTask(
  tx: TaskTx,
  params: CreateTaskParams,
  effectiveNow: Date,
): Promise<TaskRow> {
  const seriesAnchor = params.rrule
    ? resolveSeriesAnchor({ dueAt: params.dueAt, earliestOccursAt: null, now: effectiveNow })
    : null;

  const [inserted] = await tx
    .insert(tasks)
    .values({
      title: params.title,
      body: params.body,
      status: params.status,
      dueAt: seriesAnchor ?? params.dueAt,
      remindAt: params.remindAt,
      timezone: params.timezone,
      priority: params.priority,
      projectId: params.projectId,
      canvasAssignmentId: params.canvasAssignmentId,
      rrule: params.rrule ?? null,
      recurrenceTimezone: params.recurrenceTimezone,
      recurrenceAnchor: params.recurrenceAnchor,
      recurrenceUntil: params.recurrenceUntil,
      recurrenceCount: params.recurrenceCount,
      recurrenceExdates: params.recurrenceExdates,
    })
    .returning();
  if (!inserted) throw new Error("insert into tasks returned no row");

  if (params.rrule && seriesAnchor) {
    if (params.recurrenceAnchor === "completion_date") {
      const firstOccursAt = seriesAnchor;
      const occursLocal = toWallClockComponents(firstOccursAt, params.recurrenceTimezone!);
      await tx.insert(occurrences).values({
        parentType: "task",
        parentId: inserted.id,
        occursAt: firstOccursAt,
        occursLocal: wallClockToNaiveDate(occursLocal),
        status: "scheduled",
        lazyGenerated: true,
      });
    } else {
      // due_date anchor
      const rule: DueDateRecurrenceRule = {
        rrule: params.rrule,
        recurrenceTimezone: params.recurrenceTimezone!,
        dtstart: toWallClockComponents(seriesAnchor, params.recurrenceTimezone!),
        recurrenceUntil: params.recurrenceUntil ?? undefined,
        recurrenceCount: params.recurrenceCount ?? undefined,
        recurrenceExdates: params.recurrenceExdates ?? undefined,
      };
      await materializeDueDateWindow(tx, inserted.id, rule, effectiveNow);
    }
  }

  return inserted;
}

/**
 * The write of `POST /tasks/:id/archive`: sets archived_at, touches nothing
 * else -- occurrences, item_tags and inbox_items lineage all stay exactly as
 * they were. Unconditional on the row's current state, exactly as the route
 * has always been (a second archive re-stamps the instant); `null` when no
 * row has that id.
 */
export async function archiveTask(tx: TaskTx, id: string, now: Date): Promise<TaskRow | null> {
  const [row] = await tx
    .update(tasks)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(tasks.id, id))
    .returning();
  return row ?? null;
}

/**
 * The write of `POST /tasks/:id/complete` for a task whose completion does
 * not go through an occurrence: `done` with completed_at stamped. The caller
 * has already established the task is not recurring (canCompleteTaskDirectly)
 * -- this function re-stamps an already-done task exactly as the route
 * always has. `null` when no row has that id.
 */
export async function completeTask(tx: TaskTx, id: string, now: Date): Promise<TaskRow | null> {
  const [row] = await tx
    .update(tasks)
    .set({ status: "done", completedAt: now, updatedAt: now })
    .where(eq(tasks.id, id))
    .returning();
  return row ?? null;
}

/** Where `reopenTask` reports a seeding failure it deliberately swallows. */
export interface ReopenWarnSink {
  warn(fields: { taskId: string; error: string }, message: string): void;
}

/**
 * The transaction body of `POST /tasks/:id/reopen`: done|dropped -> active,
 * completed_at cleared, existing occurrences never modified or deleted. The
 * caller has already refused an unknown or archived task (404) and a status
 * that is not done|dropped (409 task_not_reopenable).
 *
 * Checkpoint 9.4: a reopened RECURRING parent must have something to act on,
 * or Today shows nothing and /complete answers recurring_task_no_open_occurrence.
 * In the same transaction as the flip, under a SAVEPOINT (like the successor
 * step in occurrences.ts): a rule stored before write-time validation existed
 * can still throw inside computeNextLazyOccurrence/expandDueDateWindow, and
 * that must not make the task un-reopenable. The flip commits regardless; the
 * warn line is ids-only with an error token, never the rule text. `null`
 * when no row has that id.
 */
export async function reopenTask(
  tx: TaskTx,
  id: string,
  now: Date,
  log: ReopenWarnSink,
): Promise<TaskRow | null> {
  const [updated] = await tx
    .update(tasks)
    .set({ status: "active", completedAt: null, updatedAt: now })
    .where(eq(tasks.id, id))
    .returning();
  if (!updated) return null;

  if (updated.rrule && updated.recurrenceTimezone) {
    try {
      await tx.transaction(async (savepoint) => {
        await ensureReopenedSeriesHasOccurrences(savepoint, updated, now);
      });
    } catch (err: unknown) {
      log.warn(
        { taskId: updated.id, error: errorToken(err) },
        "tasks.reopen: occurrence seeding failed; task reopened without an open occurrence",
      );
    }
  }
  return updated;
}

async function ensureReopenedSeriesHasOccurrences(
  tx: TaskTx,
  updated: TaskRow,
  effectiveNow: Date,
): Promise<void> {
  if (!updated.rrule || !updated.recurrenceTimezone) return;
  if (updated.recurrenceAnchor === "completion_date") {
    const [open] = await tx
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(
        and(
          eq(occurrences.parentType, "task"),
          eq(occurrences.parentId, updated.id),
          eq(occurrences.status, "scheduled"),
        ),
      )
      .limit(1);
    if (!open) {
      const target = await resolveLazyOccurrenceTarget(tx, {
        taskId: updated.id,
        rrule: updated.rrule,
        recurrenceTimezone: updated.recurrenceTimezone,
        explicitDueAt: undefined,
        fallbackDueAt: updated.dueAt,
        effectiveNow,
      });
      await seedLazyOccurrence(tx, updated.id, target);
    }
  } else {
    const earliestOccursAt = await earliestOccurrenceInstant(tx, updated.id);
    const dtstartInstant = resolveSeriesAnchor({
      dueAt: updated.dueAt,
      earliestOccursAt,
      now: effectiveNow,
    });
    const rule: DueDateRecurrenceRule = {
      rrule: updated.rrule,
      recurrenceTimezone: updated.recurrenceTimezone,
      dtstart: toWallClockComponents(dtstartInstant, updated.recurrenceTimezone),
      recurrenceUntil: updated.recurrenceUntil ?? undefined,
      recurrenceCount: updated.recurrenceCount ?? undefined,
      recurrenceExdates: updated.recurrenceExdates ?? undefined,
    };
    await materializeDueDateWindow(tx, updated.id, rule, effectiveNow);
  }
}

/**
 * The columns an action's `prepare`/`execute` needs to decide and to
 * summarise -- never `body` (Guard 2's ratchet names this file for exactly
 * this selection). With `forUpdate` the row is locked for the rest of the
 * caller's transaction, which is how `execute` closes the TOCTOU window
 * between the owner's approval and the write (ADR-078 §4).
 */
export interface TaskActionView {
  id: string;
  title: string;
  status: string;
  rrule: string | null;
  archivedAt: Date | null;
}

export async function loadTaskForAction(
  db: Db | TaskTx,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<TaskActionView | null> {
  const query = db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      rrule: tasks.rrule,
      archivedAt: tasks.archivedAt,
    })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);
  const [row] = options.forUpdate ? await query.for("update") : await query;
  return row ?? null;
}
