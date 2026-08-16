import { canActivateTask, canCompleteTaskDirectly, parseFlexibleDatetime } from "@personal-os/core";
import { occurrences, tasks } from "@personal-os/db";
import {
  TaskCreateSchema,
  TaskListQuerySchema,
  TaskSchema,
  TaskUpdateSchema,
} from "@personal-os/schema";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
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

  // rrule/recurrence_*/status/archived_at are rejected by TaskCreateSchema's
  // .strict() before this ever runs -- recurrence stays capture(AI)-only in
  // Phase 2. Manually created tasks start "active", not "inbox": there's no
  // backing inbox_item to triage, unlike an AI-captured task.
  app.post("/tasks", async (request, reply) => {
    const body = TaskCreateSchema.parse(request.body);
    const [row] = await app.db
      .insert(tasks)
      .values({
        title: body.title,
        body: body.body,
        status: "active",
        dueAt: body.due_at ? parseFlexibleDatetime(body.due_at, body.timezone) : undefined,
        timezone: body.timezone,
        priority: body.priority,
        projectId: body.project_id,
      })
      .returning();
    if (!row) throw new Error("insert into tasks returned no row");
    return reply.code(201).send(toTaskResponse(row));
  });

  app.patch<{ Params: { id: string } }>("/tasks/:id", async (request, reply) => {
    const body = TaskUpdateSchema.parse(request.body);
    const existing = await findTask(app, request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const [row] = await app.db
      .update(tasks)
      .set({
        ...(body.title !== undefined && { title: body.title }),
        ...(body.body !== undefined && { body: body.body }),
        // Resolved against the task's own stored timezone, not a
        // client-supplied one -- editing a task shouldn't require
        // re-sending timezone on every PATCH.
        ...(body.due_at !== undefined && {
          dueAt: body.due_at ? parseFlexibleDatetime(body.due_at, existing.timezone) : null,
        }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.project_id !== undefined && { projectId: body.project_id }),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, request.params.id))
      .returning();
    if (!row) throw new Error("update on tasks returned no row for an id that was just found");
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
