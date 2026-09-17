import type { AcademicGradeSummary } from "@personal-os/schema";
import { formatPercentage, formatPoints, pluralize } from "./format";

// The course hero's grade block (Checkpoint 10.3). Pure and React-free.
// Every figure is the SERVER's (core's `deriveGradeSummary`, computed at read
// time from the ADR-068a columns and never stored); this module only chooses
// which one leads and how it reads. Nothing is averaged or divided here.

export interface GradeSummaryView {
  /** "93.1%" from `weighted_percentage`, or "—" when null. */
  headline: string;
  /** `weighted_percentage / 100` for a progress bar (the bar clamps), or null when there is none. */
  fraction: number | null;
  /** "7 graded assignments" / "1 graded assignment". */
  gradedLine: string;
  /** "Average 92.4%" from `average_percentage`, or null when none. */
  averageLine: string | null;
  /** "112 / 120 pts" from the two point sums, or null unless both are present. */
  pointsLine: string | null;
}

export function gradeSummaryView(summary: AcademicGradeSummary): GradeSummaryView {
  const weighted = summary.weighted_percentage;
  const headline = weighted === null ? "—" : `${formatPercentage(weighted)}%`;
  const fraction = weighted === null || !Number.isFinite(weighted) ? null : weighted / 100;
  const averageLine =
    summary.average_percentage === null
      ? null
      : `Average ${formatPercentage(summary.average_percentage)}%`;
  const pointsLine =
    summary.points_earned === null || summary.points_possible_graded === null
      ? null
      : `${formatPoints(summary.points_earned)} / ${formatPoints(summary.points_possible_graded)} pts`;
  return {
    headline,
    fraction,
    gradedLine: pluralize(summary.graded_total, "graded assignment"),
    averageLine,
    pointsLine,
  };
}

/** A grade block is worth showing only once something has been graded. */
export function hasGradedWork(
  summary: AcademicGradeSummary | undefined,
): summary is AcademicGradeSummary {
  return summary !== undefined && summary.graded_total > 0;
}
