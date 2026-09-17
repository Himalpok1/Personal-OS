import { describe, expect, it } from "vitest";
import {
  FREE_BLOCK_DAY_END_HOUR,
  FREE_BLOCK_DAY_START_HOUR,
  FREE_BLOCK_MIN_MINUTES,
  freeBlocks,
  isValidFreeBlockWindow,
  type FreeBlockEventInput,
} from "./free-blocks.js";
import { memoryWorkingHours } from "../memory/match.js";

const TZ = "America/Chicago";
const iso = (value: string): Date => new Date(value);
const HOUR = 60 * 60 * 1000;
// The shared fixture: 2026-09-16 14:00 CDT. Today's working window is
// 08:00–22:00 CDT = 13:00Z–03:00Z(+1); from effectiveNow it is 19:00Z–03:00Z.
const NOW = iso("2026-09-16T19:00:00Z");
const plus = (ms: number): Date => new Date(NOW.getTime() + ms);
const END = iso("2026-09-17T03:00:00Z");

function event(overrides: Partial<FreeBlockEventInput> = {}): FreeBlockEventInput {
  return { startsAt: null, endsAt: null, allDay: false, ...overrides };
}

const timed = (start: Date, end: Date): FreeBlockEventInput =>
  event({ startsAt: start, endsAt: end });

describe("freeBlocks -- the window", () => {
  it("exports the documented defaults", () => {
    expect(FREE_BLOCK_DAY_START_HOUR).toBe(8);
    expect(FREE_BLOCK_DAY_END_HOUR).toBe(22);
    expect(FREE_BLOCK_MIN_MINUTES).toBe(60);
  });

  it("is one block from effectiveNow to 22:00 local when there are no events", () => {
    expect(freeBlocks({ events: [], effectiveNow: NOW, tz: TZ })).toEqual([
      { startUtc: NOW, endUtc: END, minutes: 8 * 60 },
    ]);
  });

  it("starts at 08:00 local, not effectiveNow, when effectiveNow is earlier", () => {
    const early = iso("2026-09-16T10:00:00Z"); // 05:00 CDT
    expect(freeBlocks({ events: [], effectiveNow: early, tz: TZ })).toEqual([
      { startUtc: iso("2026-09-16T13:00:00Z"), endUtc: END, minutes: 14 * 60 },
    ]);
  });

  it("is empty once effectiveNow is at or past 22:00 local", () => {
    expect(freeBlocks({ events: [], effectiveNow: END, tz: TZ })).toEqual([]);
    expect(
      freeBlocks({ events: [], effectiveNow: new Date(END.getTime() + HOUR), tz: TZ }),
    ).toEqual([]);
  });

  it("honours custom hours, with 24 meaning the end of the local day", () => {
    expect(
      freeBlocks({ events: [], effectiveNow: NOW, tz: TZ, dayStartHour: 0, dayEndHour: 24 }),
    ).toEqual([{ startUtc: NOW, endUtc: iso("2026-09-17T05:00:00Z"), minutes: 10 * 60 }]);
  });

  it("rejects an invalid hour pair as a programmer error", () => {
    expect(() => freeBlocks({ events: [], effectiveNow: NOW, tz: TZ, dayStartHour: 25 })).toThrow(
      RangeError,
    );
    expect(() =>
      freeBlocks({ events: [], effectiveNow: NOW, tz: TZ, dayStartHour: 9, dayEndHour: 9 }),
    ).toThrow(RangeError);
    expect(() => freeBlocks({ events: [], effectiveNow: NOW, tz: TZ, dayEndHour: 8.5 })).toThrow(
      RangeError,
    );
  });
});

