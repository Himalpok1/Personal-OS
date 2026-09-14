import { computeNextLazyOccurrence, wallClockToNaiveDate } from "@personal-os/core";
import { errorToken } from "@personal-os/core/logging/logger";
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

type TerminalStatus = "done" | "skipped";

interface TransitionResult {
  id: string;
  parentType: string;
  parentId: string;
  /** The occurrence's status AFTER the call -- its pre-existing terminal
   * status when the call was a no-op, the requested one otherwise. */
  status: string;
  /** False when the row was already done/skipped: nothing was written and
   * nothing must be enqueued. */
  transitioned: boolean;
  /** True when the parent is a completion_date-anchored task, i.e. a
   * successor was inserted here and the worker re-check is worth sending. */
  completionAnchoredParent: boolean;
}

// Checkpoint 9.3. One transaction, three invariants:
//
// 1. A terminal occurrence is never re-stamped. The row is locked FOR UPDATE
//    and re-read inside the transaction, so two concurrent completes of the
//    same occurrence cannot both see `scheduled` -- the second sees the
//    first's `done`, writes nothing, enqueues nothing, and returns the
//    current status (200, idempotent). The old code stamped `completed_at`
//    unconditionally, so a double-tap moved the completion instant and sent a
//    second generate-lazy job.
//
// 2. For a completion_date-anchored parent the successor is inserted IN THE
//    SAME TRANSACTION as the status update, from the identical inputs the
//    worker's generateOne uses (the completion instant + the parent's rrule /
//    recurrence_timezone, via packages/core's computeNextLazyOccurrence), so
//    the next occurrence exists the moment the response is sent rather than
//    whenever the worker gets to it -- and, when pg-boss is down at the API
//    (the `bossReady` silent-loss debt recorded in docs/STATUS.md), it exists
//    at all. `onConflictDoNothing` with no target covers BOTH unique indexes:
//    one_open_occurrence_per_lazy_parent (an open lazy occurrence already
//    exists -- the completed row itself no longer matches that partial index
//    once its status is `done`, so the successor is admitted) and
//    occurrences_parent_occurs_at_key (same instant already materialized).
//
// 3. The generate-lazy job is still enqueued afterwards as a belt-and-braces
//    re-check: the worker recomputes the same instant from `completed_at`
//    and treats the resulting unique violation as `successor_exists`.
//
// 4. The successor step CANNOT fail the completion (Checkpoint 9.3 review).
//    computeNextLazyOccurrence re-validates the rule and throws on anything
//    it cannot iterate. Write-time validation is now real (it parses the
//    rule and rejects INTERVAL < 1 and an unknown FREQ), but a rule stored
//    BEFORE that existed -- `FREQ=WEEKLYY`, `FREQ=DAILY;INTERVAL=0` both
//    passed the old name-only check -- is still in the table, and the first
//    version of this transaction rolled the completion itself back when the
//    successor threw: the owner could never complete that task again, and
//    every tap was a 500. The successor computation + insert therefore run
//    under a SAVEPOINT (a nested drizzle transaction) inside a try/catch: on
//    a throw the savepoint is released, an ids-only warn line is written (an
//    error token, never the rule text the core error interpolates), the
//    status update still COMMITS, and the result still reports
//    `completionAnchoredParent: true` so the generate-lazy job is enqueued --
//    where the identical failure is retried, dead-lettered and ALERTED
//    (jobs/occurrences-dead-letter.ts), which is the durable evidence path
//    ADR-062 built for exactly this.
//
// 5. A parent that is `dropped` or archived gets NO successor and NO enqueue
//    (Checkpoint 9.3 review). Its remaining open occurrence is still
//    completable -- the status change commits -- but the nightly window job
//    already refuses to regenerate for such a parent, and lazy generation
//    must not be the one path that keeps a closed task recurring. Mirrored in
//    the worker's generateOne (`parent_closed`).
async function transitionOccurrence(
  app: FastifyInstance,
  id: string,
  status: TerminalStatus,
  routeName: "complete" | "skip",
): Promise<TransitionResult | null> {
  return app.db.transaction(async (tx) => {
    const [occurrence] = await tx
      .select()
      .from(occurrences)
      .where(eq(occurrences.id, id))
      .for("update");
    if (!occurrence) return null;

    const base = {
      id: occurrence.id,
      parentType: occurrence.parentType,
      parentId: occurrence.parentId,
    };

    if (occurrence.status !== "scheduled") {
      return {
        ...base,
        status: occurrence.status,
        transitioned: false,
        completionAnchoredParent: false,
      };
    }

    const now = new Date();
    await tx
      .update(occurrences)
      .set({ status, completedAt: now })
      .where(eq(occurrences.id, occurrence.id));

    // Only completion_date-anchored tasks generate lazily on completion/skip
    // (due_date-anchored occurrences already exist via the nightly window
    // job; events never carry recurrence_anchor at all -- see
    // docs/ARCHITECTURE.md's recurrence design section).
    if (occurrence.parentType !== "task") {
      return { ...base, status, transitioned: true, completionAnchoredParent: false };
    }
    const [task] = await tx
      .select({
        status: tasks.status,
        archivedAt: tasks.archivedAt,
        rrule: tasks.rrule,
        recurrenceAnchor: tasks.recurrenceAnchor,
        recurrenceTimezone: tasks.recurrenceTimezone,
      })
      .from(tasks)
      .where(eq(tasks.id, occurrence.parentId));
    if (
      !task ||
      task.recurrenceAnchor !== "completion_date" ||
      !task.rrule ||
      !task.recurrenceTimezone ||
      task.status === "dropped" ||
      task.archivedAt !== null
    ) {
      return { ...base, status, transitioned: true, completionAnchoredParent: false };
    }

    const rule = { rrule: task.rrule, recurrenceTimezone: task.recurrenceTimezone };
    const fromStatus = status === "done" ? "completed" : "skipped";
    try {
      await tx.transaction(async (savepoint) => {
        const next = computeNextLazyOccurrence(rule, now, fromStatus);
        await savepoint
          .insert(occurrences)
          .values({
            parentType: "task",
            parentId: occurrence.parentId,
            occursAt: next.occursAt,
            occursLocal: wallClockToNaiveDate(next.occursLocal),
            status: "scheduled",
            lazyGenerated: true,
          })
          .onConflictDoNothing();
      });
    } catch (err) {
      app.log.warn(
        { occurrenceId: occurrence.id, taskId: occurrence.parentId, error: errorToken(err) },
        `occurrences.${routeName}: successor generation failed; completion recorded, worker re-check enqueued`,
      );
    }

    return { ...base, status, transitioned: true, completionAnchoredParent: true };
  });
}

