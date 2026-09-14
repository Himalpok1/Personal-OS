import { truncateField } from "@personal-os/core";
import { stripUnsummarizableCharacters } from "@personal-os/core/mail/provider-strings";
import { occurrences, tasks, type Db } from "@personal-os/db";
import { and, eq } from "drizzle-orm";
import type { Job, JobWithMetadata, PgBoss } from "pg-boss";
import { errorToken, log } from "../logger.js";
import {
  OCCURRENCES_EXPAND_WINDOW_DEAD_QUEUE,
  OCCURRENCES_EXPAND_WINDOW_QUEUE,
  OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE,
  OCCURRENCES_GENERATE_LAZY_QUEUE,
  QUEUE_RETRY_OPTIONS,
} from "../queue-names.js";
import { alertEligibleDevices } from "./alert-eligible-devices.js";
import { generateOne, type GenerateLazyOccurrenceJobData } from "./generate-lazy-occurrence.js";
import { FAILED_PARENT_REFS_MAX, type FailedParentRef } from "./occurrences-job-error.js";

// Dead-letter handling for the two occurrences queues (Checkpoint 9.0).
//
// ===========================================================================
// WHY THESE EXIST, AND WHY THEY ALERT RATHER THAN WRITE A STATUS
// ===========================================================================
//
// `occurrences.generate-lazy` and `occurrences.expand-window` were the last two
// retrying queues with no dead-letter queue (docs/PHASE-8-CLOSEOUT.md §7.6).
// Exhaustion on either was invisible: the only record was pg-boss's
// `job.output`, which self-deletes on the queue's retention, and the handler's
// own `console.warn`. For generate-lazy that meant a completed
// completion-anchored task whose successor could not be computed simply never
// got one -- the user's "water the plants every 3 days" silently stopped
// recurring, with nothing anywhere to say so.
//
// capture.parse's dead-letter handler (Checkpoint 8.6A) writes
// `status: "failed"` into the row it was working on. There is NO equivalent
// column here: `occurrences.status` is CHECKed to scheduled|done|skipped,
// `tasks.status` to inbox|active|done|dropped, and neither table has a jsonb
// column to carry a failure record. Widening either CHECK is a migration, and
// Checkpoint 9.0 targets zero. So the durable evidence is the one permanent,
// never-swept, never-pruned table this system already has for exactly this
// purpose: `notification_dispatch_log`, whose PRIMARY KEY row for an alert
// carries the queue, the occurrence id (or the failure date), `attempted_at`
// and the delivery status. That row outlives pg-boss's retention and is the
// same evidence every other alert producer leaves. It presupposes at least one
// device that notifications.dispatch will actually claim a row FOR: alerts on,
// notifications on, not revoked, AND holding a push token -- the dispatch
// handler drops a token-less device before `claimTarget`, so a producer that
// counted such a device as alerted would log "sent" while nothing durable was
// ever written. The eligibility query here therefore mirrors `resolveTargets`
// axis for axis, and `no_targets` is reported honestly when nothing can be
// delivered. Production satisfies the precondition; the structured log line
// is emitted regardless, so a deployment with no such device still records
// the fact.
//
// ---------------------------------------------------------------------------
// THE DEDUPE KEYS (ADR-058)
//
// `notification_dispatch_log.dedupe_key` is a permanent PRIMARY KEY with no TTL
// and no sweep, claimed with `onConflictDoNothing`, so a key scoped to a
// long-lived identity fires exactly once in the system's lifetime and is then
// permanently dead. Both keys here end in an OCCURRENCE-scoped discriminator
// derived from durable state, never from a clock read at send time:
//
//   generate-lazy: `occurrences.generate-lazy.dead:<occurrenceId>`. The source
//     occurrence is the failure's identity -- one completion, one successor
//     that could not be generated. A redelivered dead job derives the same key;
//     a LATER completion of the same task is a different occurrence and a
//     genuinely new failure, so it alerts again.
//
//   expand-window: `occurrences.expand-window.dead:<YYYY-MM-DD>`, the UTC date
//     of the DEAD job's own `created_on`. The sweep is global and changes
//     nothing durable on failure, so a per-job discriminator would alert once
//     per exhausted retry chain while a date bucket alerts once per night of
//     failure and re-arms the next night -- the same reasoning
//     `health-sync-alert`'s `all_streams_failed` uses, and the shape ADR-056
//     names explicitly ("a date, an incident id, or an occurrence id"). Why the
//     dead job's timestamp and not the source cron job's: see
//     `failureDateDiscriminator`.
//
// ---------------------------------------------------------------------------
// WHAT AN ALERT BODY MAY CONTAIN
//
// A push renders on a lock screen. The generate-lazy body names the task by
// its title -- the owner's own words, and the only thing that lets them tell
// WHICH recurring task stopped without opening the app -- control-character
// stripped and hard-capped, the same treatment Checkpoint 8.1 gave event text
// at the Brief boundary. It carries no id, no address, no rule string and no
// error text; ids travel in `data` for the client to route on, as
// monitor/alerts.ts does. The expand-window body carries the sweep's counts
// ("2 of 14") and nothing else, so it can neither name a parent nor overstate
// a partial failure as a total one.

