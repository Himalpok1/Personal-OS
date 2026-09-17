// A course's grade summary (Checkpoint 10.3, Lane A) -- computed at read time
// over the assignments Canvas has GRADED, never stored (ADR-068a), so it can
// never disagree with the `score` / `points_possible` columns it is built
// from.
//
// THE RULES, EXACTLY:
//   graded_total          = count of assignments with gradingStatus `graded`
//   average_percentage    = mean of the non-null `percentage` values over
//                           those rows, one decimal; null when no graded row
//                           carries a percentage
//   points_earned         = Σ score          over graded rows where BOTH score
//   points_possible_graded= Σ points_possible  and points_possible are present;
//                           both null when no graded row has both
//   weighted_percentage   = points_earned / points_possible_graded × 100, one
//                           decimal; null when the denominator is null or 0
//
// A graded row with a null score (excused, complete/incomplete) counts in
// `graded_total` and in nothing else: it has no percentage to average and no
// points to sum. The two percentages answer different questions and are both
// reported rather than reconciled: the plain mean weights every assignment
// equally, the weighted one lets a 100-point exam outweigh a 5-point quiz --
// which is how most Canvas courses actually compute a running grade.
//
// Neither percentage is clamped: extra credit legitimately exceeds 100, and
// an "extra credit" assignment with points_possible 0 adds to the numerator
// only, exactly as Canvas treats it.
//
// Pure: no clock, no I/O.
import type { AcademicGradingStatus } from "./derive.js";
import { roundToOneDecimal } from "./urgency.js";

/** The minimal shape an assignment must expose to be summarized. */
export interface AcademicGradeSummaryCandidate {
  gradingStatus: AcademicGradingStatus;
  score: number | null;
  pointsPossible: number | null;
  /** The already-derived `derivePercentage(score, pointsPossible)`. */
  percentage: number | null;
}

export interface AcademicGradeSummary {
  gradedTotal: number;
  averagePercentage: number | null;
  pointsEarned: number | null;
  pointsPossibleGraded: number | null;
  weightedPercentage: number | null;
}

export function deriveGradeSummary<T extends AcademicGradeSummaryCandidate>(
  assignments: readonly T[],
): AcademicGradeSummary {
  let gradedTotal = 0;
  let percentageSum = 0;
  let percentageCount = 0;
  let pointsEarned: number | null = null;
  let pointsPossibleGraded: number | null = null;

  for (const assignment of assignments) {
    if (assignment.gradingStatus !== "graded") continue;
    gradedTotal += 1;
    if (assignment.percentage !== null) {
      percentageSum += assignment.percentage;
      percentageCount += 1;
    }
    if (assignment.score !== null && assignment.pointsPossible !== null) {
      pointsEarned = (pointsEarned ?? 0) + assignment.score;
      pointsPossibleGraded = (pointsPossibleGraded ?? 0) + assignment.pointsPossible;
    }
  }

  const averagePercentage =
    percentageCount === 0 ? null : roundToOneDecimal(percentageSum / percentageCount);
  const weightedPercentage =
    pointsEarned === null || pointsPossibleGraded === null || pointsPossibleGraded === 0
      ? null
      : roundToOneDecimal((pointsEarned * 100) / pointsPossibleGraded);

  return {
    gradedTotal,
    averagePercentage,
    pointsEarned,
    pointsPossibleGraded,
    weightedPercentage,
  };
}
