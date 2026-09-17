// Academic urgency, priority scoring and the two status derivations
// (Checkpoint 10.3, Lane A) -- DETERMINISTIC, SERVER-COMPUTED, EXPLAINABLE.
//
// Everything here is a total function of its arguments: no clock read (the
// caller passes the build's one `effectiveNow`), no database, no provider
// client, no Node builtin -- this module ships to the Expo bundle through
// the `./academic/*` subpath like its siblings and is never re-exported from
// core's root barrel.
//
// ===========================================================================
// URGENCY IS A LADDER OVER THE SAME BOUNDARIES THE TODAY BUCKETS USE
// ===========================================================================
//
//   critical  ⟺ due_at < effectiveNow                       (overdue; rule 2)
//   high      ⟺ due_at - effectiveNow < URGENCY_HIGH_WINDOW_HOURS (24h)
//   medium    ⟺ due_at < horizonEndUtc   (the SAME end-of-local-day + 7 that
//                                          `academicTodayWindows` computes for
//                                          `due_this_week`)
//   low       ⟺ otherwise
//   null      ⟺ due_at is null            (undated is never urgent)
//
// The first three are instant comparisons; only the horizon end is
// local-day based, and it arrives pre-computed from `academicTodayWindows`
// so this function cannot disagree with the buckets about where "this week"
// ends -- including across a DST transition.
//
// ===========================================================================
// PRIORITY IS AN EXPLAINABLE INTEGER SCORE OVER A CLOSED VOCABULARY
// ===========================================================================
//
// The search read model's rule (packages/core/src/search/score.ts, ADR-065):
// integer points, a closed reason vocabulary, one frozen table, so a client
// can explain any ranking from the response alone and a future weight change
// is a diff to ONE table rather than to a formula.
//
//   score = ACADEMIC_URGENCY_BASE_POINTS[urgency]
//         + Σ ACADEMIC_PRIORITY_POINTS[reason] over the ADDITIVE reasons
//
//   urgency base   critical 400   high 300   medium 200   low 100
//   urgency reason critical → `overdue`, high → `due_within_24h`,
//                  medium → `due_this_week`; low carries NO reason ("not
//                  urgent" is not a reason, and its 100 base is what keeps a
//                  low item above nothing at all)
//   additive       `marked_missing` +50   (Canvas's own `missing` flag)
//                  `marked_late`    +25   (Canvas's own `late` flag)
//                  `high_points`    +25   (points_possible ≥ HIGH_POINTS_THRESHOLD)
//
// A priority item carries `urgency`, `score` and `reasons` on the wire, so
// the equation above is recomputable by hand from the row itself: the
// urgency names the base, the reasons name the extras. `hours_until_due` is
// part of the scoring INPUT shape (so a finer time-based rung is a table
// change, not a signature change) but contributes no points today.
//
// ===========================================================================
// THE TWO STATUSES ARE DELIBERATELY SIMPLE
// ===========================================================================
//
//   workload   behind   ⟺ overdue_total > 0 ∨ missing_total > 0
//              at_risk  ⟺ otherwise, due_within_24h_total > 0
//              on_track ⟺ otherwise
//
//   attention  high     ⟺ overdue_total > 0 ∨ due_within_24h_total > 0
//              medium   ⟺ otherwise, due_this_week_total > 0
//              low      ⟺ otherwise, open_total > 0
//              none     ⟺ otherwise
//
// Both are thresholds on counts the response already reports, never a
// weighted blend, so the reader can always see WHY a status was assigned.

/** Mirrors `AcademicUrgencySchema` in packages/schema member-for-member; pinned by its test. */
export const ACADEMIC_URGENCY_LEVELS = ["critical", "high", "medium", "low"] as const;
export type AcademicUrgency = (typeof ACADEMIC_URGENCY_LEVELS)[number];

/** Mirrors `AcademicPriorityReasonSchema` in packages/schema; pinned by its test. */
export const ACADEMIC_PRIORITY_REASONS = [
  "overdue",
  "due_within_24h",
  "due_this_week",
  "marked_missing",
  "marked_late",
  "high_points",
] as const;
export type AcademicPriorityReason = (typeof ACADEMIC_PRIORITY_REASONS)[number];

