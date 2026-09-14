import { describe, expect, it } from "vitest";
import { buildSnoozePatch, computeSnoozeTargets, SNOOZE_MORNING_HOUR } from "./task-snooze.js";
import { toWallClockComponents } from "./timezone.js";

const iso = (value: string): Date => new Date(value);

describe("computeSnoozeTargets", () => {
  it("lands tomorrowMorning on 09:00 local the next calendar day", () => {
    // 2026-07-10 15:00 Chicago (CDT, UTC-5) -> 2026-07-11 09:00 CDT = 14:00Z
    const targets = computeSnoozeTargets(iso("2026-07-10T20:00:00Z"), "America/Chicago");
    expect(targets.tomorrowMorning).toBe("2026-07-11T14:00:00.000Z");
  });

  it("lands nextWeekMorning on 09:00 local seven calendar days later", () => {
    const targets = computeSnoozeTargets(iso("2026-07-10T20:00:00Z"), "America/Chicago");
    expect(targets.nextWeekMorning).toBe("2026-07-17T14:00:00.000Z");
  });

  it("inOneHour is exactly 60 minutes of elapsed time", () => {
    const now = iso("2026-07-10T20:00:00Z");
    const targets = computeSnoozeTargets(now, "America/Chicago");
    expect(Date.parse(targets.inOneHour) - now.getTime()).toBe(60 * 60 * 1000);
  });

  it("uses the LOCAL date, not the UTC date, when the two disagree", () => {
    // 2026-07-10 23:30 Chicago is 2026-07-11 04:30Z. "Tomorrow" must be the
    // 11th (local), not the 12th (UTC + 1).
    const targets = computeSnoozeTargets(iso("2026-07-11T04:30:00Z"), "America/Chicago");
    const local = toWallClockComponents(iso(targets.tomorrowMorning), "America/Chicago");
    expect([local.year, local.month, local.day, local.hour, local.minute]).toEqual([
      2026,
      7,
      11,
      SNOOZE_MORNING_HOUR,
      0,
    ]);
  });

  it("keeps 09:00 wall clock across the US spring-forward transition", () => {
    // Saturday 2026-03-07 in Chicago is CST (UTC-6); Sunday 2026-03-08 the
    // clocks jump at 02:00 to CDT (UTC-5). 09:00 CDT is 14:00Z. Adding 24h
    // to "09:00 CST today" would have given 15:00Z (10:00 local) instead.
    const targets = computeSnoozeTargets(iso("2026-03-07T18:00:00Z"), "America/Chicago");
    expect(targets.tomorrowMorning).toBe("2026-03-08T14:00:00.000Z");
    const local = toWallClockComponents(iso(targets.tomorrowMorning), "America/Chicago");
    expect(local.hour).toBe(SNOOZE_MORNING_HOUR);
  });

  it("keeps 09:00 wall clock across the US fall-back transition", () => {
    // Saturday 2026-10-31 CDT (UTC-5) -> Sunday 2026-11-01 CST (UTC-6).
    // 09:00 CST = 15:00Z.
    const targets = computeSnoozeTargets(iso("2026-10-31T18:00:00Z"), "America/Chicago");
    expect(targets.tomorrowMorning).toBe("2026-11-01T15:00:00.000Z");
  });

  it("nextWeekMorning stays at 09:00 when the week spans a DST change", () => {
    // 2026-03-04 (CST) + 7 days = 2026-03-11 (CDT): 09:00 CDT = 14:00Z.
    const targets = computeSnoozeTargets(iso("2026-03-04T18:00:00Z"), "America/Chicago");
    expect(targets.nextWeekMorning).toBe("2026-03-11T14:00:00.000Z");
  });

  it("rolls the calendar over month and year boundaries", () => {
    const targets = computeSnoozeTargets(iso("2026-12-31T12:00:00Z"), "UTC");
    expect(targets.tomorrowMorning).toBe("2027-01-01T09:00:00.000Z");
    expect(targets.nextWeekMorning).toBe("2027-01-07T09:00:00.000Z");
  });

  it("is correct in a positive-offset zone where local 'tomorrow' is UTC 'today'", () => {
    // 2026-07-11 08:00 Auckland (NZST, UTC+12) is 2026-07-10 20:00Z.
    // Tomorrow 09:00 NZST = 2026-07-12 09:00 local = 2026-07-11 21:00Z.
    const targets = computeSnoozeTargets(iso("2026-07-10T20:00:00Z"), "Pacific/Auckland");
    expect(targets.tomorrowMorning).toBe("2026-07-11T21:00:00.000Z");
  });

  it("does not depend on the host's own timezone", () => {
    // Same instant, two zones: the results differ by exactly the zones'
    // offset difference -- which they could not if `now`'s local getters
    // had leaked in.
    const now = iso("2026-07-10T20:00:00Z");
    const chicago = computeSnoozeTargets(now, "America/Chicago").tomorrowMorning;
    const utc = computeSnoozeTargets(now, "UTC").tomorrowMorning;
    expect(Date.parse(chicago) - Date.parse(utc)).toBe(5 * 60 * 60 * 1000);
  });

  it("rejects an invalid `now` rather than emitting 'Invalid Date' strings", () => {
    expect(() => computeSnoozeTargets(new Date(Number.NaN), "UTC")).toThrow();
  });

  it("rejects an unknown timezone rather than silently falling back", () => {
    expect(() => computeSnoozeTargets(iso("2026-07-10T20:00:00Z"), "Not/AZone")).toThrow();
  });
});

describe("buildSnoozePatch", () => {
  const target = "2026-07-11T14:00:00.000Z";

  it("moves only due_at when the task has no reminder", () => {
    expect(buildSnoozePatch({ remind_at: null }, target)).toEqual({ due_at: target });
  });

  it("never introduces a remind_at key when the task has no reminder", () => {
    // A `remind_at: undefined` key would be harmless on the wire but is the
    // shape a future refactor could turn into `null`/a value by accident.
    expect(Object.keys(buildSnoozePatch({ remind_at: null }, target))).toEqual(["due_at"]);
  });

  it("moves remind_at along with due_at when the task has a reminder", () => {
    expect(buildSnoozePatch({ remind_at: "2026-07-10T13:00:00.000Z" }, target)).toEqual({
      due_at: target,
      remind_at: target,
    });
  });
});
