import {
  expandDueDateWindow,
  toWallClockComponents,
  wallClockToNaiveDate,
  type DueDateRecurrenceRule,
} from "@personal-os/core";
import { events, occurrences, tasks, type Db } from "@personal-os/db";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";

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
  }

  const recurringEvents = await db
    .select()
    .from(events)
    .where(and(isNotNull(events.rrule), isNull(events.archivedAt)));

  for (const event of recurringEvents) {
    if (!event.rrule || !event.recurrenceTimezone || !event.startsAt) continue;
    const rule = buildRule({
      rrule: event.rrule,
      recurrenceTimezone: event.recurrenceTimezone,
      anchorInstant: event.startsAt,
      recurrenceUntil: event.recurrenceUntil,
      recurrenceCount: event.recurrenceCount,
      recurrenceExdates: event.recurrenceExdates,
    });
    const generated = expandDueDateWindow(rule, WINDOW_DAYS, now);
    await upsertOccurrences(db, "event", event.id, generated);
  }
}
