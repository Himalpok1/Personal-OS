import { describe, expect, it } from "vitest";
import { toWallClockComponents } from "./timezone.js";
import {
  buildActionableView,
  captureEffectiveNow,
  categorizeInstant,
  localDayWindow,
  localDayWindowForDate,
} from "./actionability.js";

const iso = (value: string): Date => new Date(value);

const HOUR_MS = 60 * 60 * 1000;

function formatLocalDate(instant: Date, timezone: string): string {
  const c = toWallClockComponents(instant, timezone);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(c.year).padStart(4, "0")}-${pad(c.month)}-${pad(c.day)}`;
}

describe("localDayWindow", () => {
  it("returns the window of the local day containing the given instant", () => {
    const window = localDayWindow("America/Chicago", iso("2026-07-10T15:00:00Z"));
    expect(window.localDate).toBe("2026-07-10");
    expect(window.timezone).toBe("America/Chicago");
    expect(window.startUtc.toISOString()).toBe("2026-07-10T05:00:00.000Z");
    expect(window.endUtcExclusive.toISOString()).toBe("2026-07-11T05:00:00.000Z");
  });

  it("defaults to capturing now and still yields a coherent 23-25h window", () => {
    const window = localDayWindow("America/Chicago");
    const duration = window.endUtcExclusive.getTime() - window.startUtc.getTime();
    expect(duration).toBeGreaterThanOrEqual(23 * HOUR_MS);
    expect(duration).toBeLessThanOrEqual(25 * HOUR_MS);
    expect(formatLocalDate(window.startUtc, window.timezone)).toBe(window.localDate);
  });

  it("rejects malformed local dates in localDayWindowForDate", () => {
    expect(() => localDayWindowForDate("America/Chicago", "2026-7-10")).toThrow();
    expect(() => localDayWindowForDate("America/Chicago", "not-a-date")).toThrow();
  });
});

describe("nonexistent local midnight (America/Santiago spring-forward at 00:00)", () => {
  // Santiago springs forward 2026-09-06 at midnight: 23:59:59 -04 -> 01:00 -03,
  // so literal midnight resolves to an instant that still renders Sep 5.
  const window = localDayWindowForDate("America/Santiago", "2026-09-06");

  it("start and end render back inside the requested local date", () => {
    expect(formatLocalDate(window.startUtc, "America/Santiago")).toBe("2026-09-06");
    const lastInstant = new Date(window.endUtcExclusive.getTime() - 1);
    expect(formatLocalDate(lastInstant, "America/Santiago")).toBe("2026-09-06");
    expect(formatLocalDate(window.endUtcExclusive, "America/Santiago")).toBe("2026-09-07");
  });

  it("buckets a still-Sep-5 instant as NOT due_today for the Sep 6 window", () => {
    // 2026-09-06T03:00Z is the broken literal-midnight resolution; it renders
    // as 2026-09-05 23:00 (-04) and must not fall inside Sep 6's window.
    const stillPreviousDay = iso("2026-09-06T03:00:00Z");
    const result = categorizeInstant({
      instant: stillPreviousDay,
      effectiveNow: iso("2026-09-01T12:00:00Z"),
      window,
    });
    expect(result).toBe("upcoming");
  });

  it("keeps a 24h-class window duration through the corrected edges", () => {
    const duration = window.endUtcExclusive.getTime() - window.startUtc.getTime();
    expect(duration).toBeGreaterThanOrEqual(23 * HOUR_MS);
    expect(duration).toBeLessThanOrEqual(25 * HOUR_MS);
  });
});

describe("DST fall-back window (America/Chicago, 2026-11-01)", () => {
  const window = localDayWindowForDate("America/Chicago", "2026-11-01");

  it("resolves midnight edges to CDT then CST, spanning exactly 25 hours", () => {
    // Midnight opening the day is CDT (UTC-5); midnight opening the next day
    // is CST (UTC-6). The 25h span verifies the offset change numerically.
    expect(window.localDate).toBe("2026-11-01");
    expect(window.startUtc.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(window.endUtcExclusive.toISOString()).toBe("2026-11-02T06:00:00.000Z");
    const duration = window.endUtcExclusive.getTime() - window.startUtc.getTime();
    expect(duration).toBe(25 * HOUR_MS);
    expect(toWallClockComponents(window.startUtc, "America/Chicago")).toMatchObject({
      month: 11,
      day: 1,
      hour: 0,
    });
    expect(toWallClockComponents(window.endUtcExclusive, "America/Chicago")).toMatchObject({
      month: 11,
      day: 2,
      hour: 0,
    });
  });

  it("categorizes early-local and late-local instants across the transition correctly", () => {
    // effectiveNow 06:00 CST mid-morning; early instant is pre-fall-back CDT.
    const effectiveNow = iso("2026-11-01T12:00:00Z");
    expect(categorizeInstant({ instant: iso("2026-11-01T05:30:00Z"), effectiveNow, window })).toBe(
      "overdue",
    ); // 00:30 CDT, earlier this morning
    expect(categorizeInstant({ instant: iso("2026-11-01T06:30:00Z"), effectiveNow, window })).toBe(
      "overdue",
    ); // ambiguous 01:30, resolved to its first (CDT) pass
    expect(categorizeInstant({ instant: iso("2026-11-02T05:30:00Z"), effectiveNow, window })).toBe(
      "due_today",
    ); // 23:30 CST, still the same long local day
    expect(categorizeInstant({ instant: iso("2026-11-02T06:00:00Z"), effectiveNow, window })).toBe(
      "upcoming",
    ); // next day's midnight, exclusive edge
  });
});

describe("DST spring-forward window (America/Chicago, 2026-03-08)", () => {
  const window = localDayWindowForDate("America/Chicago", "2026-03-08");

  it("resolves midnight edges to CST then CDT, spanning exactly 23 hours", () => {
    expect(window.localDate).toBe("2026-03-08");
    expect(window.startUtc.toISOString()).toBe("2026-03-08T06:00:00.000Z");
    expect(window.endUtcExclusive.toISOString()).toBe("2026-03-09T05:00:00.000Z");
    const duration = window.endUtcExclusive.getTime() - window.startUtc.getTime();
    expect(duration).toBe(23 * HOUR_MS);
    expect(toWallClockComponents(window.startUtc, "America/Chicago")).toMatchObject({
      month: 3,
      day: 8,
      hour: 0,
    });
    expect(toWallClockComponents(window.endUtcExclusive, "America/Chicago")).toMatchObject({
      month: 3,
      day: 9,
      hour: 0,
    });
  });

  it("categorizes early-local and late-local instants across the transition correctly", () => {
    const effectiveNow = iso("2026-03-08T14:00:00Z"); // 08:00 CST
    expect(categorizeInstant({ instant: iso("2026-03-08T06:30:00Z"), effectiveNow, window })).toBe(
      "overdue",
    ); // 00:30 CST, earlier this morning
    expect(categorizeInstant({ instant: iso("2026-03-08T07:30:00Z"), effectiveNow, window })).toBe(
      "overdue",
    ); // nonexistent 02:30, resolves deterministically post-transition
    expect(categorizeInstant({ instant: iso("2026-03-09T04:30:00Z"), effectiveNow, window })).toBe(
      "due_today",
    ); // 23:30 CDT, same short local day
  });
});

describe("categorizeInstant frozen rules", () => {
  const window = localDayWindowForDate("America/Chicago", "2026-07-10");
  // 10:00 CDT.
  const effectiveNow = iso("2026-07-10T15:00:00Z");

  it("marks an earlier-today instant overdue even though it sits inside today's window", () => {
    expect(categorizeInstant({ instant: iso("2026-07-10T14:00:00Z"), effectiveNow, window })).toBe(
      "overdue",
    );
  });

  it("marks a later-today instant due_today, never overdue", () => {
    expect(categorizeInstant({ instant: iso("2026-07-10T16:00:00Z"), effectiveNow, window })).toBe(
      "due_today",
    );
  });

  it("marks an instant equal to effectiveNow due_today, not overdue (strict < rule)", () => {
    // Frozen rule: overdue ⟺ instant < effectiveNow. At exact equality the
    // item flips to due_today; one millisecond later it would be overdue.
    expect(categorizeInstant({ instant: effectiveNow, effectiveNow, window })).toBe("due_today");
  });

  it("marks window start due_today when now <= start, overdue otherwise", () => {
    expect(
      categorizeInstant({ instant: window.startUtc, effectiveNow: window.startUtc, window }),
    ).toBe("due_today");
    expect(categorizeInstant({ instant: window.startUtc, effectiveNow, window })).toBe("overdue");
  });

  it("never treats the exclusive end as part of today's window", () => {
    expect(categorizeInstant({ instant: window.endUtcExclusive, effectiveNow, window })).toBe(
      "upcoming",
    );
  });

  it("marks past days overdue and future days upcoming", () => {
    expect(categorizeInstant({ instant: iso("2026-07-09T20:00:00Z"), effectiveNow, window })).toBe(
      "overdue",
    );
    expect(categorizeInstant({ instant: iso("2026-07-12T18:00:00Z"), effectiveNow, window })).toBe(
      "upcoming",
    );
  });
});

describe("bucketing follows the requested window, not the item's stored timezone", () => {
  const effectiveNow = iso("2026-08-20T20:30:00Z"); // 15:30 CDT / 08:30 NZST next day

  it("shows the same instant on different local calendar dates across zones", () => {
    const instant = iso("2026-08-21T02:00:00Z");
    expect(formatLocalDate(instant, "America/Chicago")).toBe("2026-08-20");
    expect(formatLocalDate(instant, "Pacific/Auckland")).toBe("2026-08-21");
  });

  it("buckets by the requested Chicago day even when Auckland's calendar disagrees", () => {
    const requestedWindow = localDayWindow("America/Chicago", effectiveNow);
    expect(requestedWindow.localDate).toBe("2026-08-20");
    // 2026-08-21 14:00 in Auckland -- already "tomorrow" there -- but still
    // 2026-08-20 21:00 in the requested Chicago Today window.
    expect(
      categorizeInstant({
        instant: iso("2026-08-21T02:00:00Z"),
        effectiveNow,
        window: requestedWindow,
      }),
    ).toBe("due_today");
  });

  it("flips buckets for the same instant solely by switching the requested window", () => {
    const chicagoWindow = localDayWindow("America/Chicago", effectiveNow); // today = Aug 20
    const aucklandWindow = localDayWindow("Pacific/Auckland", effectiveNow); // today = Aug 21
    expect(aucklandWindow.localDate).toBe("2026-08-21");
    const instant = iso("2026-08-21T08:00:00Z"); // Aug 21 03:00 CDT / Aug 21 20:00 NZST
    expect(categorizeInstant({ instant, effectiveNow, window: chicagoWindow })).toBe("upcoming");
    expect(categorizeInstant({ instant, effectiveNow, window: aucklandWindow })).toBe("due_today");
  });
});

interface TestTask {
  id: string;
  recurring: boolean;
  instant: Date | null;
  mergedOccurrenceId?: string;
}

interface TestOcc {
  id: string;
  parentTaskId: string;
  occursAt: Date;
  status: "scheduled" | "done" | "skipped";
}

function adapters() {
  return {
    taskKey: (task: TestTask): string => task.id,
    occParentKey: (occ: TestOcc): string => occ.parentTaskId,
    occKey: (occ: TestOcc): string => occ.id,
    occStatus: (occ: TestOcc): TestOcc["status"] => occ.status,
    occOccursAt: (occ: TestOcc): Date => occ.occursAt,
    actionableInstantOfTask: (task: TestTask): Date | null => task.instant,
    mergeIntoOccurrence: (parent: TestTask, occ: TestOcc): TestTask => ({
      ...parent,
      mergedOccurrenceId: occ.id,
    }),
  };
}

describe("buildActionableView recurring dedupe", () => {
  // Window: America/Chicago 2026-07-10; effectiveNow 10:00 CDT.
  const window = localDayWindowForDate("America/Chicago", "2026-07-10");
  const effectiveNow = iso("2026-07-10T15:00:00Z");
  const baseParams = { effectiveNow, window };

  function build(
    tasks: TestTask[],
    occurrences: TestOcc[],
    extra: Partial<Parameters<typeof buildActionableView<TestTask, TestOcc>>[0]> = {},
  ) {
    return buildActionableView<TestTask, TestOcc>({
      ...baseParams,
      ...adapters(),
      tasks,
      occurrences,
      ...extra,
    });
  }

  it("emits scheduled occurrences as the only representations of their parent", () => {
    const parent: TestTask = { id: "R", recurring: true, instant: null };
    const view = build(
      [
        parent,
        { id: "N", recurring: false, instant: iso("2026-07-10T17:00:00Z") },
        { id: "F", recurring: false, instant: iso("2026-07-12T18:00:00Z") },
      ],
      [
        { id: "o1", parentTaskId: "R", occursAt: iso("2026-07-10T13:00:00Z"), status: "scheduled" }, // overdue
        { id: "o2", parentTaskId: "R", occursAt: iso("2026-07-10T18:00:00Z"), status: "scheduled" }, // due today
      ],
    );
    expect(view.overdue.map((t) => `${t.id}:${t.mergedOccurrenceId}`)).toEqual(["R:o1"]);
    expect(view.dueToday.map((t) => `${t.id}:${t.mergedOccurrenceId ?? "-"}`)).toEqual([
      "N:-",
      "R:o2",
    ]);
    expect(view.upcoming.map((t) => t.id)).toEqual(["F"]);
    // Exactly two rows carry the parent's id, each via a merged occurrence;
    // the bare parent never appears.
    const allRows = [...view.overdue, ...view.dueToday, ...view.upcoming];
    const parentRows = allRows.filter((t) => t.id === "R");
    expect(parentRows).toHaveLength(2);
    for (const row of parentRows) expect(row.mergedOccurrenceId).toBeDefined();
  });

  it("excludes done and skipped occurrences entirely", () => {
    const dueTodayRow: TestTask = { id: "R", recurring: true, instant: null };
    const view = build(
      [dueTodayRow],
      [
        { id: "done-1", parentTaskId: "R", occursAt: iso("2026-07-10T14:00:00Z"), status: "done" },
        {
          id: "skip-1",
          parentTaskId: "R",
          occursAt: iso("2026-07-10T16:00:00Z"),
          status: "skipped",
        },
      ],
    );
    // The occurrences themselves vanish; the parent is left with zero
    // scheduled occurrences and so surfaces once as itself (defensive rule).
    expect(view.overdue).toEqual([]);
    expect(view.upcoming).toEqual([]);
    // Emitted as itself -- the untouched parent object, not a merged copy.
    expect(view.dueToday[0]).toBe(dueTodayRow);
  });

  it("emits a recurring parent with zero scheduled occurrences once as itself", () => {
    const view = build(
      [{ id: "Z", recurring: true, instant: iso("2026-07-10T19:00:00Z") }],
      [
        {
          id: "skip-1",
          parentTaskId: "Z",
          occursAt: iso("2026-07-10T16:00:00Z"),
          status: "skipped",
        },
      ],
    );
    expect(view.overdue).toEqual([]);
    expect(view.upcoming).toEqual([]);
    expect(view.dueToday.map((t) => `${t.id}:${t.mergedOccurrenceId ?? ""}`)).toEqual(["Z:"]);
  });

  it("passes non-recurring tasks through unchanged", () => {
    const task: TestTask = { id: "N", recurring: false, instant: iso("2026-07-10T16:00:00Z") };
    const view = build([task], []);
    expect(view.dueToday).toEqual([task]);
  });

  it("suppresses the bare parent even when the parent is flagged non-recurring", () => {
    // Dedupe must not trust caller truthfulness: scheduled occurrences make
    // the occurrence the only actionable representation.
    const parent: TestTask = { id: "M", recurring: false, instant: null };
    const view = build(
      [parent],
      [{ id: "m1", parentTaskId: "M", occursAt: iso("2026-07-10T18:00:00Z"), status: "scheduled" }],
    );
    expect(view.dueToday.map((t) => `${t.id}:${t.mergedOccurrenceId ?? "-"}`)).toEqual(["M:m1"]);
  });

  it("emits exactly one representation per unique occurrence id", () => {
    const parent: TestTask = { id: "D", recurring: true, instant: null };
    const dup = (): TestOcc => ({
      id: "dup",
      parentTaskId: "D",
      occursAt: iso("2026-07-10T18:00:00Z"),
      status: "scheduled",
    });
    const view = build([parent], [dup(), dup()]);
    expect(view.dueToday).toHaveLength(1);
    expect(view.dueToday[0]?.mergedOccurrenceId).toBe("dup");
  });

  it("ignores scheduled occurrences whose parent task is not in this build", () => {
    const view = build(
      [],
      [
        {
          id: "o1",
          parentTaskId: "GHOST",
          occursAt: iso("2026-07-10T16:00:00Z"),
          status: "scheduled",
        },
      ],
    );
    expect(view.overdue).toEqual([]);
    expect(view.dueToday).toEqual([]);
    expect(view.upcoming).toEqual([]);
  });

  it("keeps upcoming disjoint from overdue and dueToday and sorts every section ascending", () => {
    const view = build(
      [
        { id: "b1", recurring: false, instant: iso("2026-07-10T13:00:00Z") },
        { id: "a1", recurring: false, instant: iso("2026-07-10T12:00:00Z") },
        { id: "d-tie", recurring: false, instant: iso("2026-07-10T14:00:00Z") },
        { id: "c-tie", recurring: false, instant: iso("2026-07-10T14:00:00Z") },
        { id: "m", recurring: false, instant: iso("2026-07-10T16:00:00Z") },
        { id: "z9", recurring: false, instant: null },
        { id: "a0", recurring: false, instant: null },
        { id: "f2", recurring: false, instant: iso("2026-07-12T00:00:00Z") },
        { id: "f1", recurring: false, instant: iso("2026-07-11T06:00:00Z") },
      ],
      [],
    );
    expect(view.overdue.map((t) => t.id)).toEqual(["a1", "b1", "c-tie", "d-tie"]);
    // Dated first ascending, then undated deterministically by taskKey.
    expect(view.dueToday.map((t) => t.id)).toEqual(["m", "a0", "z9"]);
    expect(view.upcoming.map((t) => t.id)).toEqual(["f1", "f2"]);
    const upcomingIds = new Set(view.upcoming.map((t) => t.id));
    for (const row of [...view.overdue, ...view.dueToday]) {
      expect(upcomingIds.has(row.id)).toBe(false);
    }
  });

  it("breaks occurrence time ties deterministically by occurrence key", () => {
    const view = build(
      [{ id: "P", recurring: true, instant: null }],
      [
        {
          id: "p-b",
          parentTaskId: "P",
          occursAt: iso("2026-07-10T18:00:00Z"),
          status: "scheduled",
        },
        {
          id: "p-a",
          parentTaskId: "P",
          occursAt: iso("2026-07-10T18:00:00Z"),
          status: "scheduled",
        },
        {
          id: "p-c",
          parentTaskId: "P",
          occursAt: iso("2026-07-10T17:00:00Z"),
          status: "scheduled",
        },
      ],
    );
    expect(view.dueToday.map((t) => t.mergedOccurrenceId)).toEqual(["p-c", "p-a", "p-b"]);
  });

  it("filters upcoming to the horizon when horizonEndUtc is provided", () => {
    const tasks: TestTask[] = [
      { id: "f1", recurring: false, instant: iso("2026-07-11T06:00:00Z") },
      { id: "f2", recurring: false, instant: iso("2026-07-12T00:00:00Z") },
    ];
    const unbounded = build(tasks, []);
    expect(unbounded.upcoming.map((t) => t.id)).toEqual(["f1", "f2"]);
    // f2 sits exactly on the horizon edge; the horizon is exclusive.
    const bounded = build(tasks, [], { horizonEndUtc: iso("2026-07-12T00:00:00Z") });
    expect(bounded.upcoming.map((t) => t.id)).toEqual(["f1"]);
  });
});

describe("captureEffectiveNow", () => {
  it("passes through the supplied instant", () => {
    const fixed = iso("2026-07-10T15:00:00Z");
    expect(captureEffectiveNow(fixed)).toBe(fixed);
  });

  it("captures the current instant when omitted, bounded by surrounding reads", () => {
    const before = Date.now();
    const captured = captureEffectiveNow();
    const after = Date.now();
    expect(captured.getTime()).toBeGreaterThanOrEqual(before);
    expect(captured.getTime()).toBeLessThanOrEqual(after);
  });
});