describe("freeBlocks -- DST (wall clock is the invariant)", () => {
  it("fall-back day 2026-11-01: 08:00–22:00 CST is still 14h, not 15h", () => {
    const early = iso("2026-11-01T05:30:00Z"); // 00:30 CDT, before the transition
    const blocks = freeBlocks({ events: [], effectiveNow: early, tz: TZ });
    expect(blocks).toEqual([
      {
        startUtc: iso("2026-11-01T14:00:00Z"), // 08:00 CST
        endUtc: iso("2026-11-02T04:00:00Z"), // 22:00 CST
        minutes: 14 * 60,
      },
    ]);
  });

  it("fall-back day: the whole local day (0–24) is 25h", () => {
    const early = iso("2026-11-01T05:30:00Z");
    const blocks = freeBlocks({
      events: [],
      effectiveNow: iso("2026-11-01T05:00:00Z"), // 00:00 CDT exactly
      tz: TZ,
      dayStartHour: 0,
      dayEndHour: 24,
    });
    expect(blocks).toEqual([
      {
        startUtc: iso("2026-11-01T05:00:00Z"),
        endUtc: iso("2026-11-02T06:00:00Z"),
        minutes: 25 * 60,
      },
    ]);
    expect(early.getTime()).toBeGreaterThan(blocks[0]!.startUtc.getTime());
  });

  it("spring-forward day 2026-03-08: 08:00–22:00 CDT is 14h, and the missing hour is before the window", () => {
    const early = iso("2026-03-08T07:30:00Z"); // 01:30 CST, before the 02:00 jump
    expect(freeBlocks({ events: [], effectiveNow: early, tz: TZ })).toEqual([
      {
        startUtc: iso("2026-03-08T13:00:00Z"), // 08:00 CDT
        endUtc: iso("2026-03-09T03:00:00Z"), // 22:00 CDT
        minutes: 14 * 60,
      },
    ]);
    expect(
      freeBlocks({ events: [], effectiveNow: early, tz: TZ, dayStartHour: 0, dayEndHour: 24 }),
    ).toEqual([{ startUtc: early, endUtc: iso("2026-03-09T05:00:00Z"), minutes: 21 * 60 + 30 }]);
  });

  it("works in a zone east of UTC with a negative-looking day boundary", () => {
    const tokyoNow = iso("2026-09-16T05:00:00Z"); // 14:00 JST
    expect(freeBlocks({ events: [], effectiveNow: tokyoNow, tz: "Asia/Tokyo" })).toEqual([
      { startUtc: tokyoNow, endUtc: iso("2026-09-16T13:00:00Z"), minutes: 8 * 60 },
    ]);
  });
});

