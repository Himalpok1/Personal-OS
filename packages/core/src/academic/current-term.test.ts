import { describe, expect, it } from "vitest";
import { isInCurrentTerm, selectCurrentTerm } from "./current-term.js";

// Mirrors the owner's real Canvas account on 2026-09-16: Fall 2026 (started
// 2026-08-03), Spring 2026 (started 2025-12-15, ended May) and undated
// "Default Term" compliance courses.
const FALL = { termName: "2026 Fall", termStartAt: new Date("2026-08-03T05:00:00Z") };
const SPRING = { termName: "2026 Spring", termStartAt: new Date("2025-12-15T06:00:00Z") };
const DEFAULT = { termName: "Default Term", termStartAt: null };
const NEXT_SPRING = { termName: "2027 Spring", termStartAt: new Date("2027-01-11T06:00:00Z") };
const NOW = new Date("2026-09-16T17:00:00Z");

describe("selectCurrentTerm", () => {
  it("picks the most recently started term, ignoring undated courses", () => {
    expect(selectCurrentTerm([DEFAULT, SPRING, FALL, DEFAULT], NOW)).toEqual({
      name: "2026 Fall",
      startsAt: FALL.termStartAt,
    });
  });

  it("ignores a term that has not started yet", () => {
    expect(selectCurrentTerm([FALL, NEXT_SPRING], NOW)?.name).toBe("2026 Fall");
  });

  it("rolls over the instant the next term starts, with no configuration", () => {
    const janNow = new Date("2027-01-11T06:00:00Z");
    expect(selectCurrentTerm([FALL, NEXT_SPRING], janNow)?.name).toBe("2027 Spring");
  });

  it("keeps an ended term current until the next one starts (the winter gap shows Fall)", () => {
    const gapNow = new Date("2027-01-05T00:00:00Z");
    expect(selectCurrentTerm([FALL, NEXT_SPRING], gapNow)?.name).toBe("2026 Fall");
  });

  it("returns null when no course carries a started term", () => {
    expect(selectCurrentTerm([DEFAULT, DEFAULT], NOW)).toBeNull();
    expect(selectCurrentTerm([], NOW)).toBeNull();
    expect(selectCurrentTerm([NEXT_SPRING], NOW)).toBeNull();
  });

  it("is a pure function of its inputs (no clock read)", () => {
    const a = selectCurrentTerm([FALL, SPRING], NOW);
    const b = selectCurrentTerm([FALL, SPRING], NOW);
    expect(a).toEqual(b);
  });
});

describe("isInCurrentTerm", () => {
  const current = selectCurrentTerm([DEFAULT, SPRING, FALL], NOW);

  it("keeps Fall courses and drops Spring and Default Term courses", () => {
    expect(isInCurrentTerm(FALL, current)).toBe(true);
    expect(isInCurrentTerm(SPRING, current)).toBe(false);
    expect(isInCurrentTerm(DEFAULT, current)).toBe(false);
  });

  it("identifies the term by its start instant, not its name", () => {
    const sameStartOtherName = { termName: "2026 Fall (Law)", termStartAt: FALL.termStartAt };
    const sameNameOtherStart = {
      termName: "2026 Fall",
      termStartAt: new Date("2026-08-01T00:00:00Z"),
    };
    expect(isInCurrentTerm(sameStartOtherName, current)).toBe(true);
    expect(isInCurrentTerm(sameNameOtherStart, current)).toBe(false);
  });

  it("treats every course as current when there is no current term", () => {
    expect(isInCurrentTerm(DEFAULT, null)).toBe(true);
    expect(isInCurrentTerm(SPRING, null)).toBe(true);
  });
});
