import {
  computeNextLazyOccurrence,
  wallClockToNaiveDate,
  wallTimeOfNaiveTimestamp,
} from "@personal-os/core";
import { errorToken } from "@personal-os/core/logging/logger";
import { occurrences, tasks } from "@personal-os/db";
import {
  MAX_SNOOZE_DAYS,
  OccurrenceListQuerySchema,
  OccurrenceReopenResponseSchema,
  OccurrenceSchema,
  OccurrenceSnoozeSchema,
} from "@personal-os/schema";
import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";
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
    snoozed_until: row.snoozedUntil ? row.snoozedUntil.toISOString() : null,
  });
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
    // snoozed_until is cleared on the transition (Checkpoint 9.4): the
    // effective instant of a terminal row is meaningless, and leaving the
    // snooze in place would make a later reopen resurrect it silently.
    await tx
      .update(occurrences)
      .set({ status, completedAt: now, snoozedUntil: null })
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
    // Checkpoint 9.4: the successor keeps the completed occurrence's wall-clock
    // TIME of day (its occurs_local, read through the shared
    // wallTimeOfNaiveTimestamp), anchored on the completion DATE, and lands
    // strictly AFTER the completed row's own occurs_at (`after`, 9.4 review):
    // completing a successor early -- on the day it was created, say, so
    // completion date + INTERVAL is the completed row's own instant -- would
    // otherwise compute that instant, collide on occurrences_parent_occurs_at_key
    // and silently end the series. The worker's belt-and-braces job passes the
    // identical wallTime and after from the identical row, so both writers
    // compute one instant and the second insert collides as designed.
    const wallTime = wallTimeOfNaiveTimestamp(occurrence.occursLocal);
    try {
      await tx.transaction(async (savepoint) => {
        const next = computeNextLazyOccurrence(rule, now, fromStatus, {
          wallTime,
          after: occurrence.occursAt,
        });
        const inserted = await savepoint
          .insert(occurrences)
          .values({
            parentType: "task",
            parentId: occurrence.parentId,
            occursAt: next.occursAt,
            occursLocal: wallClockToNaiveDate(next.occursLocal),
            status: "scheduled",
            lazyGenerated: true,
          })
          .onConflictDoNothing()
          .returning({ id: occurrences.id });
        // Honesty about the no-op (9.4 review): onConflictDoNothing makes a
        // collision indistinguishable from an insert, and a collision is fine
        // only when it means "an open occurrence already exists". A collision
        // that leaves the parent with NOTHING open -- the computed instant is
        // held by a done/skipped row -- is the silent series-ending the
        // `after` bound exists to prevent, so it is logged (ids only) and the
        // re-check job below is still enqueued to try again.
        if (inserted.length === 0) {
          const [open] = await savepoint
            .select({ id: occurrences.id })
            .from(occurrences)
            .where(
              and(
                eq(occurrences.parentType, "task"),
                eq(occurrences.parentId, occurrence.parentId),
                eq(occurrences.status, "scheduled"),
              ),
            )
            .limit(1);
          if (!open) {
            app.log.warn(
              { occurrenceId: occurrence.id, taskId: occurrence.parentId },
              `occurrences.${routeName}: successor insert collided with an existing row; worker re-check enqueued`,
            );
          }
        }
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
    // The completion and its successor are already COMMITTED by the time this
    // runs, so a failed send must not turn into a 500 (9.4 review): the owner
    // would read "Done failed" for a completion that was recorded, the mobile
    // row would stay un-updated, and a retry would be a no-op 200 anyway. The
    // re-check is belt-and-braces; losing it is a warn, never an error.
    try {
      await app.boss.send(
        OCCURRENCES_GENERATE_LAZY_QUEUE,
        { occurrenceId: result.id, fromStatus },
        // singletonKey is INERT under the queue's `standard` policy (pg-boss
        // only dedupes on it for singleton/stately queues); it is kept as
        // documentation of intent. Never switch the queue policy to make it
        // bite: that would drop the second completion's re-check while the
        // first is still queued.
        { singletonKey: `generate-lazy:${result.parentType}:${result.parentId}` },
      );
    } catch (err) {
      app.log.warn(
        { occurrenceId: result.id, error: errorToken(err) },
        `occurrences.${routeName}: successor re-check could not be enqueued; completion and successor already committed`,
      );
    }
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

    // Checkpoint 9.4: a total order. The mobile task detail picks "the next
    // occurrence" from this list, and an unordered page could hand it a
    // different row on every refetch; `id` breaks ties between rows sharing
    // an instant (which the nightly job and a snooze can both produce).
    // `order=desc` (9.4 review) serves the "latest done/skipped" lookup that
    // Undo needs without paging through a 90-day window first; the tie-break
    // follows the direction so the order stays total either way.
    const direction = query.order === "desc" ? desc : asc;
    const [rows, totalRows] = await Promise.all([
      app.db
        .select()
        .from(occurrences)
        .where(where)
        .orderBy(direction(occurrences.occursAt), direction(occurrences.id))
        .limit(query.limit)
        .offset(query.offset),
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

  // Checkpoint 9.4. A snooze on a recurring task acts on ONE occurrence: it
  // sets snoozed_until and nothing else -- never occurs_at (the row's
  // identity under occurrences_parent_occurs_at_key; see
  // read-models/occurrence-effective.ts), never the parent's due_at or
  // remind_at (which would re-anchor the whole series), never the rule.
  // Idempotent: re-sending the same `until` re-writes the same value.
  // `until` must be a real deferral -- strictly after now -- and bounded to
  // MAX_SNOOZE_DAYS: anything further out is a due-date change and belongs to
  // PATCH /tasks/:id. Both bounds report as the same validation_failed shape
  // the schema layer uses, with the offending path and a token-only message.
  app.post<{ Params: { id: string } }>("/occurrences/:id/snooze", async (request, reply) => {
    const body = OccurrenceSnoozeSchema.parse(request.body);
    const now = new Date();
    const until = new Date(body.until);
    if (
      until.getTime() <= now.getTime() ||
      until.getTime() > now.getTime() + MAX_SNOOZE_DAYS * MS_PER_DAY
    ) {
      return reply.code(400).send({
        error: "validation_failed",
        issues: [{ code: "custom", path: ["until"], message: "snooze_out_of_range" }],
      });
    }

    const result = await app.db.transaction(async (tx) => {
      const [occurrence] = await tx
        .select()
        .from(occurrences)
        .where(eq(occurrences.id, request.params.id))
        .for("update");
      if (!occurrence) return { kind: "not_found" as const };
      // Snooze is task-only (9.4 review): an event instance has no "later"
      // in this product -- moving it is a calendar edit (detach/override),
      // and the read models' effective-instant rule is written on the
      // guarantee that only task rows ever carry snoozed_until.
      if (occurrence.parentType !== "task") return { kind: "not_task" as const };
      if (occurrence.status !== "scheduled") return { kind: "not_open" as const };
      const [updated] = await tx
        .update(occurrences)
        .set({ snoozedUntil: until })
        .where(eq(occurrences.id, occurrence.id))
        .returning();
      if (!updated) throw new Error("update on occurrences returned no row for a locked id");
      return { kind: "ok" as const, row: updated };
    });

    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result.kind === "not_task") return reply.code(409).send({ error: "occurrence_not_task" });
    if (result.kind === "not_open") return reply.code(409).send({ error: "occurrence_not_open" });
    return reply.code(200).send(toOccurrenceResponse(result.row));
  });

  // Checkpoint 9.4. Undo a complete/skip on one TASK occurrence (an event
  // occurrence is 409 occurrence_not_task, like snooze -- the calendar has
  // its own detach/cancel model and nothing there produces derived rows).
  // For a due_date parent this is a plain flip back to scheduled. For a
  // completion_date parent the successor that the completion inserted is
  // DERIVED state -- it exists only because this row was completed -- so it
  // is withdrawn in the same transaction, and it is deleted BEFORE the flip:
  // one_open_occurrence_per_lazy_parent is a partial unique index on
  // (parent_type, parent_id) where scheduled and lazy, so flipping first
  // would collide with the successor and abort. EVERY other scheduled row of
  // the parent is withdrawn, not only lazy ones (9.4 review): a non-lazy
  // scheduled row can survive an anchor switch (branch C deletes non-lazy
  // rows, but a row materialised later by a reopen's window pass is lazy) and
  // history seeded before 9.3 is not uniformly flagged, so filtering on
  // lazy_generated could leave a completion_date parent with two open rows,
  // which is the one state the product contract forbids. The target row is
  // locked FOR UPDATE first so a concurrent complete of the successor
  // serialises behind this reopen rather than racing its delete. Nothing is
  // enqueued: no successor is created by a reopen, ever.
  //
  // Only the parent's LATEST terminal row may be reopened (9.4 review) --
  // latest by completed_at, then occurs_at, the order the mobile Undo uses to
  // pick the one row it offers. Reopening an OLDER completion of a
  // completion_date series would withdraw the current open successor and
  // leave the series anchored on a row the owner did not undo; for a
  // due_date series it would revive an instance the owner already moved past
  // while a later one stays done. Anything but the latest is 409
  // occurrence_not_reopenable.
  //
  // A dropped or archived parent refuses (409 task_not_open): its occurrences
  // may still be completed (Checkpoint 9.3 review) but reviving an open
  // instance under a closed task would make a closed task actionable again on
  // Today. A second reopen is 409 occurrence_not_reopenable (already
  // scheduled) rather than a silent 200, so a client acting on a stale row
  // learns its view is stale -- the same choice POST /tasks/:id/reopen made.
  app.post<{ Params: { id: string } }>("/occurrences/:id/reopen", async (request, reply) => {
    const result = await app.db.transaction(async (tx) => {
      const [occurrence] = await tx
        .select()
        .from(occurrences)
        .where(eq(occurrences.id, request.params.id))
        .for("update");
      if (!occurrence) return { kind: "not_found" as const };
      if (occurrence.parentType !== "task") return { kind: "not_task" as const };
      if (occurrence.status === "scheduled") return { kind: "not_reopenable" as const };

      const [task] = await tx
        .select({
          status: tasks.status,
          archivedAt: tasks.archivedAt,
          recurrenceAnchor: tasks.recurrenceAnchor,
        })
        .from(tasks)
        .where(eq(tasks.id, occurrence.parentId));
      if (!task || task.status === "dropped" || task.archivedAt !== null) {
        return { kind: "task_not_open" as const };
      }

      const [latestTerminal] = await tx
        .select({ id: occurrences.id })
        .from(occurrences)
        .where(
          and(
            eq(occurrences.parentType, "task"),
            eq(occurrences.parentId, occurrence.parentId),
            ne(occurrences.status, "scheduled"),
          ),
        )
        .orderBy(
          sql`${occurrences.completedAt} desc nulls last`,
          desc(occurrences.occursAt),
          desc(occurrences.id),
        )
        .limit(1);
      if (latestTerminal?.id !== occurrence.id) return { kind: "not_reopenable" as const };

      let withdrawnSuccessorId: string | null = null;
      if (task.recurrenceAnchor === "completion_date") {
        const withdrawn = await tx
          .delete(occurrences)
          .where(
            and(
              eq(occurrences.parentType, "task"),
              eq(occurrences.parentId, occurrence.parentId),
              eq(occurrences.status, "scheduled"),
              ne(occurrences.id, occurrence.id),
            ),
          )
          .returning({ id: occurrences.id, lazyGenerated: occurrences.lazyGenerated });
        // At most one lazy row can exist (the partial unique index); report
        // it when present, else whichever open row was withdrawn first.
        withdrawnSuccessorId =
          withdrawn.find((row) => row.lazyGenerated)?.id ?? withdrawn[0]?.id ?? null;
      }

      await tx
        .update(occurrences)
        .set({ status: "scheduled", completedAt: null, snoozedUntil: null })
        .where(eq(occurrences.id, occurrence.id));

      return { kind: "ok" as const, id: occurrence.id, withdrawnSuccessorId };
    });

    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result.kind === "not_task") return reply.code(409).send({ error: "occurrence_not_task" });
    if (result.kind === "not_reopenable") {
      return reply.code(409).send({ error: "occurrence_not_reopenable" });
    }
    if (result.kind === "task_not_open") return reply.code(409).send({ error: "task_not_open" });
    return reply.code(200).send(
      OccurrenceReopenResponseSchema.parse({
        id: result.id,
        status: "scheduled",
        withdrawn_successor_id: result.withdrawnSuccessorId,
      }),
    );
  });
}
