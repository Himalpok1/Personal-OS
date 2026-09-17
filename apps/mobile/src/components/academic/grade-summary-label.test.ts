import type { AcademicGradeSummary } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { gradeSummaryView, hasGradedWork } from "./grade-summary-label";

function summary(overrides: Partial<AcademicGradeSummary> = {}): AcademicGradeSummary {
  return {
    graded_total: 7,
    average_percentage: 92.4,
    points_earned: 112,
    points_possible_graded: 120,
    weighted_percentage: 93.3,
    ...overrides,
  };
}

describe("gradeSummaryView", () => {
  it("leads with the weighted percentage and reads the rest out", () => {
    const view = gradeSummaryView(summary());
    expect(view.fraction).toBeCloseTo(0.933);
    expect({ ...view, fraction: undefined }).toEqual({
      headline: "93.3%",
      fraction: undefined,
      gradedLine: "7 graded assignments",
      averageLine: "Average 92.4%",
      pointsLine: "112 / 120 pts",
    });
  });

  it("shows a dash, no bar and no lines when the figures are null", () => {
    expect(
      gradeSummaryView(
        summary({
          graded_total: 1,
          average_percentage: null,
          points_earned: null,
          points_possible_graded: null,
          weighted_percentage: null,
        }),
      ),
    ).toEqual({
      headline: "—",
      fraction: null,
      gradedLine: "1 graded assignment",
      averageLine: null,
      pointsLine: null,
    });
  });

  it("does not clamp extra credit -- the bar does that, the number stays honest", () => {
    const view = gradeSummaryView(summary({ weighted_percentage: 104.5 }));
    expect(view.headline).toBe("104.5%");
    expect(view.fraction).toBeCloseTo(1.045);
  });

  it("needs BOTH point sums for the points line", () => {
    expect(gradeSummaryView(summary({ points_earned: null })).pointsLine).toBeNull();
    expect(gradeSummaryView(summary({ points_possible_graded: null })).pointsLine).toBeNull();
  });
});

describe("hasGradedWork", () => {
  it("is true only for a present summary with at least one graded assignment", () => {
    expect(hasGradedWork(undefined)).toBe(false);
    expect(hasGradedWork(summary({ graded_total: 0 }))).toBe(false);
    expect(hasGradedWork(summary({ graded_total: 1 }))).toBe(true);
  });
});