/** Hard cap on the task title rendered in a push body. */
const ALERT_TITLE_MAX_CHARS = 80;

/**
 * Creates both dead-letter queues, attaches each to its primary, and -- the
 * part that matters on every deployed database -- updates the primary so the
 * attach survives the queue already existing.
 *
 * Exported so a test can run THIS sequence against a database where the
 * primaries already exist without a dead letter (which is production's state)
 * and assert the outcome from `pgboss.queue` rather than from the source text.
 * `boss.work()` registration deliberately stays in index.ts, where the
 * containment and parity guards can see it.
 *
 * Ordering is load-bearing three times over:
 *   1. dead queue BEFORE primary -- `queue.dead_letter` is a foreign key against
 *      `queue.name` (pg-boss 12.27.0, plans.js createTableQueue);
 *   2. createQueue with `deadLetter` -- what attaches it on a FRESH database;
 *   3. updateQueue -- what attaches it on an EXISTING one, because
 *      create_queue ends in ON CONFLICT DO NOTHING and silently discards the
 *      option when the row already exists. Tests run against a database where
 *      the INSERT fires, so without step 3 the attach would pass every suite
 *      and change nothing in production (the Checkpoint 8.6A finding).
 */
export async function attachOccurrencesDeadLetterQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE);
  await boss.createQueue(OCCURRENCES_GENERATE_LAZY_QUEUE, {
    ...QUEUE_RETRY_OPTIONS[OCCURRENCES_GENERATE_LAZY_QUEUE],
    deadLetter: OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE,
  });
  await boss.updateQueue(OCCURRENCES_GENERATE_LAZY_QUEUE, {
    deadLetter: OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE,
  });

  await boss.createQueue(OCCURRENCES_EXPAND_WINDOW_DEAD_QUEUE);
  await boss.createQueue(OCCURRENCES_EXPAND_WINDOW_QUEUE, {
    ...QUEUE_RETRY_OPTIONS[OCCURRENCES_EXPAND_WINDOW_QUEUE],
    deadLetter: OCCURRENCES_EXPAND_WINDOW_DEAD_QUEUE,
  });
  await boss.updateQueue(OCCURRENCES_EXPAND_WINDOW_QUEUE, {
    deadLetter: OCCURRENCES_EXPAND_WINDOW_DEAD_QUEUE,
  });
}

/** The owner's title, made safe for a lock screen: no controls, hard-capped. */
function alertSafeTitle(title: string): string {
  const stripped = stripUnsummarizableCharacters(title) ?? "";
  if (stripped.length === 0) return "A recurring task";
  return truncateField(stripped, ALERT_TITLE_MAX_CHARS).text;
}