/** Mirrors `AcademicWorkloadStatusSchema`; pinned by its test. */
export const ACADEMIC_WORKLOAD_STATUSES = ["on_track", "at_risk", "behind"] as const;
export type AcademicWorkloadStatus = (typeof ACADEMIC_WORKLOAD_STATUSES)[number];

/** Mirrors `AcademicCourseAttentionLevelSchema`; pinned by its test. */
export const ACADEMIC_COURSE_ATTENTION_LEVELS = ["high", "medium", "low", "none"] as const;
export type AcademicCourseAttentionLevel = (typeof ACADEMIC_COURSE_ATTENTION_LEVELS)[number];

/** `high` ⟺ due within this many hours of effectiveNow (strict `<`). */
export const URGENCY_HIGH_WINDOW_HOURS = 24;
/** `high_points` ⟺ points_possible ≥ this (inclusive). */
export const HIGH_POINTS_THRESHOLD = 50;

const HOUR_MS = 60 * 60 * 1000;

/** The frozen base-point table, keyed by urgency. */
export const ACADEMIC_URGENCY_BASE_POINTS: Readonly<Record<AcademicUrgency, number>> = {
  critical: 400,
  high: 300,
  medium: 200,
  low: 100,
};

/**
 * The frozen per-reason point table. The three urgency reasons carry the
 * urgency's base (listed here so `score` is auditable from `reasons` alone
 * for critical/high/medium); the three additive reasons stack on top.
 */
export const ACADEMIC_PRIORITY_POINTS: Readonly<Record<AcademicPriorityReason, number>> = {
  overdue: ACADEMIC_URGENCY_BASE_POINTS.critical,
  due_within_24h: ACADEMIC_URGENCY_BASE_POINTS.high,
  due_this_week: ACADEMIC_URGENCY_BASE_POINTS.medium,
  marked_missing: 50,
  marked_late: 25,
  high_points: 25,
};

/** The reason an urgency contributes, or null for `low` (see the module comment). */
const URGENCY_REASON: Readonly<Record<AcademicUrgency, AcademicPriorityReason | null>> = {
  critical: "overdue",
  high: "due_within_24h",
  medium: "due_this_week",
  low: null,
};

/**
 * Rounds to ONE decimal and normalizes `-0` to `0`, so a wire value never
 * depends on the serializer (the same care `derivePercentage` takes).
 */
