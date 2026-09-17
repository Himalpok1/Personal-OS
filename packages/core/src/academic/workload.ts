// The academic workload view (Checkpoint 10.3, Lane A): how much is due on
// each of the next local days, and how many points ride on it.
//
// Built on the SAME local-day primitives the Today buckets use
// (`localDayWindow` / `localDayWindowForDate` / `addCalendarDays`), so a
// day's entry here and `due_today` / `due_this_week` over there can never
// disagree about which local day an instant belongs to -- including across
// a DST transition, where a local day is 23 or 25 hours long.
//
// THE PER-DAY RULE, EXACTLY:
//   days[i].due_total    = count of OPEN, DATED assignments whose due_at lies
//                          inside local day i's window [start_i, start_{i+1})
//   days[i].points_total = Σ points_possible over those same rows (null → 0)
//   days[0] is today; days[1..N] are the N local days after it (N is the
//   caller's upcoming day count, 7 for the Today card, so 8 entries).
//
// Consequences, all deliberate and reported rather than hidden:
//   - an item due EARLIER TODAY (already overdue) still falls inside today's
//     window, so it lands in days[0] -- today's entry is "everything due on
//     this calendar day", not "everything still ahead";
//   - an item overdue from an EARLIER day is on no entry at all -- earlier
//     days are not represented. The read model reports `overdue_total`
//     separately for exactly this reason: a client wanting "still ahead
//     today" subtracts the overdue-earlier-today rows itself, never guesses.
//
// `pointsAtStake` is a different window on purpose: Σ points_possible over
// OPEN assignments due from effectiveNow (inclusive) up to the horizon end
// (exclusive), null points counting 0 -- the due_today ∪ due_this_week set.
// Overdue points are NOT "at stake" here (they are past due; `overdue_total`
// counts them), and neither is anything beyond the horizon.
//
// Pure: no clock, no I/O. The caller supplies its one effectiveNow.
import { addCalendarDays, localDayWindow, localDayWindowForDate } from "../actionability.js";
import { DEFAULT_ACADEMIC_UPCOMING_DAY_COUNT } from "./buckets.js";

/** The minimal shape an assignment must expose to be counted. */
export interface AcademicWorkloadCandidate {
  dueAt: Date | null;
  open: boolean;
  pointsPossible: number | null;
}

export interface AcademicWorkloadDay {
  /** The local calendar date, YYYY-MM-DD, in the caller's zone. */
  date: string;
  dueTotal: number;
  pointsTotal: number;
}

export interface AcademicWorkloadDaysParams<T extends AcademicWorkloadCandidate> {
  assignments: readonly T[];
  effectiveNow: Date;
  tz: string;
  /** Local days AFTER today to include; defaults to the Today card's 7. */
  upcomingDayCount?: number;
}

/**
 * Today plus the following `upcomingDayCount` local days, in order, one entry
 * per day, zero-filled -- see the module comment for the exact per-day rule.
 */
export function academicWorkloadDays<T extends AcademicWorkloadCandidate>(
  params: AcademicWorkloadDaysParams<T>,
): AcademicWorkloadDay[] {
  const { assignments, effectiveNow, tz } = params;
  const dayCount = (params.upcomingDayCount ?? DEFAULT_ACADEMIC_UPCOMING_DAY_COUNT) + 1;
  const today = localDayWindow(tz, effectiveNow);

  // Window boundaries for days 0..N, each from the same primitive the
  // buckets use; boundary i+1 is the exclusive end of day i.
  const starts: number[] = [today.startUtc.getTime()];
  const days: AcademicWorkloadDay[] = [];
  for (let i = 0; i < dayCount; i += 1) {
    const window = i === 0 ? today : localDayWindowForDate(tz, addCalendarDays(today.localDate, i));
    starts.push(window.endUtcExclusive.getTime());
    days.push({ date: window.localDate, dueTotal: 0, pointsTotal: 0 });
  }

  for (const assignment of assignments) {
    if (!assignment.open || assignment.dueAt === null) continue;
    const dueMs = assignment.dueAt.getTime();
    if (dueMs < starts[0]! || dueMs >= starts[dayCount]!) continue;
    // Linear over at most a handful of days; a binary search would buy
    // nothing at this size and would obscure the boundary rule.
    for (let i = 0; i < dayCount; i += 1) {
      if (dueMs >= starts[i]! && dueMs < starts[i + 1]!) {
        const day = days[i]!;
        day.dueTotal += 1;
        day.pointsTotal += assignment.pointsPossible ?? 0;
        break;
      }
    }
  }
  return days;
}

/**
 * Σ points_possible over OPEN assignments with effectiveNow ≤ due_at <
 * horizonEndUtc, null points counting 0 -- see the module comment.
 */
export function academicPointsAtStake<T extends AcademicWorkloadCandidate>(
  assignments: readonly T[],
  effectiveNow: Date,
  horizonEndUtc: Date,
): number {
  const nowMs = effectiveNow.getTime();
  const horizonMs = horizonEndUtc.getTime();
  let total = 0;
  for (const assignment of assignments) {
    if (!assignment.open || assignment.dueAt === null) continue;
    const dueMs = assignment.dueAt.getTime();
    if (dueMs < nowMs || dueMs >= horizonMs) continue;
    total += assignment.pointsPossible ?? 0;
  }
  return total;
}