/**
 * Dead-letter handler for occurrences.generate-lazy: runs only once pg-boss
 * has exhausted every retry of a successor generation.
 *
 * Idempotency is keyed on CURRENT durable state rather than on the payload,
 * mirroring capture.parse's dead-letter handler: a redelivered dead job, or one
 * whose task has since been dropped, archived, re-ruled, or repaired by hand,
 * must be a no-op rather than a second push. The one condition that means
 * "nothing is missing" is an open scheduled occurrence for the parent -- any
 * open occurrence, lazy or not, because a completion-anchored task never has
 * pre-expanded ones (expand-window filters on `due_date`), so an open row can
 * only be the initial one or a successor, and either way the user has
 * something to act on. Everything else is logged with a closed reason.
 *
 * ONE further attempt is made before anyone is alerted. Rule validity is
 * enforced at write time (TaskCreateSchema/TaskUpdateSchema refuse BY*, UNTIL
 * and COUNT on a completion-anchored rule, and every writer stores a
 * recurrence timezone alongside an rrule), so a rule this handler cannot
 * compute from is unreachable through the API or the parser. The realistic
 * way the primary queue exhausts its five backoff retries -- about eight
 * minutes end to end -- is a transient outage: a Postgres restart, or the
 * deployment rollout itself. By the time the dead job is delivered that outage
 * has usually healed, and an alert for a successor a single retry produces is
 * a misleading push followed by a task that silently never recurs again --
 * the outcome this queue exists to prevent. The attempt is idempotent for the
 * same reasons the primary handler is (one_open_occurrence_per_lazy_parent
 * and the (parent, occurs_at) unique index; a 23505 is success), and the dead
 * job carries the identical payload, so a persistent fault fails identically
 * and is then alerted with the outcome of that attempt in the log.
 *
 * The attempt's failure is caught, not rethrown: this handler is deliberately
 * uncontained (see queue-containment.test.ts), so a rethrow would persist the
 * raw error into the dead job's own `output`. What the dead queue's own retry
 * exists for is a failure of the handler's OWN work -- the state reads, the
 * dispatch-log check, `boss.send` -- and that path is left to throw, so a
 * transient fault there is redelivered rather than lost; the dead queue has no
 * dead letter of its own, so exhaustion THERE is terminal and logged only.
 */
export function createGenerateLazyOccurrenceDeadLetterHandler(db: Db, boss: PgBoss) {
  return async function handleGenerateLazyOccurrenceDead(
    jobs: Job<GenerateLazyOccurrenceJobData>[],
  ): Promise<void> {
    for (const job of jobs) {
      const { occurrenceId, fromStatus } = job.data;
      const skipped = (reason: string, extra: Record<string, string> = {}): void => {
        log.warn("occurrences.generate_lazy.dead_letter_skipped", {
          occurrenceId,
          fromStatus,
          reason,
          ...extra,
        });
      };

      const [occurrence] = await db
        .select()
        .from(occurrences)
        .where(eq(occurrences.id, occurrenceId));
      if (!occurrence) {
        skipped("occurrence_missing");
        continue;
      }
      if (occurrence.parentType !== "task") {
        skipped("not_task_occurrence");
        continue;
      }

      const [task] = await db.select().from(tasks).where(eq(tasks.id, occurrence.parentId));
      if (!task) {
        skipped("task_missing", { taskId: occurrence.parentId });
        continue;
      }
      // `done` is unreachable for a recurring task (POST /tasks/:id/complete
      // refuses it with 409), but a task in any closed state needs no successor,
      // so the guard names the set rather than the one member reachable today.
      if (task.archivedAt !== null || task.status === "dropped" || task.status === "done") {
        skipped("task_closed", { taskId: task.id, taskStatus: task.status });
        continue;
      }
      if (task.recurrenceAnchor !== "completion_date" || !task.rrule || !task.recurrenceTimezone) {
        skipped("not_completion_anchored", { taskId: task.id });
        continue;
      }

      const [open] = await db
        .select({ id: occurrences.id })
        .from(occurrences)
        .where(
          and(
            eq(occurrences.parentType, "task"),
            eq(occurrences.parentId, task.id),
            eq(occurrences.status, "scheduled"),
          ),
        )
        .limit(1);
      if (open) {
        // Late success, duplicate delivery, or a manual repair -- there is
        // nothing to tell the owner about.
        log.info("occurrences.generate_lazy.dead_letter_skipped", {
          occurrenceId,
          fromStatus,
          taskId: task.id,
          reason: "open_occurrence_exists",
          openOccurrenceId: open.id,
        });
        continue;
      }

      // The one further attempt. A non-throwing outcome means either an open
      // occurrence now exists (`generated` / `successor_exists`) or the state
      // moved under us and warrants none (`skipped`, already logged with its
      // reason by generateOne) -- neither is anything to alert about.
      let retryError: string;
      try {
        const outcome = await generateOne(db, job.data);
        log.info("occurrences.generate_lazy.dead_letter_recovered", {
          occurrenceId,
          fromStatus,
          taskId: task.id,
          outcome,
        });
        continue;
      } catch (err) {
        retryError = errorToken(err);
      }

      const { outcome, deviceCount } = await alertEligibleDevices(db, boss, {
        dedupeKey: `${OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE}:${occurrenceId}`,
        title: "Recurring task needs attention",
        // Says what happened and where to look, without prescribing an edit:
        // re-saving a completion-anchored task's rule does not seed an
        // occurrence (PATCH /tasks/:id only seeds on an anchor change), so
        // "fix the rule" would be advice that repairs nothing.
        body: `"${alertSafeTitle(task.title)}" was ${fromStatus}, but its next occurrence could not be scheduled, even after a retry. Open the task to review its repeat settings.`,
        // Ids only -- never the title (it is in the body, where the owner sees
        // it), never the rule, never error text.
        data: { occurrenceId, taskId: task.id },
      });
      log.warn("occurrences.generate_lazy.dead_lettered", {
        occurrenceId,
        fromStatus,
        taskId: task.id,
        retryError,
        alert: outcome,
        alertDevices: deviceCount,
      });
    }
  };
}

