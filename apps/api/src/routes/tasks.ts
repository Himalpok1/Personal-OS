import {
  canActivateTask,
  canCompleteTaskDirectly,
  canReopenTask,
  parseFlexibleDatetime,
  resolveSeriesAnchor,
  TaskDueDateRuleError,
  toWallClockComponents,
  validateCompletionAnchoredRule,
  validateTaskDueDateRule,
  type DueDateRecurrenceRule,
} from "@personal-os/core";
import { occurrences, tasks, type Db } from "@personal-os/db";
import {
  TaskCreateSchema,
  TaskListQuerySchema,
  TaskSchema,
  TaskUpdateSchema,
} from "@personal-os/schema";
import { and, asc, count, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { effectiveOccursAt } from "../read-models/occurrence-effective.js";
import {
  archiveTask,
  canvasAssignmentExists,
  canvasAssignmentValidationIssue,
  completeTask,
  createTask,
  earliestOccurrenceInstant,
  InvalidEffectiveRuleError,
  materializeDueDateWindow,
  reopenTask,
  resolveLazyOccurrenceTarget,
  seedLazyOccurrence,
} from "../services/tasks.js";
import { normalizeRrule, recurrenceChanged } from "./task-recurrence-diff.js";

// The create/archive/complete/reopen writes, the occurrence-window and lazy
// seeding helpers and the canvas link pre-check live in ../services/tasks.ts
// (Checkpoint 10.8, ADR-078 §2) so an approved action and these routes
// share one implementation. The routes keep every pre-check and the
// 404/409 vocabulary.

// The 400 body for a rule the write-time validators reject (Checkpoint 9.4).
// The message is a closed token, never the validator's own text: every
// message packages/core's validateRecurrenceRule and validateCompletionAnchoredRule
// throw quotes the rule verbatim, and the rule is request text (ADR-060's
// error-token discipline). TaskDueDateRuleError carries its own token in
// `code`; everything else collapses to `invalid_rrule`. Nothing here is
// logged either -- a rejected rule is the client's problem to display.
function rruleValidationIssue(err: unknown): { code: "custom"; path: ["rrule"]; message: string } {
  const message = err instanceof TaskDueDateRuleError ? err.code : "invalid_rrule";
  return { code: "custom", path: ["rrule"], message };
}

function toTaskResponse(row: typeof tasks.$inferSelect) {
  return TaskSchema.parse({
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    due_at: row.dueAt ? row.dueAt.toISOString() : null,
    remind_at: row.remindAt ? row.remindAt.toISOString() : null,
    timezone: row.timezone,
    priority: row.priority,
    project_id: row.projectId,
    canvas_assignment_id: row.canvasAssignmentId,
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
  });
}

async function findTask(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(tasks).where(eq(tasks.id, id));
  return row ?? null;
}

// The occurrence a recurring task's /complete redirect points the caller
// at -- same "current open occurrence" concept GET /occurrences exposes,
// just pre-resolved here so the 409 body is immediately actionable. Ordered
// by the EFFECTIVE instant (Checkpoint 9.4, read-models/occurrence-effective.ts),
// then id: a due_date series can hold an instance snoozed a month out ahead
// of tomorrow's un-snoozed one, and "Complete" from the Tasks list must land
// on the one the owner is looking at on Today, which buckets on the same
// expression.
async function findOpenOccurrenceId(app: FastifyInstance, taskId: string) {
  const [row] = await app.db
    .select({ id: occurrences.id })
    .from(occurrences)
    .where(
      and(
        eq(occurrences.parentType, "task"),
        eq(occurrences.parentId, taskId),
        eq(occurrences.status, "scheduled"),
      ),
    )
    .orderBy(asc(effectiveOccursAt), asc(occurrences.id))
    .limit(1);
  return row?.id ?? null;
}

export default function tasksRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string> }>("/tasks", async (request) => {
    const query = TaskListQuerySchema.parse(request.query);
    const where = and(
      query.status ? inArray(tasks.status, query.status) : undefined,
      query.project_id ? eq(tasks.projectId, query.project_id) : undefined,
      query.include_archived ? undefined : isNull(tasks.archivedAt),
    );

    const [rows, totalRows] = await Promise.all([
      app.db
        .select()
        .from(tasks)
        .where(where)
        // NULLS LAST isn't expressible via drizzle's asc()/desc() helpers
        // directly for a mixed-secondary-sort like this, so undated tasks
        // are ordered after dated ones by sorting on due_at ascending with
        // a raw fallback would add complexity this list doesn't need yet --
        // due_at ascending, then most-recently-captured first, is a
        // reasonable approximation at Phase 2's data volumes.
        .orderBy(asc(tasks.dueAt), desc(tasks.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      app.db.select({ total: count() }).from(tasks).where(where),
    ]);
    const total = totalRows[0]?.total ?? 0;

    return {
      items: rows.map(toTaskResponse),
      limit: query.limit,
      offset: query.offset,
      total,
    };
  });

  // Returns the row even if archived -- a direct link to an archived task
  // isn't a 404, it just won't appear in the default list view.
  app.get<{ Params: { id: string } }>("/tasks/:id", async (request, reply) => {
    const row = await findTask(app, request.params.id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toTaskResponse(row);
  });

  app.post("/tasks", async (request, reply) => {
    const body = TaskCreateSchema.parse(request.body);
    const effectiveNow = new Date();

    const dueAt = body.due_at ? parseFlexibleDatetime(body.due_at, body.timezone) : null;
    // Same resolution as due_at: an offset-less value is resolved against the
    // request's own timezone, never the server's.
    const remindAt = body.remind_at ? parseFlexibleDatetime(body.remind_at, body.timezone) : null;
    const recurrenceTimezone = body.rrule ? (body.recurrence_timezone ?? body.timezone) : null;
    const recurrenceAnchor = body.rrule ? (body.recurrence_anchor ?? "due_date") : null;
    const recurrenceUntil =
      body.rrule && body.recurrence_until
        ? parseFlexibleDatetime(body.recurrence_until, recurrenceTimezone ?? body.timezone)
        : null;
    const recurrenceCount = body.rrule ? (body.recurrence_count ?? null) : null;
    const recurrenceExdates = body.rrule ? (body.recurrence_exdates ?? null) : null;

    // Checkpoint 9.4: a due_date rule is validated at write time (syntax,
    // FREQ no finer than DAILY, no embedded UNTIL/COUNT). Before this the
    // first bad rule to reach expandDueDateWindow below threw inside the
    // transaction and surfaced as a 500 -- or, for FREQ=SECONDLY, tried to
    // materialise 7.7 million rows first. The completion_date path is
    // already validated by TaskCreateSchema's refine.
    if (body.rrule && recurrenceAnchor === "due_date") {
      try {
        validateTaskDueDateRule(body.rrule, recurrenceTimezone ?? body.timezone, {
          recurrenceUntil,
          recurrenceCount,
          recurrenceExdates,
        });
      } catch (err: unknown) {
        return reply
          .code(400)
          .send({ error: "validation_failed", issues: [rruleValidationIssue(err)] });
      }
    }

    const row = await app.db.transaction((tx) =>
      createTask(
        tx,
        {
          title: body.title,
          body: body.body,
          status: "active",
          dueAt,
          remindAt,
          timezone: body.timezone,
          priority: body.priority,
          projectId: body.project_id,
          rrule: body.rrule ?? null,
          recurrenceTimezone,
          recurrenceAnchor,
          recurrenceUntil,
          recurrenceCount,
          recurrenceExdates,
        },
        effectiveNow,
      ),
    );

    return reply.code(201).send(toTaskResponse(row));
  });

  app.patch<{ Params: { id: string } }>("/tasks/:id", async (request, reply) => {
    const body = TaskUpdateSchema.parse(request.body);
    const effectiveNow = new Date();

    // Checkpoint 10.5 (ADR-074): validated before the transaction opens,
    // mirroring how the rrule shape is checked cheaply first -- a linking
    // mistake is the client's problem to display, not a reason to touch the
    // database transactionally.
    if (
      body.canvas_assignment_id !== undefined &&
      body.canvas_assignment_id !== null &&
      !(await canvasAssignmentExists(app.db, body.canvas_assignment_id))
    ) {
      return reply
        .code(400)
        .send({ error: "validation_failed", issues: [canvasAssignmentValidationIssue()] });
    }

    let row: typeof tasks.$inferSelect | null;
    try {
      row = await runTaskUpdate(app.db, request.params.id, body, effectiveNow);
    } catch (err: unknown) {
      if (err instanceof InvalidEffectiveRuleError) {
        return reply.code(400).send({
          error: "validation_failed",
          issues: [rruleValidationIssue(err.cause)],
        });
      }
      throw err;
    }
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toTaskResponse(row);
  });

  registerTaskActionRoutes(app);
}

async function runTaskUpdate(
  db: Db,
  id: string,
  body: ReturnType<typeof TaskUpdateSchema.parse>,
  effectiveNow: Date,
): Promise<typeof tasks.$inferSelect | null> {
  {
    const row = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(tasks).where(eq(tasks.id, id));
      if (!existing) return null;

      const newTitle = body.title !== undefined ? body.title : existing.title;
      const newBody = body.body !== undefined ? body.body : existing.body;
      const newDueAt =
        body.due_at !== undefined
          ? body.due_at
            ? parseFlexibleDatetime(body.due_at, existing.timezone)
            : null
          : existing.dueAt;
      const newPriority = body.priority !== undefined ? body.priority : existing.priority;
      const newProjectId = body.project_id !== undefined ? body.project_id : existing.projectId;
      // Checkpoint 10.5 (ADR-074): existence already validated by the route
      // before this transaction opened.
      const newCanvasAssignmentId =
        body.canvas_assignment_id !== undefined
          ? body.canvas_assignment_id
          : existing.canvasAssignmentId;
      const newRemindAt =
        body.remind_at !== undefined
          ? body.remind_at
            ? parseFlexibleDatetime(body.remind_at, existing.timezone)
            : null
          : existing.remindAt;

      const rruleExplicitlyNull = body.rrule === null;
      const newRrule = body.rrule !== undefined ? body.rrule : existing.rrule;
      const hasRecurrence = Boolean(newRrule) && !rruleExplicitlyNull;

      let newRecurrenceTimezone: string | null = null;
      let newRecurrenceAnchor: "due_date" | "completion_date" | null = null;
      let newRecurrenceUntil: Date | null = null;
      let newRecurrenceCount: number | null = null;
      let newRecurrenceExdates: string[] | null = null;

      if (hasRecurrence) {
        newRecurrenceTimezone =
          body.recurrence_timezone !== undefined
            ? body.recurrence_timezone
            : (existing.recurrenceTimezone ?? existing.timezone);
        newRecurrenceAnchor =
          body.recurrence_anchor !== undefined
            ? (body.recurrence_anchor ?? "due_date")
            : ((existing.recurrenceAnchor as "due_date" | "completion_date" | null) ?? "due_date");
        // The schema refine only runs when the body itself names
        // recurrence_anchor = completion_date; a body that changes only the
        // rrule on an already completion-anchored task bypasses it. Validate
        // the EFFECTIVE rule here so a BY*-bearing or unparseable rule can
        // never be persisted and then throw inside a later complete/skip.
        if (newRecurrenceAnchor === "completion_date" && newRrule) {
          try {
            validateCompletionAnchoredRule(newRrule);
          } catch (err: unknown) {
            throw new InvalidEffectiveRuleError(err);
          }
        }
        const targetTz = newRecurrenceTimezone ?? existing.timezone;
        newRecurrenceUntil =
          body.recurrence_until !== undefined
            ? body.recurrence_until
              ? parseFlexibleDatetime(body.recurrence_until, targetTz)
              : null
            : existing.recurrenceUntil;
        newRecurrenceCount =
          body.recurrence_count !== undefined ? body.recurrence_count : existing.recurrenceCount;
        newRecurrenceExdates =
          body.recurrence_exdates !== undefined
            ? body.recurrence_exdates
            : existing.recurrenceExdates;
        // Checkpoint 9.4: the EFFECTIVE due_date rule is validated the same way
        // POST /tasks validates it (the body may change only the rrule, only
        // the anchor, or only recurrence_until, and any of those can make the
        // combination invalid).
        if (newRecurrenceAnchor === "due_date" && newRrule) {
          try {
            validateTaskDueDateRule(newRrule, targetTz, {
              recurrenceUntil: newRecurrenceUntil,
              recurrenceCount: newRecurrenceCount,
              recurrenceExdates: newRecurrenceExdates,
            });
          } catch (err: unknown) {
            throw new InvalidEffectiveRuleError(err);
          }
        }
      }

      const hadRecurrence = Boolean(existing.rrule);
      const oldAnchor = existing.recurrenceAnchor ?? "due_date";
      // Read before any branch deletes rows (see branch A below); only a
      // due_date expansion consumes it, so a non-recurring PATCH pays nothing.
      const earliestOccursAt =
        hasRecurrence && newRecurrenceAnchor === "due_date"
          ? await earliestOccurrenceInstant(tx, existing.id)
          : null;
      let regenerateDueDateWindow = true;

      if (hadRecurrence && !hasRecurrence) {
        // E. Clearing Recurrence (rrule = null):
        // Delete ALL scheduled occurrences for parent, regardless of occurs_at.
        // Preserve done and skipped.
        await tx
          .delete(occurrences)
          .where(
            and(
              eq(occurrences.parentType, "task"),
              eq(occurrences.parentId, existing.id),
              eq(occurrences.status, "scheduled"),
            ),
          );
      } else if (hasRecurrence) {
        if (newRecurrenceAnchor === "completion_date") {
          if (!hadRecurrence || oldAnchor === "due_date") {
            // C. Due-Date Task -> Completion-Date Task:
            // Delete ALL open scheduled non-lazy materialized occurrences (status = 'scheduled' AND lazy_generated = false), including overdue ones.
            // Preserve done and skipped.
            // Seed exactly one open lazy occurrence (status = 'scheduled', lazy_generated = true).
            // Checkpoint 9.4 review: the seed instant comes from
            // resolveLazyOccurrenceTarget -- the branch F / reopen rule --
            // not from `due_at ?? effectiveNow`. A due_date series' due_at is
            // its anchor, and the instance AT the anchor is very often
            // already done, so seeding there collided with the terminal row
            // under onConflictDoNothing and left the switched task with
            // nothing open. With the shared rule the seed follows the latest
            // completion through the new rule instead. Gated on an open task
            // like branch F: a dropped task keeps its history and gets no new
            // open row.
            await tx
              .delete(occurrences)
              .where(
                and(
                  eq(occurrences.parentType, "task"),
                  eq(occurrences.parentId, existing.id),
                  eq(occurrences.status, "scheduled"),
                  eq(occurrences.lazyGenerated, false),
                ),
              );
            const taskOpen = existing.status === "inbox" || existing.status === "active";
            if (taskOpen) {
              const target = await resolveLazyOccurrenceTarget(tx, {
                taskId: existing.id,
                rrule: newRrule!,
                recurrenceTimezone: newRecurrenceTimezone!,
                explicitDueAt: body.due_at !== undefined ? newDueAt : undefined,
                fallbackDueAt: newDueAt,
                effectiveNow,
              });
              await seedLazyOccurrence(tx, existing.id, target);
            }
          } else {
            // F. Completion-Date Task -> Completion-Date Task (Checkpoint 9.3).
            // docs/ARCHITECTURE.md: "Editing the rule regenerates only the
            // single open occurrence". Until 9.3 this branch did not exist, so
            // re-saving the rule after a dead-lettered successor created
            // nothing (the repair-path gap the 9.0 review recorded), and a
            // changed due date or interval left the open occurrence where it
            // was. Now: no open occurrence and the task is open -> seed one;
            // one exists and the rule or due date changed -> re-point it.
            // Done and skipped rows are never touched.
            // Normalised comparison (Checkpoint 9.4, task-recurrence-diff.ts):
            // a client re-sending `FREQ=DAILY;INTERVAL=1` for a stored
            // `FREQ=DAILY` has not changed the rule.
            const ruleChanged =
              normalizeRrule(newRrule) !== normalizeRrule(existing.rrule) ||
              newRecurrenceTimezone !== existing.recurrenceTimezone;
            const dueChanged =
              body.due_at !== undefined &&
              (newDueAt?.getTime() ?? null) !== (existing.dueAt?.getTime() ?? null);
            const taskOpen = existing.status === "inbox" || existing.status === "active";

            const [open] = await tx
              .select()
              .from(occurrences)
              .where(
                and(
                  eq(occurrences.parentType, "task"),
                  eq(occurrences.parentId, existing.id),
                  eq(occurrences.status, "scheduled"),
                ),
              )
              .orderBy(asc(occurrences.occursAt))
              .limit(1);

            if (taskOpen && (!open || ruleChanged || dueChanged)) {
              const target = await resolveLazyOccurrenceTarget(tx, {
                taskId: existing.id,
                rrule: newRrule!,
                recurrenceTimezone: newRecurrenceTimezone!,
                explicitDueAt: body.due_at !== undefined ? newDueAt : undefined,
                fallbackDueAt: newDueAt,
                effectiveNow,
              });
              if (!open) {
                await seedLazyOccurrence(tx, existing.id, target);
              } else if (target.occursAt.getTime() !== open.occursAt.getTime()) {
                // occurrences_parent_occurs_at_key is a plain unique index, so
                // re-pointing onto an instant a done/skipped row already holds
                // would abort the whole transaction. Leave the open row where
                // it is in that case rather than fail the edit.
                const [collision] = await tx
                  .select({ id: occurrences.id })
                  .from(occurrences)
                  .where(
                    and(
                      eq(occurrences.parentType, "task"),
                      eq(occurrences.parentId, existing.id),
                      eq(occurrences.occursAt, target.occursAt),
                      ne(occurrences.id, open.id),
                    ),
                  )
                  .limit(1);
                if (!collision) {
                  await tx
                    .update(occurrences)
                    .set({ occursAt: target.occursAt, occursLocal: target.occursLocal })
                    .where(eq(occurrences.id, open.id));
                }
              }
            }
          }
        } else {
          // newRecurrenceAnchor === "due_date"
          if (hadRecurrence && oldAnchor === "completion_date") {
            // D. Completion-Date Task -> Due-Date Task:
            // Delete current open lazy scheduled occurrence (status = 'scheduled' AND lazy_generated = true) regardless of occurs_at.
            // Preserve done and skipped.
            await tx
              .delete(occurrences)
              .where(
                and(
                  eq(occurrences.parentType, "task"),
                  eq(occurrences.parentId, existing.id),
                  eq(occurrences.status, "scheduled"),
                  eq(occurrences.lazyGenerated, true),
                ),
              );
          } else {
            // A. Due-Date -> Due-Date Edit (Checkpoint 9.4: deterministic).
            // If nothing recurrence-relevant changed -- normalised rrule,
            // zone, until, count, exdates, anchor kind and the due_at instant
            // all equal -- the series is left EXACTLY as it is: no delete, no
            // re-expand, every occurrence id and every snoozed_until
            // preserved. Before 9.4 a title edit regenerated the window.
            const unchanged = !recurrenceChanged(
              {
                rrule: existing.rrule,
                recurrenceTimezone: existing.recurrenceTimezone,
                recurrenceAnchor: oldAnchor as "due_date" | "completion_date",
                recurrenceUntil: existing.recurrenceUntil,
                recurrenceCount: existing.recurrenceCount,
                recurrenceExdates: existing.recurrenceExdates,
                dueAt: existing.dueAt,
              },
              {
                rrule: newRrule,
                recurrenceTimezone: newRecurrenceTimezone,
                recurrenceAnchor: newRecurrenceAnchor,
                recurrenceUntil: newRecurrenceUntil,
                recurrenceCount: newRecurrenceCount,
                recurrenceExdates: newRecurrenceExdates,
                dueAt: newDueAt,
              },
            );
            if (unchanged) {
              regenerateDueDateWindow = false;
            } else {
              // Preserve done, skipped, and historical scheduled (occurs_at < effectiveNow).
              // Delete future scheduled non-lazy occurrences (status = 'scheduled' AND occurs_at >= effectiveNow).
              // A snoozed row among them is deleted like the rest: the snooze
              // belonged to an instance the new rule may no longer produce,
              // and the regenerated instance is a different row (documented
              // in docs/STATUS.md as the cost of a rule edit).
              await tx
                .delete(occurrences)
                .where(
                  and(
                    eq(occurrences.parentType, "task"),
                    eq(occurrences.parentId, existing.id),
                    eq(occurrences.status, "scheduled"),
                    eq(occurrences.lazyGenerated, false),
                    gte(occurrences.occursAt, effectiveNow),
                  ),
                );
            }
          }

          if (regenerateDueDateWindow) {
            // Materialize the rolling window from the SERIES ANCHOR
            // (Checkpoint 9.4, resolveSeriesAnchor): due_at, else the earliest
            // occurrence this parent ever had -- read BEFORE the delete above
            // so a due_at-less series keeps the wall-clock time it was first
            // materialised at rather than re-anchoring on `now` -- else now.
            const dtstartInstant = resolveSeriesAnchor({
              dueAt: newDueAt,
              earliestOccursAt,
              now: effectiveNow,
            });
            const rule: DueDateRecurrenceRule = {
              rrule: newRrule!,
              recurrenceTimezone: newRecurrenceTimezone!,
              dtstart: toWallClockComponents(dtstartInstant, newRecurrenceTimezone!),
              recurrenceUntil: newRecurrenceUntil ?? undefined,
              recurrenceCount: newRecurrenceCount ?? undefined,
              recurrenceExdates: newRecurrenceExdates ?? undefined,
            };
            await materializeDueDateWindow(tx, existing.id, rule, effectiveNow);
          }
        }
      }

      const [updated] = await tx
        .update(tasks)
        .set({
          title: newTitle,
          body: newBody,
          dueAt: newDueAt,
          remindAt: newRemindAt,
          priority: newPriority,
          projectId: newProjectId,
          canvasAssignmentId: newCanvasAssignmentId,
          rrule: hasRecurrence ? newRrule : null,
          recurrenceTimezone: hasRecurrence ? newRecurrenceTimezone : null,
          recurrenceAnchor: hasRecurrence ? newRecurrenceAnchor : null,
          recurrenceUntil: hasRecurrence ? newRecurrenceUntil : null,
          recurrenceCount: hasRecurrence ? newRecurrenceCount : null,
          recurrenceExdates: hasRecurrence ? newRecurrenceExdates : null,
          updatedAt: effectiveNow,
        })
        .where(eq(tasks.id, id))
        .returning();

      return updated ?? null;
    });
    return row;
  }
}

