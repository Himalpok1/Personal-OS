import { canvasCourses, memories, projects, type Db } from "@personal-os/db";
import {
  MemoryCreateSchema,
  MemoryDeleteAllRequestSchema,
  MemoryDeleteAllResponseSchema,
  MemoryListQuerySchema,
  MemoryUpdateSchema,
  type MemoryItem,
} from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getMemoryItem, listMemories, type MemoryReader } from "../read-models/memories.js";

// The Personal Memory layer's CRUD (Checkpoint 10.7, ADR-077 §2, §3, §8).
//
// NOTHING WRITES A MEMORY BUT THE OWNER. POST /memories writes `source =
// 'user'` (not client-suppliable -- MemoryCreateSchema is `.strict()` and has
// no such field), and PATCH can never change `source` or `suggestion_id`
// (MemoryUpdateSchema has neither), because provenance is what makes a memory
// explainable. The other writer, POST /memory-suggestions/:key/decide, lives
// in routes/memory-suggestions.ts and writes `source = 'suggestion'`.
//
// DELETE MEANS DELETE. Both delete routes are real row deletes -- never
// TRUNCATE, which the runtime role is not granted -- and `memories` is the
// only user-authored entity with no `archived_at`. Under ADR-024 that is
// unrecoverable by design; GET /export is the one undo.
//
// Every response is built by the read model (read-models/memories.ts) so the
// resolved project/course names come from exactly one projection. Logging is
// the request logger's own counts-only lines; no route here logs a statement.
//
// Responses are RETURNED after `reply.code(...)` -- Fastify's async handlers
// send the returned value, and an undefined return on a 204 sends an empty
// body. Guard 6 denies every enqueue token (`boss`, `pg-boss`, `*_QUEUE`) in
// the memory route files so no job can ever carry a memory (ADR-077 §6).

const IdParamsSchema = z.object({ id: z.string().uuid() });

type LinkField = "project_id" | "canvas_course_id";

/**
 * The same 400 validation_failed / `code: "custom"` issue shape routes/
 * tasks.ts uses for its canvas_assignment_id pre-check (Checkpoint 10.5):
 * the FK alone would surface an unknown id as an unhandled 500.
 */
export function memoryLinkValidationIssue(field: LinkField): {
  code: "custom";
  path: [LinkField];
  message: string;
} {
  const target = field === "project_id" ? "project" : "course";
  return {
    code: "custom",
    path: [field],
    message: `${field} does not reference an existing ${target}`,
  };
}

/** True only when `id` names a real projects row (archived or not). */
export async function projectExists(db: MemoryReader, id: string): Promise<boolean> {
  const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id));
  return row !== undefined;
}

/**
 * True only when `id` names a real canvas_courses row. Read-only, never
 * touches canvas_connections, never imports @personal-os/canvas-providers.
 */
export async function canvasCourseExists(db: MemoryReader, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: canvasCourses.id })
    .from(canvasCourses)
    .where(eq(canvasCourses.id, id));
  return row !== undefined;
}

/**
 * Checks every non-null link on a write body before anything is written.
 * Returns the first failing field's issue, or null when every link resolves.
 */
export async function findBrokenLink(
  db: Db,
  links: { project_id?: string | null; canvas_course_id?: string | null },
): Promise<ReturnType<typeof memoryLinkValidationIssue> | null> {
  if (links.project_id && !(await projectExists(db, links.project_id))) {
    return memoryLinkValidationIssue("project_id");
  }
  if (links.canvas_course_id && !(await canvasCourseExists(db, links.canvas_course_id))) {
    return memoryLinkValidationIssue("canvas_course_id");
  }
  return null;
}

async function requireItem(db: Db, id: string): Promise<MemoryItem> {
  const item = await getMemoryItem(db, id);
  if (!item) throw new Error("memory row vanished between write and read-back");
  return item;
}

export default function memoriesRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string> }>("/memories", async (request) => {
    const query = MemoryListQuerySchema.parse(request.query);
    return listMemories(app.db, query);
  });

  // Registered before `/memories/:id`. Fastify (find-my-way) matches a static
  // segment ahead of a parametric one regardless of order, and a test pins
  // that `delete-all` is never captured as an id; the order here just makes
  // the file read the way the router resolves.
  app.post("/memories/delete-all", async (request) => {
    MemoryDeleteAllRequestSchema.parse(request.body);
    const deleted = await app.db.delete(memories).returning({ id: memories.id });
    return MemoryDeleteAllResponseSchema.parse({ deleted: deleted.length });
  });

  app.get<{ Params: { id: string } }>("/memories/:id", async (request, reply) => {
    const params = IdParamsSchema.parse(request.params);
    const item = await getMemoryItem(app.db, params.id);
    if (!item) {
      reply.code(404);
      return { error: "memory_not_found" };
    }
    return item;
  });

  app.post("/memories", async (request, reply) => {
    const body = MemoryCreateSchema.parse(request.body);
    const broken = await findBrokenLink(app.db, body);
    if (broken) {
      reply.code(400);
      return { error: "validation_failed", issues: [broken] };
    }

    const [row] = await app.db
      .insert(memories)
      .values({
        kind: body.kind,
        statement: body.statement,
        note: body.note ?? null,
        source: "user",
        projectId: body.project_id ?? null,
        canvasCourseId: body.canvas_course_id ?? null,
      })
      .returning({ id: memories.id });
    if (!row) throw new Error("insert into memories returned no row");
    reply.code(201);
    return requireItem(app.db, row.id);
  });

  app.patch<{ Params: { id: string } }>("/memories/:id", async (request, reply) => {
    const params = IdParamsSchema.parse(request.params);
    const body = MemoryUpdateSchema.parse(request.body);
    const broken = await findBrokenLink(app.db, body);
    if (broken) {
      reply.code(400);
      return { error: "validation_failed", issues: [broken] };
    }

    // `source` and `suggestion_id` are not in MemoryUpdateSchema and are not
    // named here, so provenance cannot change through this route.
    const [row] = await app.db
      .update(memories)
      .set({
        ...(body.kind !== undefined && { kind: body.kind }),
        ...(body.statement !== undefined && { statement: body.statement }),
        ...(body.note !== undefined && { note: body.note }),
        ...(body.project_id !== undefined && { projectId: body.project_id }),
        ...(body.canvas_course_id !== undefined && { canvasCourseId: body.canvas_course_id }),
        updatedAt: new Date(),
      })
      .where(eq(memories.id, params.id))
      .returning({ id: memories.id });
    if (!row) {
      reply.code(404);
      return { error: "memory_not_found" };
    }
    return requireItem(app.db, row.id);
  });

  app.delete<{ Params: { id: string } }>("/memories/:id", async (request, reply) => {
    const params = IdParamsSchema.parse(request.params);
    const deleted = await app.db
      .delete(memories)
      .where(eq(memories.id, params.id))
      .returning({ id: memories.id });
    if (deleted.length === 0) {
      reply.code(404);
      return { error: "memory_not_found" };
    }
    reply.code(204);
    return undefined;
  });
}
