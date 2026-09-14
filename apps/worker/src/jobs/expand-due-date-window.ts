import {
  buildEventRecurrenceRule,
  computeNextLazyOccurrence,
  expandDueDateWindow,
  resolveSeriesAnchor,
  toWallClockComponents,
  wallClockToNaiveDate,
  wallTimeOfNaiveTimestamp,
  type DueDateRecurrenceRule,
} from "@personal-os/core";
import { events, occurrences, tasks, type Db } from "@personal-os/db";
import { and, desc, eq, exists, inArray, isNotNull, isNull, min, ne, notExists } from "drizzle-orm";
import type { Job } from "pg-boss";
import { errorToken, log } from "../logger.js";
import { OCCURRENCES_EXPAND_WINDOW_QUEUE } from "../queue-names.js";
import { LazySuccessorCollisionError } from "./generate-lazy-occurrence.js";
import {
  OccurrencesJobError,
  withOccurrencesJobErrorContainment,
  type FailedParentRef,
} from "./occurrences-job-error.js";

// Rolling window per docs/ARCHITECTURE.md: "Never materialize infinite
// rows. Expand a rolling 90-day window into occurrences."
const WINDOW_DAYS = 90;

function buildRule(params: {
  rrule: string;
  recurrenceTimezone: string;
  anchorInstant: Date;
  recurrenceUntil: Date | null;
  recurrenceCount: number | null;
  recurrenceExdates: string[] | null;
}): DueDateRecurrenceRule {
  return {
    rrule: params.rrule,
    recurrenceTimezone: params.recurrenceTimezone,
    // Recomputed fresh from the real instant + zone rather than trusting a
    // possibly-stale due_local/start_local column -- always correct,
    // regardless of whether that column was populated at write time.
    dtstart: toWallClockComponents(params.anchorInstant, params.recurrenceTimezone),
    recurrenceUntil: params.recurrenceUntil ?? undefined,
    recurrenceCount: params.recurrenceCount ?? undefined,
    recurrenceExdates: params.recurrenceExdates ?? undefined,
  };
}

async function earliestOccurrenceOf(db: Db, taskId: string): Promise<Date | null> {
  const [row] = await db
    .select({ earliest: min(occurrences.occursAt) })
    .from(occurrences)
    .where(and(eq(occurrences.parentType, "task"), eq(occurrences.parentId, taskId)));
  return row?.earliest ?? null;
}

async function upsertOccurrences(
  db: Db,
  parentType: "task" | "event",
  parentId: string,
  generated: { occursAt: Date; occursLocal: ReturnType<typeof toWallClockComponents> }[],
): Promise<void> {
  for (const occurrence of generated) {
    await db
      .insert(occurrences)
      .values({
        parentType,
        parentId,
        occursAt: occurrence.occursAt,
        occursLocal: wallClockToNaiveDate(occurrence.occursLocal),
        status: "scheduled",
        lazyGenerated: false,
      })
      .onConflictDoNothing({
        target: [occurrences.parentType, occurrences.parentId, occurrences.occursAt],
      });
  }
}

