import { describe, expect, it } from "vitest";
import { getHealthMetric } from "../google-health-catalog.js";
import { buildRollupRange, buildWindowFilter } from "./requests.js";

const WINDOW = { startDate: "2026-08-18", endDate: "2026-08-25" };

describe("buildRollupRange", () => {
  it("uses bare start/end, never startTime/endTime", () => {
    const range = buildRollupRange(WINDOW);
    // The live-verified 400 this pins: `Unknown name "startTime" at 'range'`.
    expect(Object.keys(range).sort()).toEqual(["end", "start"]);
    expect(range).not.toHaveProperty("startTime");
    expect(range).not.toHaveProperty("endTime");
  });

  it("carries the calendar components verbatim", () => {
    expect(buildRollupRange(WINDOW)).toEqual({
      start: { date: { year: 2026, month: 8, day: 18 } },
      end: { date: { year: 2026, month: 8, day: 25 } },
    });
  });

  it("omits the optional time component rather than inventing a midnight", () => {
    const range = buildRollupRange(WINDOW);
    expect(range.start).not.toHaveProperty("time");
    expect(range.end).not.toHaveProperty("time");
  });

  it("never emits a pageSize", () => {
    expect(JSON.stringify(buildRollupRange(WINDOW))).not.toContain("pageSize");
  });

  it("rejects a malformed boundary rather than interpolating it", () => {
    expect(() => buildRollupRange({ startDate: "2026-8-18", endDate: "2026-08-25" })).toThrow(
      /invalid window start date/,
    );
    expect(() => buildRollupRange({ startDate: "2026-08-18", endDate: "nope" })).toThrow(
      /invalid window end date/,
    );
  });
});

describe("buildWindowFilter", () => {
  it("throws for a dailyRollUp metric, which takes a range not a filter", () => {
    expect(() => buildWindowFilter(getHealthMetric("steps"), WINDOW)).toThrow(/no filterPath/);
  });

  it("emits a BARE date for a google.type.Date path", () => {
    const filter = buildWindowFilter(getHealthMetric("daily-resting-heart-rate"), WINDOW);
    expect(filter).toBe(
      'daily_resting_heart_rate.date >= "2026-08-18" AND daily_resting_heart_rate.date < "2026-08-25"',
    );
    expect(filter).not.toContain("T00:00:00");
  });

  it("emits a civil DATE-TIME literal for a civil_time path", () => {
    expect(buildWindowFilter(getHealthMetric("weight"), WINDOW)).toBe(
      'weight.sample_time.civil_time >= "2026-08-18T00:00:00" AND ' +
        'weight.sample_time.civil_time < "2026-08-25T00:00:00"',
    );
  });

  it("is half-open: inclusive lower bound, exclusive upper bound", () => {
    const filter = buildWindowFilter(getHealthMetric("body-fat"), WINDOW);
    expect(filter).toContain('>= "2026-08-18T00:00:00"');
    expect(filter).toContain('< "2026-08-25T00:00:00"');
    expect(filter).not.toContain("<=");
  });

  // ADR-049 / live 6.2P proof: sleep filters on civil_end_time and is EXCLUDED
  // from the generic session-start filter. `start_time` returned HTTP 400
  // INVALID_ARGUMENT against a real account.
  it("filters sleep on civil_end_time and NEVER on a start time", () => {
    const filter = buildWindowFilter(getHealthMetric("sleep"), WINDOW);
    expect(filter).toContain("sleep.interval.civil_end_time");
    expect(filter).not.toContain("start_time");
    expect(filter).not.toContain("civil_start_time");
  });

  it("filters exercise on its civil start time", () => {
    const filter = buildWindowFilter(getHealthMetric("exercise"), WINDOW);
    expect(filter).toContain("exercise.interval.civil_start_time");
    expect(filter).not.toContain("civil_end_time");
  });

  it("uses the documented filter path verbatim on both sides", () => {
    for (const metric of ["daily-vo2-max", "daily-oxygen-saturation", "weight", "sleep"]) {
      const def = getHealthMetric(metric);
      const filter = buildWindowFilter(def, WINDOW);
      expect(filter.startsWith(`${def.filterPath!} >= `)).toBe(true);
      expect(filter).toContain(`AND ${def.filterPath!} < `);
    }
  });

  it("rejects a malformed window boundary", () => {
    expect(() =>
      buildWindowFilter(getHealthMetric("weight"), { startDate: "bad", endDate: "2026-08-25" }),
    ).toThrow(/invalid/);
  });
});