/**
 * The UTC calendar date of the DEAD job's own `created_on`, read from durable
 * job metadata.
 *
 * Deliberately NOT `sourceCreatedOn`. pg-boss 12.27.0 writes `source_name`,
 * `source_id`, `source_created_on` and `source_retry_count` in exactly one
 * place -- the dlq_jobs INSERT in `failJobsBody` -- and the retried_jobs
 * re-INSERT that runs when the DEAD job itself fails and is retried lists
 * `created_on` but none of the `source_*` columns. So a dead job that throws
 * once (a transient fault on the dispatch-log SELECT, say) comes back with
 * `sourceCreatedOn: null` and would have derived a DIFFERENT date from any
 * fallback, alerting twice for one failure and then silencing that night's
 * genuine one. `createdOn` is carried verbatim across the dead job's own
 * retries, so it is the only timestamp that is stable for the job's whole
 * life. It is stamped seconds after the last failed retry of a 03:00 UTC cron
 * with three one-minute retries, so it shares the source's UTC date unless the
 * chain was delayed by most of a day -- in which case a second bucket for what
 * is, in effect, a second night of failure is the honest answer.
 */
function failureDateDiscriminator(job: JobWithMetadata<object>): string {
  return job.createdOn.toISOString().slice(0, 10);
}