export function roundToOneDecimal(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/**
 * The urgency ladder in the module comment. `upcomingDayHorizonEndUtc` is
 * `academicTodayWindows(tz, effectiveNow).horizonEndUtc` -- the caller passes
 * it so the "medium" boundary is byte-identical to `due_this_week`'s.
 *
 * Boundaries, all deliberate:
 *   - due exactly at effectiveNow is NOT overdue (strict `<`, rule 2) and is
 *     0h away, so it is `high`;
 *   - due exactly 24h away is NOT within 24h (strict `<`), so it is `medium`;
 *   - due exactly at the horizon end is NOT before it (strict `<`), so it is
 *     `low` -- the same exclusive bound the buckets apply.
 */
export function deriveUrgency(
  dueAt: Date | null,
  effectiveNow: Date,
  upcomingDayHorizonEndUtc: Date,
): AcademicUrgency | null {
  if (dueAt === null) return null;
  const dueMs = dueAt.getTime();
  const nowMs = effectiveNow.getTime();
  if (dueMs < nowMs) return "critical";
  if (dueMs - nowMs < URGENCY_HIGH_WINDOW_HOURS * HOUR_MS) return "high";
  if (dueMs < upcomingDayHorizonEndUtc.getTime()) return "medium";
  return "low";
}

/**
 * Signed hours from `effectiveNow` to `dueAt`, rounded to one decimal --
 * negative when overdue, null when undated. The wire's `hours_until_due`.
 */
export function hoursUntilDue(dueAt: Date | null, effectiveNow: Date): number | null {
  if (dueAt === null) return null;
  return roundToOneDecimal((dueAt.getTime() - effectiveNow.getTime()) / HOUR_MS);
}

export interface AcademicPriorityInput {
  urgency: AcademicUrgency;
  /** Canvas's own `missing` flag on the submission. */
  missing: boolean;
  /** Canvas's own `late` flag on the submission. */
  late: boolean;
  pointsPossible: number | null;
  /** Part of the input shape for a future time-based rung; contributes no points today. */
  hoursUntilDue: number | null;
}

export interface AcademicPriorityScore {
  score: number;
  /** In table order: the urgency reason first (if any), then the additive ones. */
  reasons: AcademicPriorityReason[];
}

/**
 * The scoring equation from the module comment. Integer points only; the
 * reasons array is ordered by the frozen vocabulary so identical inputs
 * yield byte-identical output.
 */
export function scoreAcademicPriority(input: AcademicPriorityInput): AcademicPriorityScore {
  const reasons: AcademicPriorityReason[] = [];
  let score = ACADEMIC_URGENCY_BASE_POINTS[input.urgency];
  const urgencyReason = URGENCY_REASON[input.urgency];
  if (urgencyReason !== null) reasons.push(urgencyReason);
  if (input.missing) {
    reasons.push("marked_missing");
    score += ACADEMIC_PRIORITY_POINTS.marked_missing;
  }
  if (input.late) {
    reasons.push("marked_late");
    score += ACADEMIC_PRIORITY_POINTS.marked_late;
  }
  if (input.pointsPossible !== null && input.pointsPossible >= HIGH_POINTS_THRESHOLD) {
    reasons.push("high_points");
    score += ACADEMIC_PRIORITY_POINTS.high_points;
  }
  return { score, reasons };
}

/** The minimal shape a candidate must expose to be ranked. */
export interface AcademicPriorityCandidate {
  id: string;
  title: string;
  dueAt: Date | null;
  score: number;
}

/**
 * The total order for "what should I do next?": score DESC, then due_at ASC
 * with nulls last, then title ASC, then id ASC -- it ends in `id`, so
 * identical inputs are byte-identical (docs/ARCHITECTURE.md's rule for every
 * read-model ordering). Exported so a test can assert the comparator alone.
 */
export function compareAcademicPriorities<T extends AcademicPriorityCandidate>(a: T, b: T): number {
  if (a.score !== b.score) return a.score > b.score ? -1 : 1;
  const aMs = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bMs = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aMs !== bMs) return aMs < bMs ? -1 : 1;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Returns a NEW array in `compareAcademicPriorities` order; the input is never mutated. */
export function rankAcademicPriorities<T extends AcademicPriorityCandidate>(
  candidates: readonly T[],
): T[] {
  return [...candidates].sort(compareAcademicPriorities);
}

export interface AcademicWorkloadStatusInput {
  overdueTotal: number;
  missingTotal: number;
  dueWithin24hTotal: number;
}

/** `behind` ⟺ anything overdue or missing; else `at_risk` ⟺ anything due within 24h; else `on_track`. */
export function deriveWorkloadStatus(input: AcademicWorkloadStatusInput): AcademicWorkloadStatus {
  if (input.overdueTotal > 0 || input.missingTotal > 0) return "behind";
  if (input.dueWithin24hTotal > 0) return "at_risk";
  return "on_track";
}

export interface AcademicCourseAttentionInput {
  overdueTotal: number;
  dueWithin24hTotal: number;
  dueThisWeekTotal: number;
  openTotal: number;
}

/**
 * `high` ⟺ anything overdue or due within 24h; `medium` ⟺ anything due in
 * the 7 local days after today; `low` ⟺ anything open at all (undated, or
 * due beyond the horizon); `none` ⟺ nothing open.
 *
 * One accepted edge: an open item due LATER TODAY but 24h or more away is
 * possible only in the first hour of a 25-hour fall-back day, for an item due
 * in that day's last hour. It is then neither within 24h nor in the +1..+7
 * bucket, so a course holding only that item reads `low` for that hour. The
 * rule stays a threshold on the reported counts rather than growing a fifth
 * input for a one-hour-a-year case.
 */
export function deriveCourseAttention(
  input: AcademicCourseAttentionInput,
): AcademicCourseAttentionLevel {
  if (input.overdueTotal > 0 || input.dueWithin24hTotal > 0) return "high";
  if (input.dueThisWeekTotal > 0) return "medium";
  if (input.openTotal > 0) return "low";
  return "none";
}

/** Rank for ordering course-attention rows: high first, none last. */
export function courseAttentionRank(level: AcademicCourseAttentionLevel): number {
  return ACADEMIC_COURSE_ATTENTION_LEVELS.indexOf(level);
}