// Nightly cron. The `recurrenceAnchor = 'due_date'` filter on tasks is the
// single most important line in this job -- completion_date-anchored rules
// must never be pre-expanded (see docs/ARCHITECTURE.md's recurrence design
// section: "the window expansion job must filter these out entirely").
// Events have no recurrence_anchor column at all; a recurring event is
// always due-date-style.
//
// `status != 'dropped'` and `archived_at is null` (Phase 2): before Phase 2
// nothing could ever change a task's status or archive it, so this filter
// didn't exist and was never needed. POST /tasks/:id/drop and
// POST /tasks/:id/archive are the first code paths that can -- without this,
// the cron would keep silently regenerating occurrences for a task the user
// just dropped or archived. 'done' is unreachable for a recurring task in
// Phase 2 (POST /tasks/:id/complete rejects those with 409), so the status
// half of this only needs to exclude 'dropped'.
//
// `archived_at is null` on events (Checkpoint 4.1): mirrors the same fix for
// events now that they have their own archive axis -- without it, the cron
// would keep silently regenerating occurrences for an archived recurring
// event. Events have no status/drop concept, so this is the only filter
// needed on top of `isNotNull(events.rrule)`.
export async function expandDueDateWindowJob(db: Db): Promise<void> {
  const now = new Date();

  // PER-PARENT CONTAINMENT (Checkpoint 9.0).
  //
  // The two loops below used to run bare, so one parent whose rule could not be
  // expanded -- a corrupt RRULE, an exdate the library rejects, a timezone Intl
  // no longer knows -- threw out of the whole job, and every parent AFTER it in
  // iteration order was silently not expanded that night. pg-boss then retried
  // the identical sweep three times, hit the identical parent, and gave up with
  // no dead-letter queue to give up INTO; the nightly cron re-ran it the next
  // night and the same parent stopped it again. A persistent per-item fault
  // was therefore invisible forever while degrading every other recurring
  // item, which is the exact opposite of the isolation a sweep should have.
  //
  // Now each parent is attempted independently. A failure is recorded (ids and
  // an error token only -- never the rule text the underlying error message
  // interpolates) and the sweep continues. The job still FAILS at the end when
  // anything failed, on purpose: a retry re-runs the idempotent sweep (every
  // insert is ON CONFLICT DO NOTHING), a transient fault heals, and a
  // persistent one exhausts the retries and reaches
  // occurrences.expand-window.dead, which alerts. The thrown error carries
  // counts and a bounded list of failed parent IDS only, so pgboss.job.output
  // names the parent an operator must look at without ever holding a raw
  // message.
  const failures: FailedParentRef[] = [];
  let attempted = 0;
  // due_date tasks with neither a due_at nor any occurrence to anchor on.
  let unanchored = 0;

  const dueDateTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.recurrenceAnchor, "due_date"),
        isNotNull(tasks.rrule),
        ne(tasks.status, "dropped"),
        isNull(tasks.archivedAt),
      ),
    );

  for (const task of dueDateTasks) {
    if (!task.rrule || !task.recurrenceTimezone) continue;
    attempted += 1;
    try {
      // A due_date series with no due_at (Checkpoint 9.3 review). Both
      // POST /tasks and the capture commit materialize such a series at
      // creation, anchoring the rule at the creation instant -- but this job
      // used to skip any due_date task without a due_at, so the series was
      // expanded exactly once and never again: after 90 days it simply
      // stopped. The anchor the creator used is not stored anywhere, but its
      // consequence is -- the earliest occurrence the series has ever had is
      // the first instance of that anchored rule (the seed already truncated
      // to seconds, which is what the wall-clock anchor drops), so anchoring
      // on min(occurs_at) reproduces the identical instants for the
      // overlapping window (ON CONFLICT DO NOTHING absorbs them) and continues
      // the series beyond it. NOT created_at: it differs from the seed by the
      // milliseconds the wall clock dropped and by the commit's own latency,
      // and a rule anchored a few hundred milliseconds off would generate a
      // second, parallel set of instants alongside every existing one.
      // A series with no occurrence at all (a row written before the
      // creation-time materialization existed) still has no anchor and is
      // still skipped -- there is nothing to anchor on.
      //
      // Checkpoint 9.4: the precedence itself -- due_at, then the earliest
      // occurrence, then now -- is `resolveSeriesAnchor`, shared with PATCH
      // /tasks/:id, POST /tasks and the capture commit so no two writers can
      // anchor one series differently again. Its `now` fallback is deliberately
      // NOT taken here: a sweep that re-anchored an unanchored series on the
      // night it happened to run would mint instants nothing else agrees on,
      // so the skip is decided BEFORE the helper is consulted. The earliest
      // occurrence is only read when due_at is null, since the helper never
      // looks past a present due_at.
      const earliestOccursAt = task.dueAt ? null : await earliestOccurrenceOf(db, task.id);
      if (!task.dueAt && !earliestOccursAt) {
        unanchored += 1;
        continue;
      }
      const anchorInstant = resolveSeriesAnchor({ dueAt: task.dueAt, earliestOccursAt, now });
      const rule = buildRule({
        rrule: task.rrule,
        recurrenceTimezone: task.recurrenceTimezone,
        anchorInstant,
        recurrenceUntil: task.recurrenceUntil,
        recurrenceCount: task.recurrenceCount,
        recurrenceExdates: task.recurrenceExdates,
      });
      const generated = expandDueDateWindow(rule, WINDOW_DAYS, now);
      await upsertOccurrences(db, "task", task.id, generated);
    } catch (err) {
      failures.push({ parentType: "task", parentId: task.id });
      log.warn("occurrences.expand_window.parent_failed", {
        parentType: "task",
        parentId: task.id,
        error: errorToken(err),
      });
    }
  }

  const recurringEvents = await db
    .select()
    .from(events)
    .where(and(isNotNull(events.rrule), isNull(events.archivedAt)));

  for (const event of recurringEvents) {
    attempted += 1;
    try {
      // Canonical shared builder (packages/core/src/recurrence/event-recurrence.ts)
      // -- handles both timed events (dtstart from starts_at, byte-identical to
      // the previous local buildRule usage) and all-day events (dtstart anchored
      // at local noon on start_date, since EventCreateSchema forces all-day rows
      // to have starts_at NULL / start_date set). Returns null when the row
      // can't yet produce a rule (e.g. all-day with no start_date), which is the
      // only skip condition now -- no more blanket `!event.startsAt` guard that
      // silently dropped every all-day recurring series.
      const rule = buildEventRecurrenceRule({
        rrule: event.rrule,
        recurrenceTimezone: event.recurrenceTimezone,
        allDay: event.allDay,
        startsAt: event.startsAt,
        startDate: event.startDate,
        recurrenceUntil: event.recurrenceUntil,
        recurrenceCount: event.recurrenceCount,
        recurrenceExdates: event.recurrenceExdates,
      });
      if (!rule) continue;
      const generated = expandDueDateWindow(rule, WINDOW_DAYS, now);
      await upsertOccurrences(db, "event", event.id, generated);
    } catch (err) {
      failures.push({ parentType: "event", parentId: event.id });
      log.warn("occurrences.expand_window.parent_failed", {
        parentType: "event",
        parentId: event.id,
        error: errorToken(err),
      });
    }
  }

  // One summary line per sweep, whatever the outcome, so "did it run and how
  // much of it worked" is answerable from the log without counting rows.
  log.info("occurrences.expand_window.completed", {
    tasks: dueDateTasks.length,
    events: recurringEvents.length,
    attempted,
    unanchored,
    failed: failures.length,
  });

  const lazy = await reconcileLazyParents(db, failures, now);

  if (failures.length > 0) {
    throw new OccurrencesJobError(OCCURRENCES_EXPAND_WINDOW_QUEUE, null, {
      failed: failures,
      // Both phases' parents, so "N of M parents failed" in job.output stays
      // an honest fraction of everything the sweep attempted.
      totalParents: attempted + lazy.candidates,
    });
  }
}

