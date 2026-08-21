import { projects } from "@personal-os/db";
import {
  ProjectCreateSchema,
  ProjectListQuerySchema,
  ProjectSchema,
  ProjectUpdateSchema,
} from "@personal-os/schema";
import { eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

function toProjectResponse(row: typeof projects.$inferSelect) {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    status: row.status,
    color: row.color,
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    // Interim Phase 5 Step 1 shim: these columns arrive with migration 0010
    // (Checkpoint 5.1); every project in existence today predates them.
    goal: null,
    target_date: null,
    completed_at: null,
    updated_at: row.createdAt.toISOString(),
  });
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

  // Returns the row even if archived, same reasoning as tasks/:id and
  // notes/:id.
  app.get<{ Params: { id: string } }>("/projects/:id", async (request, reply) => {
    const [row] = await app.db.select().from(projects).where(eq(projects.id, request.params.id));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toProjectResponse(row);
  });

  app.post("/projects", async (request, reply) => {
    const body = ProjectCreateSchema.parse(request.body);
    const [row] = await app.db
      .insert(projects)
      .values({
        name: body.name,
        color: body.color,
      })
      .returning();
    if (!row) throw new Error("insert into projects returned no row");
    return reply.code(201).send(toProjectResponse(row));
  });

  app.patch<{ Params: { id: string } }>("/projects/:id", async (request, reply) => {
    const body = ProjectUpdateSchema.parse(request.body);
    const [row] = await app.db
      .update(projects)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.color !== undefined && { color: body.color }),
      })
      .where(eq(projects.id, request.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toProjectResponse(row);
  });

  // Soft-delete only -- does NOT cascade to tasks/notes/events. Their
  // existing project_id FK (onDelete: "set null") is irrelevant here since
  // nothing is being deleted at the database level; they simply keep
  // pointing at this now-archived project and remain visible in their own
  // list views.
  app.post<{ Params: { id: string } }>("/projects/:id/archive", async (request, reply) => {
    const [row] = await app.db
      .update(projects)
      .set({ archivedAt: new Date() })
      .where(eq(projects.id, request.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toProjectResponse(row);
  });
}
