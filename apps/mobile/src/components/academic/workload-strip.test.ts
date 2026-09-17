import { describe, expect, it } from "vitest";
import {
  WORKLOAD_STRIP_MAX_HEIGHT_PX,
  WORKLOAD_STRIP_MIN_HEIGHT_PX,
  workloadStripColumns,
  workloadStripLabel,
} from "./workload-strip";

// 2026-09-15 is a Tuesday.
const DAYS = [
  { date: "2026-09-15", due_total: 2, points_total: 100 },
  { date: "2026-09-16", due_total: 0, points_total: 0 },
  { date: "2026-09-17", due_total: 4, points_total: 60 },
  { date: "2026-09-18", due_total: 1, points_total: 10 },
];

describe("workloadStripColumns", () => {
  it("scales heights linearly against the busiest day, with a floor for empty days", () => {
    const columns = workloadStripColumns(DAYS, { locale: "en-US" });
    expect(columns.map((c) => c.heightPx)).toEqual([
      Math.round((2 / 4) * WORKLOAD_STRIP_MAX_HEIGHT_PX),
      WORKLOAD_STRIP_MIN_HEIGHT_PX,
      WORKLOAD_STRIP_MAX_HEIGHT_PX,
      Math.round((1 / 4) * WORKLOAD_STRIP_MAX_HEIGHT_PX),
    ]);
    expect(columns.map((c) => c.dueTotal)).toEqual([2, 0, 4, 1]);
  });

  it("never draws below the floor, even for a tiny share of the peak", () => {
    const columns = workloadStripColumns(
      [
        { date: "2026-09-15", due_total: 1, points_total: 0 },
        { date: "2026-09-16", due_total: 100, points_total: 0 },
      ],
      { locale: "en-US", maxHeightPx: 28, minHeightPx: 2 },
    );
    expect(columns[0]!.heightPx).toBe(2);
    expect(columns[1]!.heightPx).toBe(28);
  });

  it("draws a week with nothing due as all floor stubs", () => {
    const columns = workloadStripColumns(
      DAYS.map((day) => ({ ...day, due_total: 0 })),
      { locale: "en-US" },
    );
    expect(columns.every((c) => c.heightPx === WORKLOAD_STRIP_MIN_HEIGHT_PX)).toBe(true);
  });

  it("labels each column with the weekday initial from the local date, never a UTC-shifted one", () => {
    const columns = workloadStripColumns(DAYS, { locale: "en-US" });
    expect(columns.map((c) => c.weekday)).toEqual(["Tue", "Wed", "Thu", "Fri"]);
    expect(columns.map((c) => c.weekdayInitial)).toEqual(["T", "W", "T", "F"]);
  });

  it("treats a negative or non-finite count as zero", () => {
    const columns = workloadStripColumns(
      [
        { date: "2026-09-15", due_total: -3, points_total: 0 },
        { date: "2026-09-16", due_total: Number.NaN, points_total: 0 },
        { date: "2026-09-17", due_total: 2, points_total: 0 },
      ],
      { locale: "en-US" },
    );
    expect(columns.map((c) => c.dueTotal)).toEqual([0, 0, 2]);
    expect(columns[2]!.heightPx).toBe(WORKLOAD_STRIP_MAX_HEIGHT_PX);
  });

  it("returns an empty strip for no days", () => {
    expect(workloadStripColumns([])).toEqual([]);
  });
});

describe("workloadStripLabel", () => {
  it("reads every day out with its count", () => {
    const columns = workloadStripColumns(DAYS.slice(0, 3), { locale: "en-US" });
    expect(workloadStripLabel(columns)).toBe("This week: Tue 2 due, Wed none, Thu 4 due");
  });

  it("has a fixed sentence for an empty strip", () => {
    expect(workloadStripLabel([])).toBe("This week: nothing due");
  });
});
