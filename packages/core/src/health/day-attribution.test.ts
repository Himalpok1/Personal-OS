import { describe, expect, it } from "vitest";
import { attributeExerciseLocalDate, attributeSleepLocalDate } from "./day-attribution.js";

describe("attributeSleepLocalDate (ADR-049)", () => {
  // The load-bearing case: sleep begins on the 23rd and ends on the 24th, and
  // belongs to the 24th -- the morning you ask "how did I sleep?".
  it("attributes a midnight-crossing sleep to the WAKE date, not the start date", () => {
    const wake = { date: { year: 2026, month: 8, day: 24 }, time: { hours: 6, minutes: 52 } };
    expect(attributeSleepLocalDate(wake)).toBe("2026-08-24");
  });

  it("attributes a daytime nap to its own single date", () => {
    const wake = { date: { year: 2026, month: 8, day: 24 }, time: { hours: 14, minutes: 30 } };
    expect(attributeSleepLocalDate(wake)).toBe("2026-08-24");
  });

  it("crosses a month boundary by wake date", () => {
    const wake = { date: { year: 2026, month: 9, day: 1 }, time: { hours: 5 } };
    expect(attributeSleepLocalDate(wake)).toBe("2026-09-01");
  });

  it("crosses a year boundary by wake date", () => {
    const wake = { date: { year: 2027, month: 1, day: 1 }, time: { hours: 7 } };
    expect(attributeSleepLocalDate(wake)).toBe("2027-01-01");
  });
});

describe("attributeExerciseLocalDate (ADR-049)", () => {
  // Deliberately the opposite of sleep: an exercise is an act performed at a
  // time, so a run started at 23:10 on the 23rd is a run on the 23rd even
  // though it finishes on the 24th.
  it("attributes a midnight-crossing exercise to the START date", () => {
    const start = { date: { year: 2026, month: 8, day: 23 }, time: { hours: 23, minutes: 10 } };
    expect(attributeExerciseLocalDate(start)).toBe("2026-08-23");
  });
});

describe("sleep and exercise use opposite ends of their interval", () => {
  // Pins the asymmetry itself. If someone "simplifies" both to the same end,
  // this fails -- which is the point.
  it("disagrees for the same interval", () => {
    const start = { date: { year: 2026, month: 8, day: 23 }, time: { hours: 23 } };
    const end = { date: { year: 2026, month: 8, day: 24 }, time: { hours: 7 } };
    expect(attributeSleepLocalDate(end)).toBe("2026-08-24");
    expect(attributeExerciseLocalDate(start)).toBe("2026-08-23");
    expect(attributeSleepLocalDate(end)).not.toBe(attributeExerciseLocalDate(start));
  });
});
