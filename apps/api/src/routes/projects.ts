import { events, notes, projects, tasks } from "@personal-os/db";
import {
  ProjectCreateSchema,
  ProjectDetailResponseSchema,
  ProjectListQuerySchema,
  ProjectSchema,
  ProjectSummaryListResponseSchema,
  ProjectUpdateSchema,
} from "@personal-os/schema";
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  computeProjectComputed,
  computeProjectSummaries,
  toProjectPayload,
} from "../read-models/project-summaries.js";

// Detail section caps -- items are capped, totals are not ("honest total").
const DETAIL_SECTION_LIMIT = 50;

// Postgres keeps microseconds but JS Dates only carry milliseconds -- two
// rapid writes would otherwise stamp identical updated_at values and break
// "strictly advances" for anything using it as a change marker.
function nextTimestamp(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

function toProjectResponse(row: typeof projects.$inferSelect) {
  // date columns round-trip as plain YYYY-MM-DD strings, same as events'
  // start_date/end_date.
  return ProjectSchema.parse(toProjectPayload(row));
}

// Small, unbounded-need table -- returns a plain array, no pagination
// envelope (unlike tasks/notes/inbox).
export default function projectsRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string> }>("/projects", async (request) => {
    const query = ProjectListQuerySchema.parse(request.query);
    const rows = await app.db
      .select()
      .from(projects)
      .where(query.include_archived ? undefined : isNull(projects.archivedAt));
    return rows.map(toProjectResponse);
  });

  // Static path registered alongside the parametric /projects/:id below;
  // find-my-way always prefers the static segment (pinned by a test).
  app.get<{ Querystring: Record<string, string> }>("/projects/summaries", async (request) => {
    const query = ProjectListQuerySchema.parse(request.query);
    const items = await computeProjectSummaries(app.db, {
      includeArchived: query.include_archived,
    });
    return ProjectSummaryListResponseSchema.parse({ items });
  });

  // Returns the row even if archived, same reasoning as tasks/:id and
  // notes/:id.
  app.get<{ Params: { id: string } }>("/projects/:id", async (request, reply) => {
    const [row] = await app.db.select().from(projects).where(eq(projects.id, request.params.id));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toProjectResponse(row);
  });

  // Works for archived projects too -- include_archived semantics are a
  // LIST concern; a direct fetch by id is unconditional (same convention as
  // GET /projects/:id above). Series rows only: detached occurrence
  // children (parent_event_id IS NOT NULL) are excluded so an overridden
  // instance never duplicates its series in the events section.
  app.get<{ Params: { id: string } }>("/projects/:id/detail", async (request, reply) => {
    const [row] = await app.db.select().from(projects).where(eq(projects.id, request.params.id));
    if (!row) return reply.code(404).send({ error: "not_found" });

    const computed = await computeProjectComputed(app.db, row.id);

    // Open statuses first (due_at ASC NULLS LAST, then newest-created),
    // closed statuses after by completed_at DESC NULLS LAST; id tiebreak
    // keeps slices deterministic across identical timestamps.
    const taskItems = await app.db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        dueAt: tasks.dueAt,
        priority: tasks.priority,
        rrule: tasks.rrule,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.projectId, row.id), isNull(tasks.archivedAt)))
      .orderBy(
        sql`case when ${tasks.status} in ('inbox','active') then 0 else 1 end`,
        sql`case when ${tasks.status} in ('inbox','active') then ${tasks.dueAt} end asc nulls last`,
        sql`case when ${tasks.status} in ('inbox','active') then ${tasks.createdAt} end desc`,
        sql`case when ${tasks.status} in ('done','dropped') then ${tasks.completedAt} end desc nulls last`,
        asc(tasks.id),
      )
      .limit(DETAIL_SECTION_LIMIT);
    const [taskTotal] = await app.db
      .select({ total: count() })
      .from(tasks)
      .where(and(eq(tasks.projectId, row.id), isNull(tasks.archivedAt)));

    const noteItems = await app.db
      .select({
        id: notes.id,
        title: notes.title,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(and(eq(notes.projectId, row.id), isNull(notes.archivedAt)))
      .orderBy(desc(notes.updatedAt))
      .limit(DETAIL_SECTION_LIMIT);
    const [noteTotal] = await app.db
      .select({ total: count() })
      .from(notes)
      .where(and(eq(notes.projectId, row.id), isNull(notes.archivedAt)));

    const eventItems = await app.db
      .select({
        id: events.id,
        title: events.title,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        allDay: events.allDay,
        startDate: events.startDate,
        endDate: events.endDate,
        location: events.location,
        rrule: events.rrule,
      })
      .from(events)
      .where(
        and(eq(events.projectId, row.id), isNull(events.archivedAt), isNull(events.parentEventId)),
      )
      .orderBy(sql`${events.startsAt} desc nulls last`, asc(events.id))
      .limit(DETAIL_SECTION_LIMIT);
    const [eventTotal] = await app.db
      .select({ total: count() })
      .from(events)
      .where(
        and(eq(events.projectId, row.id), isNull(events.archivedAt), isNull(events.parentEventId)),
      );

    return ProjectDetailResponseSchema.parse({
      project: toProjectPayload(row),
      computed,
      tasks: {
        items: taskItems.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          due_at: task.dueAt ? task.dueAt.toISOString() : null,
          priority: task.priority,
          rrule: task.rrule,
          completed_at: task.completedAt ? task.completedAt.toISOString() : null,
        })),
        total: Number(taskTotal?.total ?? 0),
      },
      notes: {
        items: noteItems.map((note) => ({
          id: note.id,
          title: note.title,
          created_at: note.createdAt.toISOString(),
          updated_at: note.updatedAt.toISOString(),
        })),
        total: Number(noteTotal?.total ?? 0),
      },
      events: {
        items: eventItems.map((event) => ({
          id: event.id,
          title: event.title,
          starts_at: event.startsAt ? event.startsAt.toISOString() : null,
          ends_at: event.endsAt ? event.endsAt.toISOString() : null,
          all_day: event.allDay,
          start_date: event.startDate ?? null,
          end_date: event.endDate ?? null,
          location: event.location,
          rrule: event.rrule,
        })),
        total: Number(eventTotal?.total ?? 0),
      },
    });
  });

  app.post("/projects", async (request, reply) => {
    const body = ProjectCreateSchema.parse(request.body);
    const [row] = await app.db
      .insert(projects)
      .values({
        name: body.name,
        color: body.color,
        goal: body.goal,
        targetDate: body.target_date,
      })
      .returning();
    if (!row) throw new Error("insert into projects returned no row");
    return reply.code(201).send(toProjectResponse(row));
  });

  app.patch<{ Params: { id: string } }>("/projects/:id", async (request, reply) => {
    const body = ProjectUpdateSchema.parse(request.body);
    const [existing] = await app.db
      .select()
      .from(projects)
      .where(eq(projects.id, request.params.id));
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const [row] = await app.db
      .update(projects)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.color !== undefined && { color: body.color }),
        ...(body.goal !== undefined && { goal: body.goal }),
        ...(body.target_date !== undefined && { targetDate: body.target_date }),
        updatedAt: nextTimestamp(existing.updatedAt),
      })
      .where(eq(projects.id, request.params.id))
      .returning();
    if (!row) throw new Error("update on projects returned no row for an id that was just found");
    return toProjectResponse(row);
  });

  // ---- Lifecycle actions (Checkpoint 5.2) ----
  // Real state changes bump updated_at; pure idempotent no-ops return the
  // current row untouched. Lifecycle (status/completed_at) and soft-delete
  // (archived_at) are separate axes (ADR-039): archiving preserves both.

  app.post<{ Params: { id: string } }>("/projects/:id/pause", async (request, reply) => {
    const [existing] = await app.db
      .select()
      .from(projects)
      .where(eq(projects.id, request.params.id));
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.status === "completed") {
      return reply.code(409).send({ error: "invalid_status_transition", status: existing.status });
    }
    if (existing.status === "paused") return toProjectResponse(existing);
    const [row] = await app.db
      .update(projects)
      .set({ status: "paused", updatedAt: nextTimestamp(existing.updatedAt) })
      .where(eq(projects.id, request.params.id))
      .returning();
    if (!row) throw new Error("update on projects returned no row for an id that was just found");
    return toProjectResponse(row);
  });

  app.post<{ Params: { id: string } }>("/projects/:id/resume", async (request, reply) => {
    const [existing] = await app.db
      .select()
      .from(projects)
      .where(eq(projects.id, request.params.id));
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.status === "completed") {
      return reply.code(409).send({ error: "invalid_status_transition", status: existing.status });
    }
    if (existing.status === "active") return toProjectResponse(existing);
    const [row] = await app.db
      .update(projects)
      .set({ status: "active", updatedAt: nextTimestamp(existing.updatedAt) })
      .where(eq(projects.id, request.params.id))
      .returning();
    if (!row) throw new Error("update on projects returned no row for an id that was just found");
    return toProjectResponse(row);
  });

  // completed_at stamps the FIRST completion only -- completing an already-
  // completed project returns the original timestamp unchanged.
  app.post<{ Params: { id: string } }>("/projects/:id/complete", async (request, reply) => {
    const [existing] = await app.db
      .select()
      .from(projects)
      .where(eq(projects.id, request.params.id));
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.status === "completed") return toProjectResponse(existing);
    const [row] = await app.db
      .update(projects)
      .set({
        status: "completed",
        completedAt: existing.completedAt ?? new Date(),
        updatedAt: nextTimestamp(existing.updatedAt),
      })
      .where(eq(projects.id, request.params.id))
      .returning();
    if (!row) throw new Error("update on projects returned no row for an id that was just found");
    return toProjectResponse(row);
  });

  app.post<{ Params: { id: string } }>("/projects/:id/reopen", async (request, reply) => {
    const [existing] = await app.db
      .select()
      .from(projects)
      .where(eq(projects.id, request.params.id));
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.status === "paused") {
      return reply.code(409).send({ error: "invalid_status_transition", status: existing.status });
    }
    if (existing.status === "active") return toProjectResponse(existing);
    const [row] = await app.db
      .update(projects)
      .set({ status: "active", completedAt: null, updatedAt: nextTimestamp(existing.updatedAt) })
      .where(eq(projects.id, request.params.id))
      .returning();
    if (!row) throw new Error("update on projects returned no row for an id that was just found");
    return toProjectResponse(row);
  });

  // Sets archived_at exactly once: re-archiving returns the ORIGINAL
  // timestamp without touching updated_at (fixes the earlier overwrite debt).
  // Soft-delete only -- does NOT cascade to tasks/notes/events; they keep
  // their project_id and remain visible in their own list views.
  app.post<{ Params: { id: string } }>("/projects/:id/archive", async (request, reply) => {
    const [existing] = await app.db
      .select()
      .from(projects)
      .where(eq(projects.id, request.params.id));
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.archivedAt) return toProjectResponse(existing);
    const [row] = await app.db
      .update(projects)
      .set({ archivedAt: new Date(), updatedAt: nextTimestamp(existing.updatedAt) })
      .where(eq(projects.id, request.params.id))
      .returning();
    if (!row) throw new Error("update on projects returned no row for an id that was just found");
    return toProjectResponse(row);
  });

  // Clears archived_at while preserving the exact underlying lifecycle
  // state -- unarchiving never forces a project back to active. Unarching
  // a non-archived project is a no-op.
  app.post<{ Params: { id: string } }>("/projects/:id/unarchive", async (request, reply) => {
    const [existing] = await app.db
      .select()
      .from(projects)
      .where(eq(projects.id, request.params.id));
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (!existing.archivedAt) return toProjectResponse(existing);
    const [row] = await app.db
      .update(projects)
      .set({ archivedAt: null, updatedAt: nextTimestamp(existing.updatedAt) })
      .where(eq(projects.id, request.params.id))
      .returning();
    if (!row) throw new Error("update on projects returned no row for an id that was just found");
    return toProjectResponse(row);
  });
}