describe("freeBlocks -- subtracting events", () => {
  it("splits the window around a timed event", () => {
    const blocks = freeBlocks({
      events: [timed(plus(2 * HOUR), plus(3 * HOUR))],
      effectiveNow: NOW,
      tz: TZ,
    });
    expect(blocks).toEqual([
      { startUtc: NOW, endUtc: plus(2 * HOUR), minutes: 120 },
      { startUtc: plus(3 * HOUR), endUtc: END, minutes: 300 },
    ]);
  });

  it("ignores all-day events and rows missing either instant", () => {
    const blocks = freeBlocks({
      events: [
        event({ allDay: true, startsAt: plus(HOUR), endsAt: plus(2 * HOUR) }),
        event({ startsAt: plus(HOUR), endsAt: null }),
        event({ startsAt: null, endsAt: plus(2 * HOUR) }),
        event({ startsAt: plus(3 * HOUR), endsAt: plus(2 * HOUR) }), // inverted
      ],
      effectiveNow: NOW,
      tz: TZ,
    });
    expect(blocks).toEqual([{ startUtc: NOW, endUtc: END, minutes: 480 }]);
  });

  it("truncates the start for an event that began before the window and is still running", () => {
    const blocks = freeBlocks({
      events: [timed(plus(-2 * HOUR), plus(HOUR))],
      effectiveNow: NOW,
      tz: TZ,
    });
    expect(blocks).toEqual([{ startUtc: plus(HOUR), endUtc: END, minutes: 420 }]);
  });

  it("truncates the end for an event that runs past 22:00 and drops events wholly outside", () => {
    const blocks = freeBlocks({
      events: [
        timed(plus(7 * HOUR), plus(12 * HOUR)), // 21:00–02:00
        timed(plus(-6 * HOUR), plus(-5 * HOUR)), // this morning, over
        timed(plus(30 * HOUR), plus(31 * HOUR)), // tomorrow
      ],
      effectiveNow: NOW,
      tz: TZ,
    });
    expect(blocks).toEqual([{ startUtc: NOW, endUtc: plus(7 * HOUR), minutes: 420 }]);
  });

  it("merges overlapping and touching events into one busy span", () => {
    const blocks = freeBlocks({
      events: [
        timed(plus(HOUR), plus(2 * HOUR)),
        timed(plus(1.5 * HOUR), plus(3 * HOUR)),
        timed(plus(3 * HOUR), plus(4 * HOUR)), // touches
        timed(plus(2 * HOUR), plus(2.5 * HOUR)), // contained
      ],
      effectiveNow: NOW,
      tz: TZ,
    });
    expect(blocks).toEqual([
      { startUtc: NOW, endUtc: plus(HOUR), minutes: 60 },
      { startUtc: plus(4 * HOUR), endUtc: END, minutes: 240 },
    ]);
  });

  it("drops gaps shorter than minMinutes (whole minutes, floored) and honours a custom minimum", () => {
    const events = [timed(plus(59 * 60 * 1000 + 30 * 1000), plus(2 * HOUR))]; // 59.5 min gap first
    expect(freeBlocks({ events, effectiveNow: NOW, tz: TZ })).toEqual([
      { startUtc: plus(2 * HOUR), endUtc: END, minutes: 360 },
    ]);
    expect(freeBlocks({ events, effectiveNow: NOW, tz: TZ, minMinutes: 30 })).toEqual([
      { startUtc: NOW, endUtc: events[0]!.startsAt, minutes: 59 },
      { startUtc: plus(2 * HOUR), endUtc: END, minutes: 360 },
    ]);
  });

  it("is deterministic regardless of the events' input order and never mutates them", () => {
    const a = timed(plus(HOUR), plus(2 * HOUR));
    const b = timed(plus(4 * HOUR), plus(5 * HOUR));
    const snapshot = structuredClone([a, b]);
    const forward = freeBlocks({ events: [a, b], effectiveNow: NOW, tz: TZ });
    const reversed = freeBlocks({ events: [b, a], effectiveNow: NOW, tz: TZ });
    expect(forward).toEqual(reversed);
    expect(forward).toHaveLength(3);
    expect([a, b]).toEqual(snapshot);
  });

  it("returns [] when events fill the whole window", () => {
    expect(
      freeBlocks({ events: [timed(plus(-HOUR), plus(20 * HOUR))], effectiveNow: NOW, tz: TZ }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint 10.7 (ADR-077 §5): a working-hours preference memory as the bounds
// ---------------------------------------------------------------------------

describe("freeBlocks -- memory working hours through the existing bounds", () => {
  const hours = memoryWorkingHours(
    [
      {
        id: "w",
        kind: "preference",
        statement: "Working hours 9-18",
        projectId: null,
        canvasCourseId: null,
      },
    ],
    { enabled: true },
  );

  it("memoryWorkingHours' result is a pair freeBlocks accepts, and it narrows the window", () => {
    expect(hours).toEqual({ dayStartHour: 9, dayEndHour: 18 });
    expect(isValidFreeBlockWindow(hours!.dayStartHour, hours!.dayEndHour)).toBe(true);
    // 14:00 CDT now; 18:00 CDT = 23:00Z.
    expect(freeBlocks({ events: [], effectiveNow: NOW, tz: TZ, ...hours })).toEqual([
      { startUtc: NOW, endUtc: iso("2026-09-16T23:00:00Z"), minutes: 4 * 60 },
    ]);
    // Past the owner's 18:00 but before the 22:00 default: no block under the memory bounds.
    expect(
      freeBlocks({ events: [], effectiveNow: iso("2026-09-16T23:30:00Z"), tz: TZ, ...hours }),
    ).toEqual([]);
  });

  it("fall-back day 2026-11-01: 09:00–18:00 CST under memory bounds is still 9h, on the wall clock", () => {
    const early = iso("2026-11-01T05:30:00Z"); // 00:30 CDT
    expect(freeBlocks({ events: [], effectiveNow: early, tz: TZ, ...hours })).toEqual([
      {
        startUtc: iso("2026-11-01T15:00:00Z"), // 09:00 CST (after the fall-back)
        endUtc: iso("2026-11-02T00:00:00Z"), // 18:00 CST
        minutes: 9 * 60,
      },
    ]);
  });

  it("spring-forward day 2026-03-08: 09:00–18:00 CDT under memory bounds is 9h", () => {
    const early = iso("2026-03-08T07:30:00Z"); // 01:30 CST, before the 02:00 jump
    expect(freeBlocks({ events: [], effectiveNow: early, tz: TZ, ...hours })).toEqual([
      {
        startUtc: iso("2026-03-08T14:00:00Z"), // 09:00 CDT
        endUtc: iso("2026-03-08T23:00:00Z"), // 18:00 CDT
        minutes: 9 * 60,
      },
    ]);
  });

  it("isValidFreeBlockWindow mirrors freeBlocks' own acceptance", () => {
    expect(isValidFreeBlockWindow(0, 24)).toBe(true);
    expect(isValidFreeBlockWindow(8, 22)).toBe(true);
    expect(isValidFreeBlockWindow(9, 9)).toBe(false);
    expect(isValidFreeBlockWindow(18, 9)).toBe(false);
    expect(isValidFreeBlockWindow(-1, 9)).toBe(false);
    expect(isValidFreeBlockWindow(9, 25)).toBe(false);
    expect(isValidFreeBlockWindow(8.5, 22)).toBe(false);
    expect(isValidFreeBlockWindow(Number.NaN, 22)).toBe(false);
  });
});
