import { describe, expect, it } from "vitest";
import { academicTodayWindows } from "./buckets.js";
import {
  academicPointsAtStake,
  academicWorkloadDays,
  type AcademicWorkloadCandidate,
} from "./workload.js";

const TZ = "America/Chicago";
const iso = (value: string): Date => new Date(value);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// 2026-09-16 14:00 CDT (the bucket tests' fixture).
const NOW = iso("2026-09-16T19:00:00Z");
const plus = (ms: number): Date => new Date(NOW.getTime() + ms);

function candidate(
  dueAt: string | Date | null,
  overrides: Partial<AcademicWorkloadCandidate> = {},
): AcademicWorkloadCandidate {
  return {
    dueAt: dueAt === null ? null : typeof dueAt === "string" ? iso(dueAt) : dueAt,
    open: true,
    pointsPossible: 10,
    ...overrides,
  };
}

describe("academicWorkloadDays", () => {
  it("returns today plus the 7 following local days, in order, zero-filled, for no input", () => {
    const days = academicWorkloadDays({ assignments: [], effectiveNow: NOW, tz: TZ });
    expect(days).toEqual([
      { date: "2026-09-16", dueTotal: 0, pointsTotal: 0 },
      { date: "2026-09-17", dueTotal: 0, pointsTotal: 0 },
      { date: "2026-09-18", dueTotal: 0, pointsTotal: 0 },
      { date: "2026-09-19", dueTotal: 0, pointsTotal: 0 },
      { date: "2026-09-20", dueTotal: 0, pointsTotal: 0 },
      { date: "2026-09-21", dueTotal: 0, pointsTotal: 0 },
      { date: "2026-09-22", dueTotal: 0, pointsTotal: 0 },
      { date: "2026-09-23", dueTotal: 0, pointsTotal: 0 },
    ]);
  });

  it("honours a caller-supplied upcoming day count", () => {
    const days = academicWorkloadDays({
      assignments: [],
      effectiveNow: NOW,
      tz: TZ,
      upcomingDayCount: 2,
    });
    expect(days.map((d) => d.date)).toEqual(["2026-09-16", "2026-09-17", "2026-09-18"]);
  });

  it("counts an open dated assignment on the local day its due instant falls in, summing points", () => {
    const days = academicWorkloadDays({
      assignments: [
        candidate("2026-09-16T23:00:00Z", { pointsPossible: 10 }), // 18:00 CDT today
        candidate("2026-09-17T04:59:59.999Z", { pointsPossible: 5 }), // 23:59:59.999 CDT today
        candidate("2026-09-17T05:00:00Z", { pointsPossible: 100 }), // 00:00 CDT tomorrow
        candidate("2026-09-20T12:00:00Z", { pointsPossible: null }), // null points count 0
        candidate("2026-09-24T04:59:59Z", { pointsPossible: 7 }), // last instant of day +7
      ],
      effectiveNow: NOW,
      tz: TZ,
    });
    expect(days[0]).toEqual({ date: "2026-09-16", dueTotal: 2, pointsTotal: 15 });
    expect(days[1]).toEqual({ date: "2026-09-17", dueTotal: 1, pointsTotal: 100 });
    expect(days[4]).toEqual({ date: "2026-09-20", dueTotal: 1, pointsTotal: 0 });
    expect(days[7]).toEqual({ date: "2026-09-23", dueTotal: 1, pointsTotal: 7 });
    expect(days.reduce((n, d) => n + d.dueTotal, 0)).toBe(5);
  });

  it("puts an item overdue EARLIER TODAY on today's entry, and an earlier-day overdue on none", () => {
    const days = academicWorkloadDays({
      assignments: [
        candidate("2026-09-16T14:00:00Z"), // 09:00 CDT today, already overdue at 14:00
        candidate("2026-09-16T05:00:00Z"), // 00:00 CDT today (first instant)
        candidate("2026-09-16T04:59:59Z"), // 23:59:59 CDT yesterday -> not represented
        candidate("2026-09-01T12:00:00Z"),
      ],
      effectiveNow: NOW,
      tz: TZ,
    });
    expect(days[0]).toEqual({ date: "2026-09-16", dueTotal: 2, pointsTotal: 20 });
    expect(days.reduce((n, d) => n + d.dueTotal, 0)).toBe(2);
  });

  it("ignores closed, undated, and beyond-horizon assignments", () => {
    const days = academicWorkloadDays({
      assignments: [
        candidate("2026-09-17T12:00:00Z", { open: false }),
        candidate(null),
        candidate("2026-09-24T05:00:00Z"), // start of day +8 -> out
        candidate(plus(60 * DAY)),
      ],
      effectiveNow: NOW,
      tz: TZ,
    });
    expect(days.every((d) => d.dueTotal === 0 && d.pointsTotal === 0)).toBe(true);
  });

  it("uses the same boundaries as academicTodayWindows, so the last entry ends at the horizon", () => {
    const { today, horizonEndUtc } = academicTodayWindows(TZ, NOW);
    const justInside = candidate(new Date(horizonEndUtc.getTime() - 1));
    const atHorizon = candidate(horizonEndUtc);
    const days = academicWorkloadDays({
      assignments: [justInside, atHorizon],
      effectiveNow: NOW,
      tz: TZ,
    });
    expect(days[0]!.date).toBe(today.localDate);
    expect(days[7]!.dueTotal).toBe(1);
    expect(days.reduce((n, d) => n + d.dueTotal, 0)).toBe(1);
  });

  it("does not mutate the caller's array", () => {
    const list = [candidate("2026-09-17T12:00:00Z"), candidate("2026-09-18T12:00:00Z")];
    const snapshot = list.map((c) => ({ ...c }));
    academicWorkloadDays({ assignments: list, effectiveNow: NOW, tz: TZ });
    expect(list).toEqual(snapshot);
  });

  it("spring-forward: the 23-hour day is one entry and its neighbours are placed by local date", () => {
    // 07:00 CDT on 2026-03-08 (after the jump); today is [06:00Z, 05:00Z next day).
    const now = iso("2026-03-08T12:00:00Z");
    const days = academicWorkloadDays({
      assignments: [
        candidate("2026-03-08T06:00:00Z"), // 00:00 CST today (first instant)
        candidate("2026-03-08T07:30:00Z"), // 01:30 CST today (before the jump)
        candidate("2026-03-09T04:59:59Z"), // 23:59:59 CDT today
        candidate("2026-03-09T05:00:00Z"), // 00:00 CDT tomorrow
        candidate("2026-03-16T04:59:59Z"), // last instant of day +7
        candidate("2026-03-16T05:00:00Z"), // day +8 -> out
      ],
      effectiveNow: now,
      tz: TZ,
    });
    expect(days.map((d) => d.date)).toEqual([
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
    ]);
    expect(days[0]!.dueTotal).toBe(3);
    expect(days[1]!.dueTotal).toBe(1);
    expect(days[7]!.dueTotal).toBe(1);
    expect(days.reduce((n, d) => n + d.dueTotal, 0)).toBe(5);
  });

  it("fall-back: both passes of the repeated hour belong to the 25-hour day", () => {
    // 06:00 CST on 2026-11-01; today is [05:00Z, 06:00Z next day).
    const now = iso("2026-11-01T12:00:00Z");
    const days = academicWorkloadDays({
      assignments: [
        candidate("2026-11-01T06:30:00Z"), // 01:30 CDT (first pass)
        candidate("2026-11-01T07:30:00Z"), // 01:30 CST (second pass)
        candidate("2026-11-02T05:59:59Z"), // 23:59:59 CST today
        candidate("2026-11-02T06:00:00Z"), // 00:00 CST tomorrow
        candidate("2026-11-09T05:59:59Z"), // last instant of day +7
        candidate("2026-11-09T06:00:00Z"), // day +8 -> out
      ],
      effectiveNow: now,
      tz: TZ,
    });
    expect(days[0]).toEqual({ date: "2026-11-01", dueTotal: 3, pointsTotal: 30 });
    expect(days[1]).toEqual({ date: "2026-11-02", dueTotal: 1, pointsTotal: 10 });
    expect(days[7]).toEqual({ date: "2026-11-08", dueTotal: 1, pointsTotal: 10 });
    expect(days.reduce((n, d) => n + d.dueTotal, 0)).toBe(5);
  });
});

describe("academicPointsAtStake", () => {
  const { horizonEndUtc } = academicTodayWindows(TZ, NOW);

  it("sums points over open assignments due from now (inclusive) to the horizon end (exclusive)", () => {
    const total = academicPointsAtStake(
      [
        candidate(NOW, { pointsPossible: 1 }), // at now -> in
        candidate(plus(-1), { pointsPossible: 1000 }), // overdue -> out
        candidate(plus(3 * HOUR), { pointsPossible: 20 }),
        candidate(plus(3 * DAY), { pointsPossible: 30 }),
        candidate(plus(3 * DAY), { pointsPossible: null }), // null counts 0
        candidate(new Date(horizonEndUtc.getTime() - 1), { pointsPossible: 4 }),
        candidate(horizonEndUtc, { pointsPossible: 1000 }), // at the horizon -> out
        candidate(plus(2 * DAY), { pointsPossible: 1000, open: false }), // closed -> out
        candidate(null, { pointsPossible: 1000 }), // undated -> out
      ],
      NOW,
      horizonEndUtc,
    );
    expect(total).toBe(55);
  });

  it("is 0 for no input", () => {
    expect(academicPointsAtStake([], NOW, horizonEndUtc)).toBe(0);
  });
});
