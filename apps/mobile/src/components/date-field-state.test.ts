import { describe, expect, it } from "vitest";
import {
  formatDateFieldLabel,
  isLocalDate,
  pickerInitialDate,
  serializePickedDate,
} from "./date-field-state";

// Checkpoint 9.5. All-day event dates are calendar dates (utils/local-date.ts);
// nothing here may pass through a UTC instant.
describe("isLocalDate", () => {
  it("accepts a real YYYY-MM-DD", () => {
    expect(isLocalDate("2026-09-15")).toBe(true);
    expect(isLocalDate("2024-02-29")).toBe(true);
  });

  it("rejects absent, malformed, and rolled-over dates", () => {
    expect(isLocalDate(null)).toBe(false);
    expect(isLocalDate(undefined)).toBe(false);
    expect(isLocalDate("")).toBe(false);
    expect(isLocalDate("2026-9-15")).toBe(false);
    expect(isLocalDate("2026-09-15T14:00:00Z")).toBe(false);
    // Date would roll Feb 31 to March 3 rather than fail; the round-trip catches it.
    expect(isLocalDate("2026-02-31")).toBe(false);
    expect(isLocalDate("2026-13-01")).toBe(false);
  });
});

describe("formatDateFieldLabel", () => {
  it("renders a readable local date and null for anything unreadable", () => {
    expect(formatDateFieldLabel("2026-09-15")).toMatch(/2026/);
    expect(formatDateFieldLabel("2026-09-15")).toMatch(/15/);
    expect(formatDateFieldLabel("nonsense")).toBeNull();
    expect(formatDateFieldLabel(null)).toBeNull();
  });
});

describe("serializePickedDate", () => {
  it("reads the picked Date's LOCAL calendar date, never its UTC date", () => {
    // 23:30 local on the 15th: in any negative-offset zone the UTC date is
    // already the 16th. The field must say the 15th, the day that was picked.
    const picked = new Date(2026, 8, 15, 23, 30);
    expect(serializePickedDate(picked)).toBe("2026-09-15");
    // Same day at 00:30 -- positive-offset zones would put UTC on the 14th.
    expect(serializePickedDate(new Date(2026, 8, 15, 0, 30))).toBe("2026-09-15");
  });

  it("round-trips through the picker's initial date on the same calendar day", () => {
    expect(serializePickedDate(pickerInitialDate("2026-09-15"))).toBe("2026-09-15");
  });
});

describe("pickerInitialDate", () => {
  it("opens on the stored date at local noon", () => {
    const initial = pickerInitialDate("2026-09-15");
    expect(initial.getFullYear()).toBe(2026);
    expect(initial.getMonth()).toBe(8);
    expect(initial.getDate()).toBe(15);
    expect(initial.getHours()).toBe(12);
  });

  it("falls back to today (at noon) for an absent or unreadable value", () => {
    const now = new Date(2026, 8, 20, 3, 15);
    for (const value of [null, undefined, "", "garbage"]) {
      const initial = pickerInitialDate(value, now);
      expect(initial.getDate()).toBe(20);
      expect(initial.getHours()).toBe(12);
    }
    // The caller's `now` is not mutated.
    expect(now.getHours()).toBe(3);
  });
});