/**
 * PHASE 2 -- lazy reconciliation (Checkpoint 9.4).
 *
 * A completion-anchored task is supposed to hold exactly one open occurrence
 * at all times (docs/ARCHITECTURE.md). Since 9.3 the API inserts the successor
 * in the same transaction as the completion, and generate-lazy re-checks it,
 * so the invariant is kept on every path that RUNS -- but not on the ones that
 * do not: a successor computation that failed under the API's savepoint and
 * then exhausted generate-lazy's retries (dead-lettered and alerted, never
 * repaired); a completion recorded while pg-boss was unreachable at the API
 * (the `bossReady` debt in docs/STATUS.md -- no job exists for any queue to
 * see); an occurrence closed by hand. Each leaves a task with a terminal
 * history and nothing open, which the rest of the system reads as "never
 * recurs again", silently. This pass is the nightly repair for that state:
 * the successor the completion should have produced, computed from the SAME
 * inputs the two on-line writers use -- the latest terminal row's
 * `completed_at` for the date, its `occurs_local` time of day for the
 * wall clock, the parent's rule and zone -- so a row the API or the worker
 * did manage to write at that instant is the no-op the unique index makes it.
 *
 * It is a REPAIR, not a second generation strategy: it never touches a parent
 * that already has any open occurrence, and it never invents a start for a
 * parent with no terminal history (a lazy task with no history and no open
 * row is one whose seed was never written -- a different fault, and one this
 * pass has no instant to anchor from). `inbox` counts as open, as it does for
 * every other reader of task status; `dropped`, `done` and archived parents
 * recur no further, matching phase 1 and generate-lazy's `parent_closed`.
 *
 * Containment is per parent, exactly as in phase 1: a failure is counted, its
 * id recorded, the token logged, and the sweep continues; the failures join
 * the same `OccurrencesJobError`, so a persistent fault reaches
 * occurrences.expand-window.dead and alerts through the existing handler. A
 * successor the unique index refuses while the parent still has nothing open
 * is a failure too (9.4 review), not a quiet "nothing to do" -- the parent is
 * exactly as stuck as before the pass ran. A rerun is idempotent -- a repaired
 * parent has an open occurrence and is no longer a candidate.
 */
