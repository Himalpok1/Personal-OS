import { describe, expect, it } from "vitest";
import { derivePercentage, type AcademicGradingStatus } from "./derive.js";
import { deriveGradeSummary, type AcademicGradeSummaryCandidate } from "./grade-summary.js";

function row(
  score: number | null,
  pointsPossible: number | null,
  gradingStatus: AcademicGradingStatus = "graded",
): AcademicGradeSummaryCandidate {
  return {
    gradingStatus,
    score,
    pointsPossible,
    percentage: derivePercentage(score, pointsPossible),
  };
}

describe("deriveGradeSummary", () => {
  it("is all-null with a zero count when nothing is graded", () => {
    expect(deriveGradeSummary([])).toEqual({
      gradedTotal: 0,
      averagePercentage: null,
      pointsEarned: null,
      pointsPossibleGraded: null,
      weightedPercentage: null,
    });
    expect(
      deriveGradeSummary([row(9, 10, "not_graded"), row(9, 10, "pending_review")]).gradedTotal,
    ).toBe(0);
  });

  it("computes the plain mean and the points-weighted percentage, one decimal each", () => {
    // 90% on 10 points and 50% on 100 points: mean 70, weighted 59/110 = 53.6.
    const summary = deriveGradeSummary([row(9, 10), row(50, 100)]);
    expect(summary).toEqual({
      gradedTotal: 2,
      averagePercentage: 70,
      pointsEarned: 59,
      pointsPossibleGraded: 110,
      weightedPercentage: 53.6,
    });
  });

  it("counts an excused graded row (null score) in the total but in no sum or mean", () => {
    const summary = deriveGradeSummary([row(9, 10), row(null, 100)]);
    expect(summary).toEqual({
      gradedTotal: 2,
      averagePercentage: 90,
      pointsEarned: 9,
      pointsPossibleGraded: 10,
      weightedPercentage: 90,
    });
  });

  it("leaves every number null when the only graded rows carry no score", () => {
    expect(deriveGradeSummary([row(null, 100), row(null, null)])).toEqual({
      gradedTotal: 2,
      averagePercentage: null,
      pointsEarned: null,
      pointsPossibleGraded: null,
      weightedPercentage: null,
    });
  });

  it("a graded row with a score but null points_possible has no percentage and no points", () => {
    const summary = deriveGradeSummary([row(5, null)]);
    expect(summary).toEqual({
      gradedTotal: 1,
      averagePercentage: null,
      pointsEarned: null,
      pointsPossibleGraded: null,
      weightedPercentage: null,
    });
  });

  it("a zero-point extra-credit row adds to earned points only; a lone one yields a null weighted percentage", () => {
    expect(deriveGradeSummary([row(5, 0)])).toEqual({
      gradedTotal: 1,
      averagePercentage: null,
      pointsEarned: 5,
      pointsPossibleGraded: 0,
      weightedPercentage: null,
    });
    // 95/100 plus 5 extra credit on 0 possible: weighted 100/100 = 100, mean 95.
    expect(deriveGradeSummary([row(95, 100), row(5, 0)])).toMatchObject({
      pointsEarned: 100,
      pointsPossibleGraded: 100,
      weightedPercentage: 100,
      averagePercentage: 95,
    });
  });

  it("never clamps: extra credit above 100 survives both percentages", () => {
    expect(deriveGradeSummary([row(110, 100)])).toMatchObject({
      averagePercentage: 110,
      weightedPercentage: 110,
    });
  });

  it("rounds to one decimal without binary-fraction drift", () => {
    // 29/100 and 28/100: mean 28.5; weighted 57/200 = 28.5.
    expect(deriveGradeSummary([row(29, 100), row(28, 100)])).toMatchObject({
      averagePercentage: 28.5,
      weightedPercentage: 28.5,
    });
    // 1/3: 33.333... -> 33.3.
    expect(deriveGradeSummary([row(1, 3)])).toMatchObject({
      averagePercentage: 33.3,
      weightedPercentage: 33.3,
    });
  });

  it("does not mutate the caller's array", () => {
    const list = [row(9, 10), row(8, 10)];
    const snapshot = list.map((r) => ({ ...r }));
    deriveGradeSummary(list);
    expect(list).toEqual(snapshot);
  });
});