/** What the dead job's `output` -- the contained sweep error -- tells us. */
interface SweepFailureSummary {
  failedParents: number | null;
  totalParents: number | null;
  failedParentRefs: FailedParentRef[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Reads the counts and the bounded failed-parent list back out of the dead
 * job's `output`, which pg-boss copied from the exhausted source job (the
 * dlq_jobs CTE copies `r.output`), where it is the serialize-error form of the
 * `OccurrencesJobError` the sweep threw.
 *
 * Defensive on every field even though this process wrote it: the dead job's
 * `output` is REPLACED with the dead handler's own failure on a redelivery
 * (retried_jobs re-inserts `${output}`), so it may be absent or a different
 * error entirely, and a row in a self-pruning job table is data rather than a
 * contract. Ids are accepted only if uuid-shaped, so nothing that is not an
 * identifier can be re-logged from here whatever the row holds.
 */
function readSweepFailure(output: unknown): SweepFailureSummary {
  const summary: SweepFailureSummary = {
    failedParents: null,
    totalParents: null,
    failedParentRefs: [],
  };
  if (typeof output !== "object" || output === null) return summary;
  const record = output as Record<string, unknown>;
  const count = (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
  summary.failedParents = count(record["failedParents"]);
  summary.totalParents = count(record["totalParents"]);
  const refs = record["failedParentRefs"];
  if (Array.isArray(refs)) {
    for (const ref of refs.slice(0, FAILED_PARENT_REFS_MAX)) {
      if (typeof ref !== "object" || ref === null) continue;
      const { parentType, parentId } = ref as Record<string, unknown>;
      if ((parentType === "task" || parentType === "event") && typeof parentId === "string") {
        if (UUID.test(parentId)) summary.failedParentRefs.push({ parentType, parentId });
      }
    }
  }
  return summary;
}

/**
 * Dead-letter handler for occurrences.expand-window: runs only once pg-boss
 * has exhausted every retry of a nightly sweep.
 *
 * Registered with `includeMetadata: true` so the job carries its own durable
 * timestamp and the exhausted job's `output`; the handler needs nothing from
 * `data` (a cron job's payload is empty). There is no per-item state to repair
 * -- the sweep is idempotent and the next night's cron re-runs it in full --
 * so the work is to say so, once per night of failure, and to put the FAILED
 * PARENTS' ids somewhere that survives a container recreation: one log line
 * per failed parent at dead-letter time, keyed so they can be grepped as a set.
 * The per-parent warn lines the sweep itself wrote three retries earlier are
 * the same ids, but a worker log is exactly what 8.6C's recreation discarded,
 * and `job.output` deletes itself on pg-boss's retention.
 *
 * The body says how much of the sweep failed rather than that "schedules could
 * not be expanded": the per-parent containment (Checkpoint 9.0) means every
 * OTHER parent DID expand, and a persistent single-parent fault would
 * otherwise push an alarming, false, nightly "nothing works" indefinitely. When
 * exactly one parent failed and it is a task, `data.taskId` lets the existing
 * route resolver open it (apps/mobile's resolve-notification-route); an event
 * has no per-item route today, and with several parents there is nothing one
 * tap could open.
 */
export function createExpandDueDateWindowDeadLetterHandler(db: Db, boss: PgBoss) {
  return async function handleExpandDueDateWindowDead(
    jobs: JobWithMetadata<object>[],
  ): Promise<void> {
    for (const job of jobs) {
      const failureDate = failureDateDiscriminator(job);
      const sweep = readSweepFailure(job.output);
      for (const ref of sweep.failedParentRefs) {
        log.warn("occurrences.expand_window.dead_letter_parent", {
          failureDate,
          parentType: ref.parentType,
          parentId: ref.parentId,
        });
      }

      const counted = sweep.failedParents !== null && sweep.totalParents !== null;
      // "expanded or repaired": since Checkpoint 9.4 the sweep's second phase
      // reconciles completion-anchored parents left with no open occurrence,
      // and those failures arrive here in the same counts, so the wording
      // covers both without naming either strategy to the owner.
      const body = counted
        ? `${sweep.failedParents} of ${sweep.totalParents} recurring items could not be expanded or repaired overnight. Today and Agenda may be missing their next occurrence.`
        : "Some recurring items could not be expanded or repaired overnight. Today and Agenda may be missing their next occurrence.";
      const single = sweep.failedParentRefs.length === 1 ? sweep.failedParentRefs[0] : undefined;
      const data: Record<string, string> = { queue: OCCURRENCES_EXPAND_WINDOW_QUEUE, failureDate };
      if (single !== undefined && single.parentType === "task" && sweep.failedParents === 1) {
        data["taskId"] = single.parentId;
      }

      const { outcome, deviceCount } = await alertEligibleDevices(db, boss, {
        dedupeKey: `${OCCURRENCES_EXPAND_WINDOW_DEAD_QUEUE}:${failureDate}`,
        title: "Recurring schedules need attention",
        body,
        data,
      });
      log.warn("occurrences.expand_window.dead_lettered", {
        failureDate,
        // Best-effort provenance: both are null on a redelivery of the dead
        // job (see failureDateDiscriminator), which is why neither is part of
        // the key.
        sourceJobId: job.sourceId ?? undefined,
        sourceRetryCount: job.sourceRetryCount ?? undefined,
        failedParents: sweep.failedParents ?? undefined,
        totalParents: sweep.totalParents ?? undefined,
        alert: outcome,
        alertDevices: deviceCount,
      });
    }
  };
}
