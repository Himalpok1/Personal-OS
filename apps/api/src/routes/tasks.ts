import {
  canActivateTask,
  canCompleteTaskDirectly,
  canReopenTask,
  computeNextLazyOccurrence,
  expandDueDateWindow,
  parseFlexibleDatetime,
  toWallClockComponents,
  validateCompletionAnchoredRule,
  wallClockToNaiveDate,
  type DueDateRecurrenceRule,
} from "@personal-os/core";
import { occurrences, tasks, type Db } from "@personal-os/db";
import {
  TaskCreateSchema,
  TaskListQuerySchema,
  TaskSchema,
  TaskUpdateSchema,
} from "@personal-os/schema";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

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
// just pre-resolved here so the 409 body is immediately actionable.
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
    .orderBy(asc(occurrences.occursAt))
    .limit(1);
  return row?.id ?? null;
}

// Where a completion_date-anchored task's single open occurrence belongs
// after a PATCH (branch F below). Precedence:
//   1. a due_at supplied in this request -- the owner just said when;
//   2. the most recent done/skipped occurrence's completion instant, run
//      through the (new) rule -- what generate-lazy would have produced,
//      which is the honest meaning of "regenerate" for a rule edit and the
//      repair for a dead-lettered successor (seeding at a due_at that
//      predates several completions would resurrect an overdue instance);
//   3. due_at ?? effectiveNow -- the same seed POST /tasks uses when there is
//      no history to anchor from.
async function resolveLazyOccurrenceTarget(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
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
    .select({ status: occurrences.status, completedAt: occurrences.completedAt })
    .from(occurrences)
    .where(
      and(
        eq(occurrences.parentType, "task"),
        eq(occurrences.parentId, input.taskId),
        ne(occurrences.status, "scheduled"),
        isNotNull(occurrences.completedAt),
      ),
    )
    .orderBy(desc(occurrences.completedAt))
    .limit(1);
  if (lastTerminal?.completedAt) {
    const next = computeNextLazyOccurrence(
      { rrule: input.rrule, recurrenceTimezone: input.recurrenceTimezone },
      lastTerminal.completedAt,
      lastTerminal.status === "done" ? "completed" : "skipped",
    );
    return { occursAt: next.occursAt, occursLocal: wallClockToNaiveDate(next.occursLocal) };
  }

  const seed = input.fallbackDueAt ?? input.effectiveNow;
  return { occursAt: seed, occursLocal: wall(seed) };
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

    const row = await app.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(tasks)
        .values({
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
        })
        .returning();
      if (!inserted) throw new Error("insert into tasks returned no row");

      if (body.rrule) {
        if (recurrenceAnchor === "completion_date") {
          const firstOccursAt = dueAt ?? effectiveNow;
          const occursLocal = toWallClockComponents(firstOccursAt, recurrenceTimezone!);
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
          const ruleAnchor = dueAt ?? effectiveNow;
          const rule: DueDateRecurrenceRule = {
            rrule: body.rrule,
            recurrenceTimezone: recurrenceTimezone!,
            dtstart: toWallClockComponents(ruleAnchor, recurrenceTimezone!),
            recurrenceUntil: recurrenceUntil ?? undefined,
            recurrenceCount: recurrenceCount ?? undefined,
            recurrenceExdates: recurrenceExdates ?? undefined,
          };
          const generated = expandDueDateWindow(rule, 90, effectiveNow);
          for (const occurrence of generated) {
            await tx
              .insert(occurrences)
              .values({
                parentType: "task",
                parentId: inserted.id,
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
      }

      return inserted;
    });

    return reply.code(201).send(toTaskResponse(row));
  });

  app.patch<{ Params: { id: string } }>("/tasks/:id", async (request, reply) => {
    const body = TaskUpdateSchema.parse(request.body);
    const effectiveNow = new Date();

    let row: typeof tasks.$inferSelect | null;
    try {
      row = await runTaskUpdate(app.db, request.params.id, body, effectiveNow);
    } catch (err: unknown) {
      if (err instanceof InvalidEffectiveRuleError) {
        return reply.code(400).send({
          error: "validation_failed",
          issues: [{ code: "custom", path: ["rrule"], message: err.message }],
        });
      }
      throw err;
    }
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toTaskResponse(row);
  });

  registerTaskActionRoutes(app);
}

