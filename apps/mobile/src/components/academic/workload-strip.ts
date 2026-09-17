import type { AcademicWorkloadDay } from "@personal-os/schema";
import { parseLocalDate } from "@/utils/local-date";

// The "this week" workload strip on the Academics card (Checkpoint 10.3):
// one tiny column per day of `workload.days` (today + the following seven
// local days, server-ordered, zero-filled) whose height is proportional to
// that day's open due count. Pure and React-free: the component draws the
// heights this module computes and nothing else.
//
// Nothing here counts or buckets. `due_total` is the server's own figure per
// local day (core's `academicWorkloadDays`); this only scales it to pixels.

/** The tallest column, in px. Small on purpose: the strip is a glance, not a chart. */
export const WORKLOAD_STRIP_MAX_HEIGHT_PX = 28;
/** Every column, even a zero day, draws at least this tall so the day still reads as a slot. */
export const WORKLOAD_STRIP_MIN_HEIGHT_PX = 2;

export interface WorkloadStripColumn {
  date: string;
  dueTotal: number;
  /** Bar height in px, between the min and the max. */
  heightPx: number;
  /** "T", "W", ... -- the first letter of the locale's short weekday name. */
  weekdayInitial: string;
  /** The full short weekday name, for the accessibility label. */
  weekday: string;
}

/**
 * Column heights scale linearly against the busiest day, so a week with one
 * 4-due day and six empty ones reads as one tall bar and six floor stubs. A
 * strip with no dues at all is all floor stubs. A negative or non-finite
 * count is treated as 0 rather than drawing a negative bar.
 */
export function workloadStripColumns(
  days: readonly AcademicWorkloadDay[],
  options: { locale?: string; maxHeightPx?: number; minHeightPx?: number } = {},
): WorkloadStripColumn[] {
  const max = options.maxHeightPx ?? WORKLOAD_STRIP_MAX_HEIGHT_PX;
  const min = options.minHeightPx ?? WORKLOAD_STRIP_MIN_HEIGHT_PX;
  const totals = days.map((day) =>
    Number.isFinite(day.due_total) && day.due_total > 0 ? day.due_total : 0,
  );
  const peak = totals.reduce((a, b) => Math.max(a, b), 0);
  return days.map((day, index) => {
    const dueTotal = totals[index] ?? 0;
    const heightPx =
      peak === 0 || dueTotal === 0 ? min : Math.max(min, Math.round((dueTotal / peak) * max));
    const weekday = parseLocalDate(day.date).toLocaleDateString(options.locale, {
      weekday: "short",
    });
    return { date: day.date, dueTotal, heightPx, weekdayInitial: weekday.charAt(0), weekday };
  });
}

/** "This week: Tue 2 due, Wed none, Thu 1 due, …" -- what a screen reader gets instead of eight bars. */
export function workloadStripLabel(columns: readonly WorkloadStripColumn[]): string {
  if (columns.length === 0) return "This week: nothing due";
  const parts = columns.map(
    (column) => `${column.weekday} ${column.dueTotal === 0 ? "none" : `${column.dueTotal} due`}`,
  );
  return `This week: ${parts.join(", ")}`;
}
