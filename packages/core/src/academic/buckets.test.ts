import { describe, expect, it } from "vitest";
import { localDayWindow, localDayWindowForDate } from "../actionability.js";
import {
  academicTodayWindows,
  bucketAcademicAssignments,
  type AcademicBucketCandidate,
} from "./buckets.js";

const TZ = "America/Chicago";
const iso = (value: string): Date => new Date(value);

let counter = 0;
function candidate(
  dueAt: string | null,
  overrides: Partial<AcademicBucketCandidate> = {},
): AcademicBucketCandidate {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    title: `Assignment ${counter}`,
    dueAt: dueAt === null ? null : iso(dueAt),
    open: true,
    ...overrides,
  };
}

const ids = (rows: readonly AcademicBucketCandidate[]): string[] => rows.map((r) => r.id);

describe("academicTodayWindows", () => {
  it("reports the local day containing effectiveNow and the end of day + 7", () => {
    // 2026-09-16T03:00Z is 2026-09-15 22:00 CDT.
    const w = academicTodayWindows(TZ, iso("2026-09-16T03:00:00Z"));
    expect(w.today.localDate).toBe("2026-09-15");
    expect(w.today.startUtc.toISOString()).toBe("2026-09-15T05:00:00.000Z");
    expect(w.today.endUtcExclusive.toISOString()).toBe("2026-09-16T05:00:00.000Z");
    // Day + 7 is 2026-09-22; its end-exclusive is the start of 2026-09-23.
    expect(w.horizonEndUtc.toISOString()).toBe("2026-09-23T05:00:00.000Z");
  });

  it("uses the same primitives Today does, so the windows agree exactly", () => {
    const now = iso("2026-09-16T12:00:00Z");
    const w = academicTodayWindows(TZ, now);
    expect(w.today).toEqual(localDayWindow(TZ, now));
    expect(w.horizonEndUtc).toEqual(localDayWindowForDate(TZ, "2026-09-23").endUtcExclusive);
  });

  it("honours a caller-supplied upcoming day count", () => {
    const w = academicTodayWindows(TZ, iso("2026-09-16T12:00:00Z"), 1);
    expect(w.horizonEndUtc.toISOString()).toBe("2026-09-18T05:00:00.000Z");
  });
});

describe("bucketAcademicAssignments -- precedence", () => {
  // 2026-09-16 14:00 CDT.
  const effectiveNow = iso("2026-09-16T19:00:00Z");

  it("puts an item due earlier TODAY in overdue, never due_today", () => {
    const earlierToday = candidate("2026-09-16T14:00:00Z"); // 09:00 CDT today
    const laterToday = candidate("2026-09-16T23:00:00Z"); // 18:00 CDT today
    const result = bucketAcademicAssignments({
      assignments: [earlierToday, laterToday],
      effectiveNow,
      tz: TZ,
    });
    expect(ids(result.overdue)).toEqual([earlierToday.id]);
    expect(ids(result.dueToday)).toEqual([laterToday.id]);
    expect(result.dueThisWeek).toEqual([]);
  });

  it("an item due exactly at effectiveNow is due_today, not overdue (strict <)", () => {
    const atNow = candidate(effectiveNow.toISOString());
    const result = bucketAcademicAssignments({ assignments: [atNow], effectiveNow, tz: TZ });
    expect(ids(result.dueToday)).toEqual([atNow.id]);
    expect(result.overdue).toEqual([]);
  });

  it("an item due exactly at today's local midnight is overdue once the day has started", () => {
    const midnight = candidate("2026-09-16T05:00:00Z"); // 00:00 CDT today
    const result = bucketAcademicAssignments({ assignments: [midnight], effectiveNow, tz: TZ });
    expect(ids(result.overdue)).toEqual([midnight.id]);
    expect(result.dueToday).toEqual([]);
  });

  it("an item due exactly at today's local midnight is due_today when effectiveNow IS that instant", () => {
    const midnightNow = iso("2026-09-16T05:00:00Z");
    const midnight = candidate("2026-09-16T05:00:00Z");
    const result = bucketAcademicAssignments({
      assignments: [midnight],
      effectiveNow: midnightNow,
      tz: TZ,
    });
    expect(ids(result.dueToday)).toEqual([midnight.id]);
  });

  it("an item due exactly at tomorrow's local midnight is due_this_week, not due_today", () => {
    const tomorrowMidnight = candidate("2026-09-17T05:00:00Z"); // 00:00 CDT 09-17
    const lastInstantToday = candidate("2026-09-17T04:59:59.999Z");
    const result = bucketAcademicAssignments({
      assignments: [tomorrowMidnight, lastInstantToday],
      effectiveNow,
      tz: TZ,
    });
    expect(ids(result.dueToday)).toEqual([lastInstantToday.id]);
    expect(ids(result.dueThisWeek)).toEqual([tomorrowMidnight.id]);
  });
});