class InvalidEffectiveRuleError extends Error {}

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
            throw new InvalidEffectiveRuleError(err instanceof Error ? err.message : String(err));
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
      }

      const hadRecurrence = Boolean(existing.rrule);
      const oldAnchor = existing.recurrenceAnchor ?? "due_date";

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
            // Seed exactly one open lazy occurrence (status = 'scheduled', lazy_generated = true) at due_at ?? effectiveNow.
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
            const firstOccursAt = newDueAt ?? effectiveNow;
            const occursLocal = toWallClockComponents(firstOccursAt, newRecurrenceTimezone!);
            await tx
              .insert(occurrences)
              .values({
                parentType: "task",
                parentId: existing.id,
                occursAt: firstOccursAt,
                occursLocal: wallClockToNaiveDate(occursLocal),
                status: "scheduled",
                lazyGenerated: true,
              })
              .onConflictDoNothing({
                target: [occurrences.parentType, occurrences.parentId, occurrences.occursAt],
              });
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
            const ruleChanged =
              newRrule !== existing.rrule || newRecurrenceTimezone !== existing.recurrenceTimezone;
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
                await tx
                  .insert(occurrences)
                  .values({
                    parentType: "task",
                    parentId: existing.id,
                    occursAt: target.occursAt,
                    occursLocal: target.occursLocal,
                    status: "scheduled",
                    lazyGenerated: true,
                  })
                  .onConflictDoNothing();
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
            // A. Due-Date -> Due-Date Edit:
            // Preserve done, skipped, and historical scheduled (occurs_at < effectiveNow).
            // Delete future scheduled non-lazy occurrences (status = 'scheduled' AND occurs_at >= effectiveNow).
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

          // Materialize 90-day window from effectiveNow into occurrences with lazy_generated = false
          const ruleAnchor = newDueAt ?? effectiveNow;
          const rule: DueDateRecurrenceRule = {
            rrule: newRrule!,
            recurrenceTimezone: newRecurrenceTimezone!,
            dtstart: toWallClockComponents(ruleAnchor, newRecurrenceTimezone!),
            recurrenceUntil: newRecurrenceUntil ?? undefined,
            recurrenceCount: newRecurrenceCount ?? undefined,
            recurrenceExdates: newRecurrenceExdates ?? undefined,
          };
          const generated = expandDueDateWindow(rule, 90, effectiveNow);
          for (const occurrence of generated) {
            await tx
              .insert(occurrences)
              .values({
                parentType: "task",
                parentId: existing.id,
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
    const [row] = await app.db
      .update(tasks)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(tasks.id, request.params.id))
      .returning();
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
    const [row] = await app.db
      .update(tasks)
      .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(tasks.id, request.params.id))
      .returning();
    if (!row) throw new Error("update on tasks returned no row for an id that was just found");
    return toTaskResponse(row);
  });

  // done|dropped -> active (Checkpoint 9.3). Clears completed_at, touches
  // nothing else: occurrences are left exactly as they are -- a reopened
  // recurring task keeps its history and, if its successor already exists,
  // that open occurrence -- and archived_at is an independent axis, but an
  // archived task is 404 here (a reopen on something hidden from every list
  // would be a state change nobody can see). inbox and active are refused
  // with 409 rather than treated as a no-op, so a client acting on a stale
  // row learns its view is stale.
  app.post<{ Params: { id: string } }>("/tasks/:id/reopen", async (request, reply) => {
    const existing = await findTask(app, request.params.id);
    if (!existing || existing.archivedAt) return reply.code(404).send({ error: "not_found" });
    if (!canReopenTask(existing.status)) {
      return reply.code(409).send({ error: "task_not_reopenable", status: existing.status });
    }
    const [row] = await app.db
      .update(tasks)
      .set({ status: "active", completedAt: null, updatedAt: new Date() })
      .where(eq(tasks.id, request.params.id))
      .returning();
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
