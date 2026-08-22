import { describe, expect, it } from "vitest";
import {
  addLocalCalendarDays,
  addOneDayPreservingWallClock,
  defaultAgendaRange,
  filterNonEmptyDays,
  formatAgendaDayLabel,
} from "./agenda-grouping";

describe("addLocalCalendarDays", () => {
  it("rolls over a month boundary", () => {
    expect(addLocalCalendarDays("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("rolls over a year boundary", () => {
    expect(addLocalCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("supports negative offsets", () => {
    expect(addLocalCalendarDays("2027-01-01", -1)).toBe("2026-12-31");
  });
});

describe("defaultAgendaRange", () => {
  it("spans exactly 89 days forward (90 calendar days total, under the server's 90-day span cap)", () => {
    const { from, to } = defaultAgendaRange("2026-08-22");
    expect(from).toBe("2026-08-22");
    expect(to).toBe("2026-11-19");
  });

  it("rolls the range correctly across a year boundary", () => {
    const { from, to } = defaultAgendaRange("2026-12-10");
    expect(from).toBe("2026-12-10");
    expect(to).toBe("2027-03-09");
  });
});

describe("formatAgendaDayLabel", () => {
  it("labels the current local date as Today", () => {
    expect(formatAgendaDayLabel("2026-08-22", "2026-08-22")).toBe("Today");
  });

  it("labels the next local date as Tomorrow", () => {
    expect(formatAgendaDayLabel("2026-08-23", "2026-08-22")).toBe("Tomorrow");
  });

  it("labels Tomorrow correctly across a month boundary", () => {
    expect(formatAgendaDayLabel("2026-09-01", "2026-08-31")).toBe("Tomorrow");
  });

  it("labels Tomorrow correctly across a year boundary", () => {
    expect(formatAgendaDayLabel("2027-01-01", "2026-12-31")).toBe("Tomorrow");
  });

  it("falls back to a weekday+date label for any other day, computed via correct local-date parsing", () => {
    // 2026-08-26 is a Wednesday.
    const label = formatAgendaDayLabel("2026-08-26", "2026-08-22");
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Tomorrow");
    expect(label.toLowerCase()).toContain("wed");
  });

  it("does not mislabel a day one year out as Today/Tomorrow", () => {
    const label = formatAgendaDayLabel("2027-08-22", "2026-08-22");
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Tomorrow");
  });
});

describe("filterNonEmptyDays", () => {
  it("omits days with zero items and keeps days with at least one", () => {
    const days = [
      { date: "2026-08-22", items: [] as unknown[] },
      { date: "2026-08-23", items: [{ id: "1" }] },
      { date: "2026-08-24", items: [] as unknown[] },
    ];
    expect(filterNonEmptyDays(days).map((d) => d.date)).toEqual(["2026-08-23"]);
  });

  it("returns an empty array when every day is empty", () => {
    const days = [
      { date: "2026-08-22", items: [] as unknown[] },
      { date: "2026-08-23", items: [] as unknown[] },
    ];
    expect(filterNonEmptyDays(days)).toEqual([]);
  });
});

describe("addOneDayPreservingWallClock", () => {
  it("advances exactly one calendar day while preserving wall-clock time in a plain non-DST zone", () => {
    const result = addOneDayPreservingWallClock("2026-08-22T09:00:00-05:00", "America/Chicago");
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = Object.fromEntries(dtf.formatToParts(new Date(result)).map((p) => [p.type, p.value]));
    expect(`${parts.year}-${parts.month}-${parts.day}`).toBe("2026-08-23");
    expect(`${parts.hour}:${parts.minute}`).toBe("09:00");
  });

  it("rolls a month boundary correctly", () => {
    const result = addOneDayPreservingWallClock("2026-08-31T09:00:00-05:00", "America/Chicago");
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(dtf.formatToParts(new Date(result)).map((p) => [p.type, p.value]));
    expect(`${parts.year}-${parts.month}-${parts.day}`).toBe("2026-09-01");
  });

  it("preserves the 09:00 wall-clock time across the America/Chicago fall-back DST boundary (2026-11-01)", () => {
    // Oct 31 2026 09:00 CDT (-05:00) -> Nov 1 2026 09:00 CST (-06:00).
    // The UTC offset must shift by exactly one hour while the *local*
    // wall-clock hour stays 09:00 -- this is the exact scenario
    // docs/ARCHITECTURE.md's recurrence section calls out and
    // packages/core's own DST tests use the same reference dates.
    const result = addOneDayPreservingWallClock("2026-10-31T09:00:00-05:00", "America/Chicago");
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = Object.fromEntries(dtf.formatToParts(new Date(result)).map((p) => [p.type, p.value]));
    expect(`${parts.year}-${parts.month}-${parts.day}`).toBe("2026-11-01");
    expect(`${parts.hour}:${parts.minute}`).toBe("09:00");
    // The UTC instant itself must reflect the new -06:00 (CST) offset, not
    // a naive same-offset +24h shift.
    expect(result).toBe(new Date("2026-11-01T15:00:00.000Z").toISOString());
  });
});
