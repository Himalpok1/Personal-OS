import {
  buildEventRecurrenceRule,
  expandDueDateWindow,
  toWallClockComponents,
  wallClockToNaiveDate,
  type DueDateRecurrenceRule,
} from "@personal-os/core";
import { events, occurrences, tasks, type Db } from "@personal-os/db";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { Job } from "pg-boss";
import { errorToken, log } from "../logger.js";
import { OCCURRENCES_EXPAND_WINDOW_QUEUE } from "../queue-names.js";
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
    if (!task.rrule || !task.recurrenceTimezone || !task.dueAt) continue;
    attempted += 1;
    try {
      const rule = buildRule({
        rrule: task.rrule,
        recurrenceTimezone: task.recurrenceTimezone,
        anchorInstant: task.dueAt,
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
    failed: failures.length,
  });

  if (failures.length > 0) {
    throw new OccurrencesJobError(OCCURRENCES_EXPAND_WINDOW_QUEUE, null, {
      failed: failures,
      totalParents: attempted,
    });
  }
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