async function enqueueSuccessorRecheck(
  app: FastifyInstance,
  result: TransitionResult,
  fromStatus: "completed" | "skipped",
  routeName: "complete" | "skip",
) {
  if (!result.transitioned || !result.completionAnchoredParent) return;
  if (app.bossReady) {
    await app.boss.send(
      OCCURRENCES_GENERATE_LAZY_QUEUE,
      { occurrenceId: result.id, fromStatus },
      { singletonKey: `generate-lazy:${result.parentType}:${result.parentId}` },
    );
  } else {
    // The successor was already inserted in the transaction above, so this
    // is no longer a silent loss -- only the worker's re-check is skipped.
    app.log.warn(
      { occurrenceId: result.id },
      `occurrences.${routeName}: job queue unavailable; successor re-check not enqueued`,
    );
  }
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
    const result = await transitionOccurrence(app, request.params.id, "done", "complete");
    if (!result) return reply.code(404).send({ error: "not_found" });
    await enqueueSuccessorRecheck(app, result, "completed", "complete");
    return reply.code(200).send({ id: result.id, status: result.status });
  });

  app.post<{ Params: { id: string } }>("/occurrences/:id/skip", async (request, reply) => {
    const result = await transitionOccurrence(app, request.params.id, "skipped", "skip");
    if (!result) return reply.code(404).send({ error: "not_found" });
    await enqueueSuccessorRecheck(app, result, "skipped", "skip");
    return reply.code(200).send({ id: result.id, status: result.status });
  });
}