describe("bucketAcademicAssignments -- the seven-day horizon", () => {
  const effectiveNow = iso("2026-09-16T19:00:00Z"); // 2026-09-16 14:00 CDT

  it("covers days +1 through +7 and stops at the start of day +8", () => {
    const dayPlus1 = candidate("2026-09-17T12:00:00Z");
    const dayPlus7Last = candidate("2026-09-24T04:59:59.999Z"); // 23:59:59.999 CDT on 09-23
    const dayPlus8Start = candidate("2026-09-24T05:00:00Z"); // 00:00 CDT on 09-24
    const farFuture = candidate("2026-12-01T12:00:00Z");
    const result = bucketAcademicAssignments({
      assignments: [farFuture, dayPlus8Start, dayPlus7Last, dayPlus1],
      effectiveNow,
      tz: TZ,
    });
    expect(ids(result.dueThisWeek)).toEqual([dayPlus1.id, dayPlus7Last.id]);
    expect(result.overdue).toEqual([]);
    expect(result.dueToday).toEqual([]);
  });

  it("buckets against the CLIENT's zone, so the same instant lands differently elsewhere", () => {
    // effectiveNow is 14:00 CDT on 09-16 in Chicago but 07:00 NZST on 09-17
    // in Auckland. 2026-09-17T08:00Z is 03:00 CDT on 09-17 (tomorrow in
    // Chicago) yet 20:00 NZST on 09-17 (still today in Auckland).
    const instant = candidate("2026-09-17T08:00:00Z");
    const chicago = bucketAcademicAssignments({ assignments: [instant], effectiveNow, tz: TZ });
    const auckland = bucketAcademicAssignments({
      assignments: [instant],
      effectiveNow,
      tz: "Pacific/Auckland",
    });
    expect(ids(chicago.dueThisWeek)).toEqual([instant.id]);
    expect(chicago.dueToday).toEqual([]);
    expect(ids(auckland.dueToday)).toEqual([instant.id]);
    expect(auckland.dueThisWeek).toEqual([]);
  });
});

describe("bucketAcademicAssignments -- what is never bucketed", () => {
  const effectiveNow = iso("2026-09-16T19:00:00Z");

  it("skips closed assignments whatever their due instant", () => {
    const closedOverdue = candidate("2026-09-01T12:00:00Z", { open: false });
    const closedToday = candidate("2026-09-16T23:00:00Z", { open: false });
    const closedWeek = candidate("2026-09-18T12:00:00Z", { open: false });
    const result = bucketAcademicAssignments({
      assignments: [closedOverdue, closedToday, closedWeek],
      effectiveNow,
      tz: TZ,
    });
    expect(result).toEqual({ overdue: [], dueToday: [], dueThisWeek: [] });
  });

  it("skips undated assignments", () => {
    const undated = candidate(null);
    const result = bucketAcademicAssignments({ assignments: [undated], effectiveNow, tz: TZ });
    expect(result).toEqual({ overdue: [], dueToday: [], dueThisWeek: [] });
  });

  it("returns empty buckets for no input", () => {
    expect(bucketAcademicAssignments({ assignments: [], effectiveNow, tz: TZ })).toEqual({
      overdue: [],
      dueToday: [],
      dueThisWeek: [],
    });
  });
});

describe("bucketAcademicAssignments -- ordering", () => {
  const effectiveNow = iso("2026-09-16T19:00:00Z");

  it("sorts each bucket by due_at asc, then title, then id", () => {
    const late = candidate("2026-09-10T12:00:00Z", { title: "B" });
    const earlyB = candidate("2026-09-05T12:00:00Z", { title: "B" });
    const earlyA = candidate("2026-09-05T12:00:00Z", { title: "A" });
    const earlyA2 = candidate("2026-09-05T12:00:00Z", {
      title: "A",
      id: "00000000-0000-4000-8000-000000000000",
    });
    const result = bucketAcademicAssignments({
      assignments: [late, earlyB, earlyA, earlyA2],
      effectiveNow,
      tz: TZ,
    });
    expect(ids(result.overdue)).toEqual([earlyA2.id, earlyA.id, earlyB.id, late.id]);
  });

  it("is independent of input order", () => {
    const a = candidate("2026-09-17T12:00:00Z", { title: "x" });
    const b = candidate("2026-09-18T12:00:00Z", { title: "y" });
    const c = candidate("2026-09-19T12:00:00Z", { title: "z" });
    const forward = bucketAcademicAssignments({ assignments: [a, b, c], effectiveNow, tz: TZ });
    const reverse = bucketAcademicAssignments({ assignments: [c, b, a], effectiveNow, tz: TZ });
    expect(ids(forward.dueThisWeek)).toEqual(ids(reverse.dueThisWeek));
  });

  it("does not mutate the caller's array", () => {
    const list = [candidate("2026-09-18T12:00:00Z"), candidate("2026-09-17T12:00:00Z")];
    const snapshot = [...list];
    bucketAcademicAssignments({ assignments: list, effectiveNow, tz: TZ });
    expect(list).toEqual(snapshot);
  });
});

