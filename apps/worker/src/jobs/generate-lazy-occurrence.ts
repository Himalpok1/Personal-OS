import {
  computeNextLazyOccurrence,
  validateCompletionAnchoredRule,
  wallClockToNaiveDate,
  wallTimeOfNaiveTimestamp,
} from "@personal-os/core";
import { occurrences, tasks, type Db } from "@personal-os/db";
import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { errorToken, log } from "../logger.js";
import { OCCURRENCES_GENERATE_LAZY_QUEUE } from "../queue-names.js";
import { withOccurrencesJobErrorContainment } from "./occurrences-job-error.js";

export interface GenerateLazyOccurrenceJobData {
  occurrenceId: string;
  fromStatus: "completed" | "skipped";
}

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const direct = (err as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === "string") return causeCode;
  }
  return undefined;
}

const UNIQUE_VIOLATION = "23505";

/**
 * The insert of a successor hit a unique index, and no scheduled occurrence
 * exists for the parent afterwards -- so nothing is open and the series has
 * stopped. Thrown (rather than reported as `successor_exists`) so pg-boss
 * retries and, on exhaustion, dead-letters and alerts; see generateOne.
 * Ids only: `errorToken` emits the class name, and the message carries no
 * rule text or row detail.
 */
export class LazySuccessorCollisionError extends Error {
  readonly taskId: string;
  readonly occurrenceId: string;

  constructor(taskId: string, occurrenceId: string) {
    super("lazy successor collided on a unique index and no open occurrence exists");
    this.name = "LazySuccessorCollisionError";
    this.taskId = taskId;
    this.occurrenceId = occurrenceId;
  }
}

async function findOpenOccurrence(db: Db, taskId: string): Promise<{ id: string } | undefined> {
  const [open] = await db
    .select({ id: occurrences.id })
    .from(occurrences)
    .where(
      and(
        eq(occurrences.parentType, "task"),
        eq(occurrences.parentId, taskId),
        eq(occurrences.status, "scheduled"),
      ),
    )
    .limit(1);
  return open;
}

/**
 * What one attempt at a successor came to. `generated` and `successor_exists`
 * both mean an open occurrence now exists for the parent; `skipped` means the
 * current durable state warrants no successor at all (occurrence gone, not a
 * task, not completion-anchored). A failure is a throw, never a member of this
 * set, so a caller that wants "did it work" reads the outcome and a caller that
 * wants "why not" reads the log line the skip already wrote.
 */
export type GenerateLazyOutcome = "generated" | "successor_exists" | "skipped";