async function reconcileLazyParents(
  db: Db,
  failures: FailedParentRef[],
  now: Date,
): Promise<{ candidates: number; repaired: number; failed: number }> {
  const openOccurrence = db
    .select({ id: occurrences.id })
    .from(occurrences)
    .where(
      and(
        eq(occurrences.parentType, "task"),
        eq(occurrences.parentId, tasks.id),
        eq(occurrences.status, "scheduled"),
      ),
    );
  const terminalHistory = db
    .select({ id: occurrences.id })
    .from(occurrences)
    .where(
      and(
        eq(occurrences.parentType, "task"),
        eq(occurrences.parentId, tasks.id),
        inArray(occurrences.status, ["done", "skipped"]),
        isNotNull(occurrences.completedAt),
      ),
    );
  const candidates = await db
    .select({
      id: tasks.id,
      rrule: tasks.rrule,
      recurrenceTimezone: tasks.recurrenceTimezone,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.recurrenceAnchor, "completion_date"),
        isNotNull(tasks.rrule),
        isNotNull(tasks.recurrenceTimezone),
        inArray(tasks.status, ["inbox", "active"]),
        isNull(tasks.archivedAt),
        notExists(openOccurrence),
        exists(terminalHistory),
      ),
    );

  let repaired = 0;
  let failed = 0;
  for (const task of candidates) {
    if (!task.rrule || !task.recurrenceTimezone) continue;
    try {
      // The latest terminal row by completion instant -- not by occurs_at,
      // since a late completion of an older occurrence is still the most
      // recent thing the owner did with this task, and completion anchoring
      // means the next one is due relative to THAT.
      const [latest] = await db
        .select({
          id: occurrences.id,
          status: occurrences.status,
          completedAt: occurrences.completedAt,
          occursAt: occurrences.occursAt,
          occursLocal: occurrences.occursLocal,
        })
        .from(occurrences)
        .where(
          and(
            eq(occurrences.parentType, "task"),
            eq(occurrences.parentId, task.id),
            inArray(occurrences.status, ["done", "skipped"]),
            isNotNull(occurrences.completedAt),
          ),
        )
        .orderBy(desc(occurrences.completedAt), desc(occurrences.occursAt))
        .limit(1);
      // Selected by the same predicate as the candidate query; absent only if
      // the row went away between the two reads, in which case there is no
      // longer anything to repair from.
      if (!latest || !latest.completedAt) continue;

      // The same three inputs the API and generate-lazy pass: the completion
      // instant for the date, the closed row's own time of day for the wall
      // clock, and its own occurs_at as the exclusive lower bound so an
      // early completion still yields a successor strictly after it (9.4
      // review) -- identical inputs, identical instant, one row.
      const next = computeNextLazyOccurrence(
        { rrule: task.rrule, recurrenceTimezone: task.recurrenceTimezone },
        latest.completedAt,
        latest.status === "done" ? "completed" : "skipped",
        { wallTime: wallTimeOfNaiveTimestamp(latest.occursLocal), after: latest.occursAt },
      );
      // No conflict target, so BOTH unique indexes make this a no-op: an open
      // lazy row written between the candidate read and here (a completion
      // committing under the sweep) and a row already sitting at this instant.
      const inserted = await db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: task.id,
          occursAt: next.occursAt,
          occursLocal: wallClockToNaiveDate(next.occursLocal),
          status: "scheduled",
          lazyGenerated: true,
        })
        .onConflictDoNothing()
        .returning({ id: occurrences.id });
      if (inserted.length > 0) {
        repaired += 1;
        log.info("occurrences.reconcile_lazy.repaired", {
          taskId: task.id,
          occurrenceId: inserted[0]!.id,
          // Whether the repaired successor is already in the past -- true
          // whenever the completion it anchors from is older than the rule's
          // interval, which for a nightly repair of a days-old gap it usually
          // is. A flag, so an operator can tell "caught up, now overdue" from
          // "caught up, still ahead" without reading the row.
          overdue: next.occursAt.getTime() < now.getTime(),
        });
        continue;
      }
      // Nothing inserted. ON CONFLICT DO NOTHING covers two indexes, and only
      // one of them means the parent is now fine: a scheduled lazy row landed
      // between the candidate read and the insert (the partial index), which
      // is the repair having happened under the sweep. The other -- a done or
      // skipped row already at the computed instant (the parent/occurs_at
      // key) -- means the parent STILL has nothing open and the sweep has
      // just declined to change that. Before the 9.4 review both counted as
      // "not repaired, not failed", so the job completed with
      // `repaired:0 failed:0` and the dead-letter/alert path never fired for
      // a parent it exists for. Re-read the state and count the second case
      // as a failure, so the job throws and the alert is honest.
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
        log.info("occurrences.reconcile_lazy.skipped", {
          taskId: task.id,
          reason: "successor_exists",
          openOccurrenceId: open.id,
        });
        continue;
      }
      throw new LazySuccessorCollisionError(task.id, latest.id);
    } catch (err) {
      failed += 1;
      failures.push({ parentType: "task", parentId: task.id });
      log.warn("occurrences.reconcile_lazy.parent_failed", {
        parentType: "task",
        parentId: task.id,
        reason: err instanceof LazySuccessorCollisionError ? "collision" : "error",
        error: errorToken(err),
      });
    }
  }

  // Counts only -- the per-parent lines above carry the ids. Named with the
  // logger's token grammar (a hyphen is redacted as a non-token event name),
  // mirroring occurrences.expand_window.completed.
  log.info("occurrences.reconcile_lazy.completed", {
    candidates: candidates.length,
    repaired,
    failed,
  });
  return { candidates: candidates.length, repaired, failed };
}

/**
 * The pg-boss registration for the nightly sweep (Checkpoint 9.0).
 *
 * A factory rather than the inline arrow index.ts used to register, so the
 * containment guard (queue-containment.test.ts) can resolve it and see the
 * wrapper. The wrapper adds nothing on the counts-only path -- an
 * `OccurrencesJobError` passes through it unchanged -- and matters for the
 * one thing the per-parent loop cannot contain: the two parent SELECTs
 * themselves, whose failure would otherwise persist a raw `pg` error.
 */
export function createExpandDueDateWindowHandler(db: Db): (jobs: Job[]) => Promise<void> {
  // No explicit type argument on the wrapper call: the containment guard
  // matches the wrapper's call expression textually, so `<Job>` between the
  // name and the paren would hide a real wrapper from it.
  return withOccurrencesJobErrorContainment(OCCURRENCES_EXPAND_WINDOW_QUEUE, async () => {
    await expandDueDateWindowJob(db);
  });
}
