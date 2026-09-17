import { describe, expect, it } from "vitest";
import {
  attentionCount,
  greetingForHour,
  greetingPeriod,
  hourFromInstant,
  importantThingsLine,
} from "./greeting";

describe("greetingPeriod / greetingForHour", () => {
  it("maps every hour of the day to its period", () => {
    const expected: Record<number, string> = {};
    for (let h = 0; h <= 4; h++) expected[h] = "night";
    for (let h = 5; h <= 11; h++) expected[h] = "morning";
    for (let h = 12; h <= 16; h++) expected[h] = "afternoon";
    for (let h = 17; h <= 21; h++) expected[h] = "evening";
    for (let h = 22; h <= 23; h++) expected[h] = "night";
    for (let h = 0; h < 24; h++) expect(greetingPeriod(h)).toBe(expected[h]);
  });

  it("pins the boundaries", () => {
    expect(greetingForHour(4)).toBe("Good night");
    expect(greetingForHour(5)).toBe("Good morning");
    expect(greetingForHour(11)).toBe("Good morning");
    expect(greetingForHour(12)).toBe("Good afternoon");
    expect(greetingForHour(16)).toBe("Good afternoon");
    expect(greetingForHour(17)).toBe("Good evening");
    expect(greetingForHour(21)).toBe("Good evening");
    expect(greetingForHour(22)).toBe("Good night");
    expect(greetingForHour(0)).toBe("Good night");
  });

  it("wraps an out-of-range hour and truncates a fractional one", () => {
    expect(greetingForHour(25)).toBe("Good night");
    expect(greetingForHour(29)).toBe("Good morning");
    expect(greetingForHour(-1)).toBe("Good night");
    expect(greetingForHour(9.9)).toBe("Good morning");
  });

  it("falls back to a neutral greeting when the hour is unreadable", () => {
    expect(greetingPeriod(Number.NaN)).toBeNull();
    expect(greetingForHour(Number.NaN)).toBe("Hello");
    expect(greetingForHour(Number.POSITIVE_INFINITY)).toBe("Hello");
  });
});

describe("hourFromInstant", () => {
  it("returns the device-local hour of a real instant", () => {
    const local = new Date(2026, 8, 16, 14, 30, 0, 0);
    expect(hourFromInstant(local.getTime())).toBe(14);
  });

  it("is NaN before the first fetch (React Query's dataUpdatedAt is 0) and for junk", () => {
    expect(hourFromInstant(0)).toBeNaN();
    expect(hourFromInstant(-5)).toBeNaN();
    expect(hourFromInstant(Number.NaN)).toBeNaN();
    expect(greetingForHour(hourFromInstant(0))).toBe("Hello");
  });
});

describe("importantThingsLine", () => {
  it("sums overdue, due today and inbox attention", () => {
    expect(attentionCount({ overdue_total: 2, due_today_total: 1, inbox_attention_total: 3 })).toBe(
      6,
    );
  });

  it("pluralizes honestly", () => {
    expect(
      importantThingsLine({ overdue_total: 0, due_today_total: 0, inbox_attention_total: 0 }),
    ).toBe("All clear for today");
    expect(
      importantThingsLine({ overdue_total: 1, due_today_total: 0, inbox_attention_total: 0 }),
    ).toBe("1 thing needs attention today");
    expect(
      importantThingsLine({ overdue_total: 2, due_today_total: 1, inbox_attention_total: 0 }),
    ).toBe("3 things need attention today");
  });
});
