import { describe, expect, it } from "vitest";
import { SLEEP_TREND_ON_PAR_SECONDS, describeSleepTrend, formatSleepDelta } from "./sleep-trend";

describe("describeSleepTrend (Checkpoint 10.6)", () => {
  it("is null when there is no 7-day average to compare against", () => {
    // Null means no night landed in the trailing week -- not an average of
    // zero, so there is nothing honest to say.
    expect(describeSleepTrend(27_060, null)).toBeNull();
  });

  it("is null for a non-finite input rather than printing NaN minutes", () => {
    expect(describeSleepTrend(Number.NaN, 26_400)).toBeNull();
    expect(describeSleepTrend(27_060, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("reads a longer night as above the average, in minutes", () => {
    // 7h 31m against 7h 20m: the health-components fixture.
    const trend = describeSleepTrend(27_060, 26_400);
    expect(trend).toEqual({
      direction: "above",
      deltaSeconds: 660,
      caption: "11 min above your 7-day average",
      icon: "trending-up",
    });
  });

  it("reads a shorter night as below the average, in hours and minutes", () => {
    const trend = describeSleepTrend(5 * 3600, 6 * 3600 + 5 * 60);
    expect(trend?.direction).toBe("below");
    expect(trend?.caption).toBe("1 h 5 min below your 7-day average");
    expect(trend?.icon).toBe("trending-down");
  });

  it("reads a night within five minutes of the average as on par, either side", () => {
    for (const delta of [0, 1, SLEEP_TREND_ON_PAR_SECONDS - 1, -(SLEEP_TREND_ON_PAR_SECONDS - 1)]) {
      const trend = describeSleepTrend(26_400 + delta, 26_400);
      expect(trend?.direction, `delta ${delta}`).toBe("on_par");
      expect(trend?.caption).toBe("On par with your 7-day average");
      expect(trend?.icon).toBe("trending-neutral");
    }
    // Exactly the threshold is no longer "on par".
    expect(describeSleepTrend(26_400 + SLEEP_TREND_ON_PAR_SECONDS, 26_400)?.direction).toBe(
      "above",
    );
  });

  it("never spells a duration in the `Nh Nm` shape the card counts", () => {
    // health-components.test.tsx asserts the sleep card carries EXACTLY two
    // `\d+h \d+m` durations; the caption must not become a third.
    for (const [night, average] of [
      [27_060, 26_400],
      [5 * 3600, 6 * 3600 + 5 * 60],
      [9 * 3600, 7 * 3600],
      [26_400, 26_400],
    ]) {
      const caption = describeSleepTrend(night!, average!)?.caption ?? "";
      expect(caption).not.toMatch(/\d+h \d+m/);
    }
  });
});

describe("formatSleepDelta", () => {
  it("prints whole minutes below an hour, and hours with minutes above it", () => {
    expect(formatSleepDelta(35 * 60)).toBe("35 min");
    expect(formatSleepDelta(-35 * 60)).toBe("35 min");
    expect(formatSleepDelta(3600)).toBe("1 h");
    expect(formatSleepDelta(3900)).toBe("1 h 5 min");
    expect(formatSleepDelta(2 * 3600 + 30 * 60)).toBe("2 h 30 min");
  });

  it("rounds to the nearest minute", () => {
    expect(formatSleepDelta(89)).toBe("1 min");
    expect(formatSleepDelta(91)).toBe("2 min");
  });
});
