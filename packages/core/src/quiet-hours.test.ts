import { describe, expect, it } from "vitest";
import { isWithinQuietHours, nextQuietHoursEnd } from "./quiet-hours.js";
import { toWallClockComponents } from "./timezone.js";

describe("isWithinQuietHours", () => {
  it("is false when any field is null", () => {
    const now = new Date("2026-08-16T03:00:00Z");
    expect(isWithinQuietHours(now, null, "08:00", "America/Chicago")).toBe(false);
    expect(isWithinQuietHours(now, "22:00", null, "America/Chicago")).toBe(false);
    expect(isWithinQuietHours(now, "22:00", "08:00", null)).toBe(false);
  });

  it("is true for a same-day window when now falls inside it", () => {
    // 2026-08-16T15:00:00Z = 10:00 America/Chicago (CDT, UTC-5) -- inside 09:00-17:00.
    const now = new Date("2026-08-16T15:00:00Z");
    expect(isWithinQuietHours(now, "09:00", "17:00", "America/Chicago")).toBe(true);
  });

  it("is false for a same-day window when now falls outside it", () => {
    // 2026-08-16T23:00:00Z = 18:00 America/Chicago -- after 09:00-17:00.
    const now = new Date("2026-08-16T23:00:00Z");
    expect(isWithinQuietHours(now, "09:00", "17:00", "America/Chicago")).toBe(false);
  });

  it("handles an overnight wraparound window (22:00 -> 06:00)", () => {
    // 2026-08-16T08:00:00Z = 03:00 America/Chicago -- inside the wraparound window.
    const insideWrap = new Date("2026-08-16T08:00:00Z");
    expect(isWithinQuietHours(insideWrap, "22:00", "06:00", "America/Chicago")).toBe(true);

    // 2026-08-16T20:00:00Z = 15:00 America/Chicago -- outside it.
    const outsideWrap = new Date("2026-08-16T20:00:00Z");
    expect(isWithinQuietHours(outsideWrap, "22:00", "06:00", "America/Chicago")).toBe(false);
  });

  it("is false when start equals end (degenerate/misconfigured window)", () => {
    const now = new Date("2026-08-16T15:00:00Z");
    expect(isWithinQuietHours(now, "09:00", "09:00", "America/Chicago")).toBe(false);
  });
});

describe("nextQuietHoursEnd", () => {
  // The delay ADR-053 amendment E requires. Every case below is stated as an
  // instant rather than a duration, because the whole point is that the answer
  // is a wall-clock boundary in the DEVICE's zone, not "now plus N hours".

  it("returns null when any field is unset -- nothing to wait for", () => {
    const now = new Date("2026-09-01T08:00:00.000Z");
    expect(nextQuietHoursEnd(now, null, "06:00", "America/Chicago")).toBeNull();
    expect(nextQuietHoursEnd(now, "22:00", null, "America/Chicago")).toBeNull();
    expect(nextQuietHoursEnd(now, "22:00", "06:00", null)).toBeNull();
  });

  it("returns null when the device is NOT in quiet hours -- send now", () => {
    // 15:00 Chicago, window 22:00-06:00.
    const now = new Date("2026-09-01T20:00:00.000Z");
    expect(nextQuietHoursEnd(now, "22:00", "06:00", "America/Chicago")).toBeNull();
  });

  it("returns today's end for a same-day window", () => {
    // 10:00 Chicago (CDT, UTC-5), window 09:00-17:00.
    const now = new Date("2026-09-01T15:00:00.000Z");
    const end = nextQuietHoursEnd(now, "09:00", "17:00", "America/Chicago");
    // 17:00 CDT = 22:00 UTC the same day.
    expect(end?.toISOString()).toBe("2026-09-01T22:00:00.000Z");
  });

  it("rolls to TOMORROW for an overnight window observed before midnight", () => {
    // 23:00 Chicago on Sep 1 = 04:00 UTC on Sep 2. Window 22:00-06:00.
    const now = new Date("2026-09-02T04:00:00.000Z");
    const end = nextQuietHoursEnd(now, "22:00", "06:00", "America/Chicago");
    // The end is 06:00 Chicago on Sep 2 = 11:00 UTC -- NOT Sep 1's 06:00, which
    // passed seventeen hours earlier.
    expect(end?.toISOString()).toBe("2026-09-02T11:00:00.000Z");
  });

  it("returns today's end for an overnight window observed AFTER midnight", () => {
    // 02:00 Chicago on Sep 2 = 07:00 UTC. Window 22:00-06:00.
    const now = new Date("2026-09-02T07:00:00.000Z");
    const end = nextQuietHoursEnd(now, "22:00", "06:00", "America/Chicago");
    expect(end?.toISOString()).toBe("2026-09-02T11:00:00.000Z");
  });

  it("returns an instant that is NOT itself inside quiet hours", () => {
    // The property the whole mechanism rests on: the window's end is EXCLUSIVE
    // in isWithinQuietHours, so a job landing exactly here passes rather than
    // being dropped again -- which would be an infinite deferral loop.
    const now = new Date("2026-09-02T04:00:00.000Z");
    const end = nextQuietHoursEnd(now, "22:00", "06:00", "America/Chicago")!;
    expect(isWithinQuietHours(end, "22:00", "06:00", "America/Chicago")).toBe(false);
  });

  it("stays at 06:00 LOCAL across a DST spring-forward", () => {
    // 2027-03-14 is the US spring-forward. 23:00 Chicago on Mar 13 (CST, UTC-6)
    // is 05:00 UTC on Mar 14. The following local day is 23 hours long, so
    // adding 24h of elapsed time would land at 07:00 local, not 06:00.
    const now = new Date("2027-03-14T05:00:00.000Z");
    const end = nextQuietHoursEnd(now, "22:00", "06:00", "America/Chicago")!;
    // 06:00 CDT on Mar 14 = 11:00 UTC.
    expect(end.toISOString()).toBe("2027-03-14T11:00:00.000Z");
    expect(toWallClockComponents(end, "America/Chicago").hour).toBe(6);
  });

  it("stays at 06:00 LOCAL across a DST fall-back", () => {
    // 2026-11-01 is the US fall-back; that local day is 25 hours long.
    const now = new Date("2026-11-01T04:00:00.000Z"); // 23:00 Oct 31 CDT
    const end = nextQuietHoursEnd(now, "22:00", "06:00", "America/Chicago")!;
    expect(toWallClockComponents(end, "America/Chicago").hour).toBe(6);
  });

  it("works east of UTC, where the local date differs from the UTC date", () => {
    // 23:30 Auckland on Sep 2 = 11:30 UTC on Sep 2 (NZST, UTC+12).
    const now = new Date("2026-09-02T11:30:00.000Z");
    const end = nextQuietHoursEnd(now, "22:00", "06:00", "Pacific/Auckland")!;
    expect(toWallClockComponents(end, "Pacific/Auckland").hour).toBe(6);
    expect(isWithinQuietHours(end, "22:00", "06:00", "Pacific/Auckland")).toBe(false);
  });
});
