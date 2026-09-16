// Academic Today bucketing (Checkpoint 10.2, ADR-070).
//
// Frozen semantics, mirroring docs/ARCHITECTURE.md "Today & agenda read
// models" rules 1-3 exactly and using the SAME primitives
// apps/api/src/read-models/today.ts builds its own windows from
// (`localDayWindow` / `localDayWindowForDate` / `addCalendarDays`), so the
// academic Today and the task Today can never disagree about which local day
// an instant belongs to -- including across a DST transition.
//
//   overdue       ⟺ open ∧ due_at < effectiveNow            (instant comparison)
//   due_today     ⟺ open ∧ start(today) ≤ due_at < start(tomorrow) ∧ ¬overdue
//   due_this_week ⟺ open ∧ start(tomorrow) ≤ due_at < start(today + N + 1)
//                   where N = upcomingDayCount (the 7 local days AFTER today)
//
// Precedence is overdue > due_today > due_this_week: an item due earlier
// today is overdue, never due_today. Only OPEN assignments are bucketed and a
// null due_at is never bucketed -- unlike a task, an undated assignment is
// not "actionable today" (Canvas assignments without a due date are
// typically ungraded practice or long-running participation items).
//
// Pure: no clock, no database. The caller supplies its one effectiveNow.
import { addCalendarDays, localDayWindow, localDayWindowForDate } from "../actionability.js";
import type { LocalDayWindow } from "../actionability.js";

/** Mirrors ACADEMIC_UPCOMING_DAY_COUNT in packages/schema; the API passes the schema constant explicitly. */
export const DEFAULT_ACADEMIC_UPCOMING_DAY_COUNT = 7;

/** The minimal shape an assignment must expose to be bucketed. */
export interface AcademicBucketCandidate {
  id: string;
  title: string;
  dueAt: Date | null;
  open: boolean;
}

export interface AcademicTodayWindows {
  /** The local day containing effectiveNow. */
  today: LocalDayWindow;
  /** End-exclusive bound of the last upcoming day (== start of today + N + 1). */
  horizonEndUtc: Date;
}

/**
 * The two boundaries every academic Today section is computed against. Split
 * out so the read model can report `local_date` from the very same window
 * the buckets used, rather than re-deriving it.
 */
export function academicTodayWindows(
  tz: string,
  effectiveNow: Date,
  upcomingDayCount: number = DEFAULT_ACADEMIC_UPCOMING_DAY_COUNT,
): AcademicTodayWindows {
  const today = localDayWindow(tz, effectiveNow);
  const horizonEndUtc = localDayWindowForDate(
    tz,
    addCalendarDays(today.localDate, upcomingDayCount),
  ).endUtcExclusive;
  return { today, horizonEndUtc };
}

export interface AcademicBuckets<T> {
  overdue: T[];
  dueToday: T[];
  dueThisWeek: T[];
}

export interface BucketAcademicAssignmentsParams<T extends AcademicBucketCandidate> {
  assignments: readonly T[];
  effectiveNow: Date;
  tz: string;
  upcomingDayCount?: number;
}

function compareByDueTitleId<T extends AcademicBucketCandidate>(a: T, b: T): number {
  // Every candidate in a bucket has a non-null dueAt by construction; the
  // null guard keeps the comparator total should a caller reuse it.
  const aMs = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bMs = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aMs !== bMs) return aMs < bMs ? -1 : 1;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Places every OPEN, DATED assignment into at most one of the three buckets
 * (see the module comment for the exact predicates) and sorts each bucket by
 * `due_at` ascending, then title, then id, so identical inputs yield
 * byte-identical output. Anything closed, undated, or due beyond the horizon
 * is left out entirely.
 */
export function bucketAcademicAssignments<T extends AcademicBucketCandidate>(
  params: BucketAcademicAssignmentsParams<T>,
): AcademicBuckets<T> {
  const { assignments, effectiveNow, tz } = params;
  const { today, horizonEndUtc } = academicTodayWindows(
    tz,
    effectiveNow,
    params.upcomingDayCount ?? DEFAULT_ACADEMIC_UPCOMING_DAY_COUNT,
  );
  const nowMs = effectiveNow.getTime();
  const todayStartMs = today.startUtc.getTime();
  const todayEndMs = today.endUtcExclusive.getTime();
  const horizonMs = horizonEndUtc.getTime();

  const overdue: T[] = [];
  const dueToday: T[] = [];
  const dueThisWeek: T[] = [];

  for (const assignment of assignments) {
    if (!assignment.open || assignment.dueAt === null) continue;
    const dueMs = assignment.dueAt.getTime();
    if (dueMs < nowMs) {
      overdue.push(assignment);
      continue;
    }
    if (dueMs >= todayStartMs && dueMs < todayEndMs) {
      dueToday.push(assignment);
      continue;
    }
    // Not overdue and not today, so dueMs >= todayEndMs (effectiveNow lies
    // inside today's window); the horizon is the only remaining bound.
    if (dueMs < horizonMs) {
      dueThisWeek.push(assignment);
    }
  }

  overdue.sort(compareByDueTitleId);
  dueToday.sort(compareByDueTitleId);
  dueThisWeek.sort(compareByDueTitleId);
  return { overdue, dueToday, dueThisWeek };
}
