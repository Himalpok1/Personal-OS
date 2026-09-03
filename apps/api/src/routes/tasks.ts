import {
  canActivateTask,
  canCompleteTaskDirectly,
  expandDueDateWindow,
  parseFlexibleDatetime,
  toWallClockComponents,
  wallClockToNaiveDate,
  type DueDateRecurrenceRule,
} from "@personal-os/core";
import { occurrences, tasks } from "@personal-os/db";
import {
  TaskCreateSchema,
  TaskListQuerySchema,
  TaskSchema,
  TaskUpdateSchema,
} from "@personal-os/schema";
import { and, asc, count, desc, eq, gte, inArray, isNull } from "drizzle-orm";
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

    const row = await app.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(tasks).where(eq(tasks.id, request.params.id));
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
        .where(eq(tasks.id, request.params.id))
        .returning();

      return updated;
    });

    if (!row) return reply.code(404).send({ error: "not_found" });
    return toTaskResponse(row);
  });

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