// Every skip below is logged through the structured logger rather than
// `console.warn` (Checkpoint 9.0): ids and closed-vocabulary reasons only,
// never a title or a rule string. The `reason` values are a closed set so an
// operator can grep the log for a class of skip rather than a sentence.
//
// Exported so the dead-letter handler (jobs/occurrences-dead-letter.ts) can
// make ONE further attempt before alerting: the realistic way this queue
// exhausts its retries is a transient outage -- a Postgres restart, the
// deployment rollout itself -- that has healed by the time the dead job runs,
// and an alert for a successor that a single retry would have produced is a
// misleading push followed by a task that never recurs again.
export async function generateOne(
  db: Db,
  data: GenerateLazyOccurrenceJobData,
): Promise<GenerateLazyOutcome> {
  const [occurrence] = await db
    .select()
    .from(occurrences)
    .where(eq(occurrences.id, data.occurrenceId));
  if (!occurrence) {
    log.warn("occurrences.generate_lazy.skipped", {
      occurrenceId: data.occurrenceId,
      reason: "occurrence_missing",
    });
    return "skipped";
  }
  if (occurrence.parentType !== "task") {
    log.warn("occurrences.generate_lazy.skipped", {
      occurrenceId: data.occurrenceId,
      reason: "not_task_occurrence",
    });
    return "skipped";
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, occurrence.parentId));
  if (
    !task ||
    task.recurrenceAnchor !== "completion_date" ||
    !task.rrule ||
    !task.recurrenceTimezone
  ) {
    log.warn("occurrences.generate_lazy.skipped", {
      occurrenceId: data.occurrenceId,
      taskId: occurrence.parentId,
      reason: "not_completion_anchored",
    });
    return "skipped";
  }
  // A dropped or archived parent recurs no further (Checkpoint 9.3 review).
  // The nightly window job has excluded such parents since Phase 2 for the
  // due_date strategy; this is the same rule for the lazy one. The API's
  // transitionOccurrence already declines to enqueue for a closed parent, so
  // reaching this branch means the parent closed between the completion and
  // this run, or the job was enqueued directly -- either way, generating a
  // successor would silently resurrect a task the owner closed.
  if (task.status === "dropped" || task.archivedAt !== null) {
    log.info("occurrences.generate_lazy.skipped", {
      occurrenceId: data.occurrenceId,
      taskId: task.id,
      reason: "parent_closed",
    });
    return "skipped";
  }

  // Checkpoint 9.3: the API now inserts the successor IN THE SAME TRANSACTION
  // as the completion/skip (apps/api/src/routes/occurrences.ts) and still
  // enqueues this job as a belt-and-braces re-check. The common case is
  // therefore that the successor already exists by the time this runs, and
  // that is success. It was already success via the 23505 catch below, but
  // that path first computes a candidate and attempts an insert, and the
  // partial index only guards LAZY rows -- so this reads current state first
  // and treats ANY open scheduled occurrence for the parent as "nothing to
  // do", the same condition the dead-letter handler keys on
  // (jobs/occurrences-dead-letter.ts): a completion-anchored task never has
  // pre-expanded rows, so an open one can only be the initial occurrence or a
  // successor, and either way the user has something to act on.
  const open = await findOpenOccurrence(db, task.id);
  if (open) {
    log.info("occurrences.generate_lazy.skipped", {
      occurrenceId: data.occurrenceId,
      taskId: task.id,
      reason: "successor_exists",
      openOccurrenceId: open.id,
    });
    return "successor_exists";
  }

  // Re-validated defensively even though this should already have been
  // enforced at write time (see commit-parsed-entity.ts) -- hitting this
  // here would indicate a data-integrity bug worth surfacing loudly, not a
  // normal error path. It IS loud now: the throw is classified below, retried
  // by pg-boss, and on exhaustion routed to occurrences.generate-lazy.dead,
  // which alerts the owner (jobs/occurrences-dead-letter.ts).
  validateCompletionAnchoredRule(task.rrule);

  // `fromInstant` is the completion instant the API stamped, so the successor's
  // DATE anchors from when the owner actually acted; `wallTime` is the
  // completed occurrence's own time of day, so its TIME does not (Checkpoint
  // 9.4); `after` is the completed occurrence's own instant, so a row
  // completed INTERVAL days or more EARLY still gets a successor strictly
  // after itself instead of a candidate at or before its own occurs_at, which
  // `occurrences_parent_occurs_at_key` would reject (9.4 review). All three
  // are read from the source row, never from this process's clock or zone,
  // and they are the identical inputs the API's transitionOccurrence used for
  // its in-transaction insert -- which is what makes this re-check land on
  // the same instant and collapse on the unique index instead of scheduling
  // a second, different successor.
  const fromInstant = occurrence.completedAt ?? new Date();
  const next = computeNextLazyOccurrence(
    { rrule: task.rrule, recurrenceTimezone: task.recurrenceTimezone },
    fromInstant,
    data.fromStatus,
    {
      wallTime: wallTimeOfNaiveTimestamp(occurrence.occursLocal),
      after: occurrence.occursAt,
    },
  );

  try {
    await db.insert(occurrences).values({
      parentType: "task",
      parentId: task.id,
      occursAt: next.occursAt,
      occursLocal: wallClockToNaiveDate(next.occursLocal),
      status: "scheduled",
      lazyGenerated: true,
    });
  } catch (err) {
    if (pgErrorCode(err) !== UNIQUE_VIOLATION) throw err;
    // A 23505 on its own proves only that SOME row holds the key -- not that
    // an open one does. Two indexes can raise it: one_open_occurrence_per_lazy_parent
    // (a concurrent delivery won the race between the state read above and
    // this insert -- the successor exists, success) and
    // occurrences_parent_occurs_at_key (a row already sits at the computed
    // instant -- which, if that row is done or skipped, means NOTHING is open
    // and the series has silently stopped). Before the 9.4 review both were
    // reported as `successor_exists`, so the second case completed the job
    // with nobody told. The only honest test is the state itself: re-read
    // after the fact, and report success only when a scheduled occurrence
    // actually exists. When none does, throw -- pg-boss retries (a retry
    // recomputes the same instant, so a persistent collision reaches
    // occurrences.generate-lazy.dead, whose handler makes one more attempt
    // and then alerts), and the outcome is a push rather than a false success.
    const openAfter = await findOpenOccurrence(db, task.id);
    if (openAfter) {
      log.info("occurrences.generate_lazy.skipped", {
        occurrenceId: data.occurrenceId,
        taskId: task.id,
        reason: "successor_exists",
        openOccurrenceId: openAfter.id,
      });
      return "successor_exists";
    }
    log.warn("occurrences.generate_lazy.collision", {
      occurrenceId: data.occurrenceId,
      taskId: task.id,
      reason: "collision_no_open_occurrence",
    });
    throw new LazySuccessorCollisionError(task.id, data.occurrenceId);
  }
  return "generated";
}

/**
 * Contained at the batch boundary (Checkpoint 9.0), for the same reason every
 * other retrying lane is: the handler used to rethrow raw, so a `pg`
 * DatabaseError's `detail` ("Failing row contains (...)") or a core recurrence
 * error carrying the RRULE text in its message was persisted verbatim into
 * `pgboss.job.output` -- and, on exhaustion, would have been copied onto the
 * dead-letter job too. The rethrow is UNCHANGED in effect: pg-boss still sees a
 * failure and applies the queue's retry policy; only what it persists differs.
 *
 * The per-job classification line is emitted BEFORE the throw so a failure is
 * visible in the log at every attempt, not only on the dead-letter handler's
 * final say. `errorToken` emits a SQLSTATE or a class name and nothing else.
 */
export function createGenerateLazyOccurrenceHandler(db: Db) {
  return withOccurrencesJobErrorContainment(
    OCCURRENCES_GENERATE_LAZY_QUEUE,
    async function handleGenerateLazyOccurrence(
      jobs: Job<GenerateLazyOccurrenceJobData>[],
    ): Promise<void> {
      for (const job of jobs) {
        try {
          await generateOne(db, job.data);
        } catch (err) {
          log.warn("occurrences.generate_lazy.failed", {
            occurrenceId: job.data.occurrenceId,
            fromStatus: job.data.fromStatus,
            error: errorToken(err),
          });
          throw err;
        }
      }
    },
  );
}
