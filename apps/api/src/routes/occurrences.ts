import { occurrences, tasks } from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { OCCURRENCES_GENERATE_LAZY_QUEUE } from "../queue-names.js";

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