function registerTaskActionRoutes(app: FastifyInstance): void {
  // Soft-delete: sets archived_at, touches nothing else -- occurrences,
  // item_tags, and inbox_items lineage all stay exactly as they were.
  // Idempotent -- re-archiving an already-archived task is a no-op.
  app.post<{ Params: { id: string } }>("/tasks/:id/archive", async (request, reply) => {
    const now = new Date();
    const row = await app.db.transaction((tx) => archiveTask(tx, request.params.id, now));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toTaskResponse(row);
  });

  // inbox -> active only. Every AI-captured task starts at 'inbox' and
  // nothing else ever promotes it -- this is the real fix for that gap
  // (see docs/STATUS.md's Phase 2 planning notes), not just a UI filter.
  app.post<{ Params: { id: string } }>("/tasks/:id/activate", async (request, reply) => {
    const existing = await findTask(app, request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (!canActivateTask(existing)) {
      return reply.code(409).send({ error: "invalid_status_transition", status: existing.status });
    }
    const [row] = await app.db
      .update(tasks)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(tasks.id, request.params.id))
      .returning();
    if (!row) throw new Error("update on tasks returned no row for an id that was just found");
    return toTaskResponse(row);
  });

  // Plain tasks complete directly (no occurrence ever exists for them).
  // Recurring tasks route through their open occurrence instead -- see
  // packages/core's canCompleteTaskDirectly.
  app.post<{ Params: { id: string } }>("/tasks/:id/complete", async (request, reply) => {
    const existing = await findTask(app, request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (!canCompleteTaskDirectly(existing)) {
      const occurrenceId = await findOpenOccurrenceId(app, existing.id);
      // Checkpoint 9.3: a recurring task with NOTHING open is a distinct
      // condition from one whose completion should go through an occurrence.
      // The old body sent `occurrence_id: null` under the same error, which a
      // client could only read as "use the occurrence... which one?". The
      // realistic causes are a dead-lettered successor or a task captured
      // before the parser materialized windows; the fix on the API side is
      // PATCH /tasks/:id (which now seeds one -- see the completion_date
      // branch above), and the client can say so instead of guessing.
      if (!occurrenceId) {
        return reply.code(409).send({ error: "recurring_task_no_open_occurrence" });
      }
      return reply
        .code(409)
        .send({ error: "recurring_task_use_occurrence", occurrence_id: occurrenceId });
    }
    const now = new Date();
    const row = await app.db.transaction((tx) => completeTask(tx, request.params.id, now));
    if (!row) throw new Error("update on tasks returned no row for an id that was just found");
    return toTaskResponse(row);
  });

  // done|dropped -> active (Checkpoint 9.3). Clears completed_at. Existing
  // occurrences are never modified or deleted -- a reopened recurring task
  // keeps its history and, if its successor already exists, that open
  // occurrence -- and archived_at is an independent axis, but an archived
  // task is 404 here (a reopen on something hidden from every list would be
  // a state change nobody can see). inbox and active are refused with 409
  // rather than treated as a no-op, so a client acting on a stale row learns
  // its view is stale.
  //
  // Checkpoint 9.4: a reopened RECURRING parent must have something to act
  // on, or Today shows nothing and /complete answers
  // recurring_task_no_open_occurrence. In the same transaction as the flip:
  // a completion_date series with no open occurrence is seeded through
  // resolveLazyOccurrenceTarget (from its last completion, else its due_at,
  // else now -- the branch F rule); a due_date series has its rolling window
  // re-materialised from the series anchor with onConflictDoNothing, so any
  // occurrence still present is untouched and only the missing instants are
  // added. Non-recurring tasks are exactly as before.
  app.post<{ Params: { id: string } }>("/tasks/:id/reopen", async (request, reply) => {
    const existing = await findTask(app, request.params.id);
    if (!existing || existing.archivedAt) return reply.code(404).send({ error: "not_found" });
    if (!canReopenTask(existing.status)) {
      return reply.code(409).send({ error: "task_not_reopenable", status: existing.status });
    }
    const effectiveNow = new Date();
    const row = await app.db.transaction((tx) =>
      reopenTask(tx, request.params.id, effectiveNow, app.log),
    );
    if (!row) throw new Error("update on tasks returned no row for an id that was just found");
    return toTaskResponse(row);
  });

  // Unlike /complete, dropping applies to any task regardless of
  // recurrence -- "drop" means "stop", which is well-defined even for a
  // recurring series (and is exactly what stops
  // occurrences.expand-window from generating further occurrences for it).
  app.post<{ Params: { id: string } }>("/tasks/:id/drop", async (request, reply) => {
    const [row] = await app.db
      .update(tasks)
      .set({ status: "dropped", updatedAt: new Date() })
      .where(eq(tasks.id, request.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toTaskResponse(row);
  });
}
