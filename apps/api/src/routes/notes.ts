import { notes } from "@personal-os/db";
import {
  NoteCreateSchema,
  NoteListQuerySchema,
  NoteSchema,
  NoteUpdateSchema,
} from "@personal-os/schema";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

function toNoteResponse(row: typeof notes.$inferSelect) {
  return NoteSchema.parse({
    id: row.id,
    title: row.title,
    body: row.body,
    project_id: row.projectId,
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

export default function notesRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string> }>("/notes", async (request) => {
    const query = NoteListQuerySchema.parse(request.query);
    const where = and(
      query.project_id ? eq(notes.projectId, query.project_id) : undefined,
      query.include_archived ? undefined : isNull(notes.archivedAt),
    );

    const [rows, totalRows] = await Promise.all([
      app.db
        .select()
        .from(notes)
        .where(where)
        .orderBy(desc(notes.updatedAt))
        .limit(query.limit)
        .offset(query.offset),
      app.db.select({ total: count() }).from(notes).where(where),
    ]);
    const total = totalRows[0]?.total ?? 0;

    return {
      items: rows.map(toNoteResponse),
      limit: query.limit,
      offset: query.offset,
      total,
    };
  });

  // Returns the row even if archived -- a direct link to an archived note
  // isn't a 404, it just won't appear in the default list view.
  app.get<{ Params: { id: string } }>("/notes/:id", async (request, reply) => {
    const [row] = await app.db.select().from(notes).where(eq(notes.id, request.params.id));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toNoteResponse(row);
  });

  app.post("/notes", async (request, reply) => {
    const body = NoteCreateSchema.parse(request.body);
    const [row] = await app.db
      .insert(notes)
      .values({
        title: body.title,
        body: body.body,
        projectId: body.project_id,
      })
      .returning();
    if (!row) throw new Error("insert into notes returned no row");
    return reply.code(201).send(toNoteResponse(row));
  });

  app.patch<{ Params: { id: string } }>("/notes/:id", async (request, reply) => {
    const body = NoteUpdateSchema.parse(request.body);
    const [row] = await app.db
      .update(notes)
      .set({
        ...(body.title !== undefined && { title: body.title }),
        ...(body.body !== undefined && { body: body.body }),
        ...(body.project_id !== undefined && { projectId: body.project_id }),
        updatedAt: new Date(),
      })
      .where(eq(notes.id, request.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toNoteResponse(row);
  });

  // Soft-delete: sets archived_at, touches nothing else. Idempotent --
  // re-archiving an already-archived note is a no-op, not an error.
  app.post<{ Params: { id: string } }>("/notes/:id/archive", async (request, reply) => {
    const [row] = await app.db
      .update(notes)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(notes.id, request.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toNoteResponse(row);
  });
}