describe("DST spring-forward (America/Chicago, 2026-03-08: 23-hour local day)", () => {
  // 07:00 CDT on 03-08 -- the clocks have already jumped.
  const effectiveNow = iso("2026-03-08T12:00:00Z");

  it("today's window is 06:00Z (CST midnight) to 05:00Z next day (CDT midnight)", () => {
    const w = academicTodayWindows(TZ, effectiveNow);
    expect(w.today.localDate).toBe("2026-03-08");
    expect(w.today.startUtc.toISOString()).toBe("2026-03-08T06:00:00.000Z");
    expect(w.today.endUtcExclusive.toISOString()).toBe("2026-03-09T05:00:00.000Z");
    expect(w.horizonEndUtc.toISOString()).toBe("2026-03-16T05:00:00.000Z");
  });

  it("buckets the last CDT instant of today as due_today and CDT midnight as this week", () => {
    const beforeJump = candidate("2026-03-08T07:30:00Z"); // 01:30 CST, before now -> overdue
    const lastToday = candidate("2026-03-09T04:59:59Z"); // 23:59:59 CDT 03-08
    const tomorrowMidnight = candidate("2026-03-09T05:00:00Z"); // 00:00 CDT 03-09
    const horizonLast = candidate("2026-03-16T04:59:59Z"); // 23:59:59 CDT 03-15
    const horizonEnd = candidate("2026-03-16T05:00:00Z"); // 00:00 CDT 03-16 -> out
    const result = bucketAcademicAssignments({
      assignments: [horizonEnd, horizonLast, tomorrowMidnight, lastToday, beforeJump],
      effectiveNow,
      tz: TZ,
    });
    expect(ids(result.overdue)).toEqual([beforeJump.id]);
    expect(ids(result.dueToday)).toEqual([lastToday.id]);
    expect(ids(result.dueThisWeek)).toEqual([tomorrowMidnight.id, horizonLast.id]);
  });
});

describe("DST fall-back (America/Chicago, 2026-11-01: 25-hour local day)", () => {
  // 06:00 CST on 11-01 -- after the repeated hour.
  const effectiveNow = iso("2026-11-01T12:00:00Z");

  it("today's window is 05:00Z (CDT midnight) to 06:00Z next day (CST midnight)", () => {
    const w = academicTodayWindows(TZ, effectiveNow);
    expect(w.today.localDate).toBe("2026-11-01");
    expect(w.today.startUtc.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(w.today.endUtcExclusive.toISOString()).toBe("2026-11-02T06:00:00.000Z");
    expect(w.horizonEndUtc.toISOString()).toBe("2026-11-09T06:00:00.000Z");
  });

  it("the extra hour belongs to today and CST midnight starts tomorrow", () => {
    const firstOneAm = candidate("2026-11-01T06:30:00Z"); // 01:30 CDT (first pass) -> overdue
    const secondOneAm = candidate("2026-11-01T07:30:00Z"); // 01:30 CST (second pass) -> overdue
    const lastToday = candidate("2026-11-02T05:59:59Z"); // 23:59:59 CST 11-01
    const tomorrowMidnight = candidate("2026-11-02T06:00:00Z"); // 00:00 CST 11-02
    const horizonLast = candidate("2026-11-09T05:59:59Z"); // 23:59:59 CST 11-08
    const horizonEnd = candidate("2026-11-09T06:00:00Z"); // 00:00 CST 11-09 -> out
    const result = bucketAcademicAssignments({
      assignments: [horizonEnd, horizonLast, tomorrowMidnight, lastToday, secondOneAm, firstOneAm],
      effectiveNow,
      tz: TZ,
    });
    expect(ids(result.overdue)).toEqual([firstOneAm.id, secondOneAm.id]);
    expect(ids(result.dueToday)).toEqual([lastToday.id]);
    expect(ids(result.dueThisWeek)).toEqual([tomorrowMidnight.id, horizonLast.id]);
  });
});
