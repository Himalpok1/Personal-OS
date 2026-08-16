import { occurrences, tasks } from "@personal-os/db";
import { OccurrenceListQuerySchema, OccurrenceSchema } from "@personal-os/schema";
import { and, count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { OCCURRENCES_GENERATE_LAZY_QUEUE } from "../queue-names.js";

function toOccurrenceResponse(row: typeof occurrences.$inferSelect) {
  return OccurrenceSchema.parse({
    id: row.id,
    parent_type: row.parentType,
    parent_id: row.parentId,
    occurs_at: row.occursAt.toISOString(),
    status: row.status,
    lazy_generated: row.lazyGenerated,
    completed_at: row.completedAt ? row.completedAt.toISOString() : null,
  });
}

async function markOccurrence(app: FastifyInstance, id: string, status: "done" | "skipped") {
  const [occurrence] = await app.db.select().from(occurrences).where(eq(occurrences.id, id));
  if (!occurrence) return null;
  await app.db
    .update(occurrences)
    .set({ status, completedAt: new Date() })
    .where(eq(occurrences.id, id));
  return occurrence;
}

// Only completion_date-anchored tasks generate lazily on completion/skip
// (due_date-anchored occurrences already exist via the nightly window job;
// events never carry recurrence_anchor at all -- see
// docs/ARCHITECTURE.md's recurrence design section).
async function shouldGenerateLazySuccessor(
  app: FastifyInstance,
  occurrence: { parentType: string; parentId: string },
) {
  if (occurrence.parentType !== "task") return false;
  const [task] = await app.db
    .select({ recurrenceAnchor: tasks.recurrenceAnchor })
    .from(tasks)
    .where(eq(tasks.id, occurrence.parentId));
  return task?.recurrenceAnchor === "completion_date";
}

export default function occurrencesRoutes(app: FastifyInstance): void {
  // Lets the task-list UI discover a recurring task's open occurrence id so
  // it can call the existing complete/skip endpoints below -- before Phase
  // 2 there was no way to list occurrences at all, only act on one by id.
  app.get<{ Querystring: Record<string, string> }>("/occurrences", async (request) => {
    const query = OccurrenceListQuerySchema.parse(request.query);
    const where = and(
      eq(occurrences.parentType, query.parent_type),
      eq(occurrences.parentId, query.parent_id),
      query.status ? eq(occurrences.status, query.status) : undefined,
    );

    const [rows, totalRows] = await Promise.all([
      app.db.select().from(occurrences).where(where).limit(query.limit).offset(query.offset),
      app.db.select({ total: count() }).from(occurrences).where(where),
    ]);
    const total = totalRows[0]?.total ?? 0;

    return {
      items: rows.map(toOccurrenceResponse),
      limit: query.limit,
      offset: query.offset,
      total,
    };
  });

  app.post<{ Params: { id: string } }>("/occurrences/:id/complete", async (request, reply) => {
    const occurrence = await markOccurrence(app, request.params.id, "done");
    if (!occurrence) return reply.code(404).send({ error: "not_found" });

    if (await shouldGenerateLazySuccessor(app, occurrence)) {
      if (app.bossReady) {
        await app.boss.send(
          OCCURRENCES_GENERATE_LAZY_QUEUE,
          { occurrenceId: occurrence.id, fromStatus: "completed" },
          { singletonKey: `generate-lazy:${occurrence.parentType}:${occurrence.parentId}` },
        );
      } else {
        app.log.warn(
          { occurrenceId: occurrence.id },
          "occurrences.complete: job queue unavailable; no successor generated",
        );
      }
    }

    return reply.code(200).send({ id: occurrence.id, status: "done" });
  });

  app.post<{ Params: { id: string } }>("/occurrences/:id/skip", async (request, reply) => {
    const occurrence = await markOccurrence(app, request.params.id, "skipped");
    if (!occurrence) return reply.code(404).send({ error: "not_found" });

    if (await shouldGenerateLazySuccessor(app, occurrence)) {
      if (app.bossReady) {
        await app.boss.send(
          OCCURRENCES_GENERATE_LAZY_QUEUE,
          { occurrenceId: occurrence.id, fromStatus: "skipped" },
          { singletonKey: `generate-lazy:${occurrence.parentType}:${occurrence.parentId}` },
        );
      } else {
        app.log.warn(
          { occurrenceId: occurrence.id },
          "occurrences.skip: job queue unavailable; no successor generated",
        );
      }
    }

    return reply.code(200).send({ id: occurrence.id, status: "skipped" });
  });
}
