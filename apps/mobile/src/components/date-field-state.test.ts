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
  it("reads the picked Date as the Material dialog reports it: UTC midnight of the chosen day", () => {
    // Sep 18 picked -> selectedDateMillis = Sep 18 00:00Z, which is Sep 17
    // 19:00 in America/Chicago. The local reading gave the 17th (the Rabbit
    // R1 off-by-one at the 9.5 acceptance); the field must say the 18th.
    expect(serializePickedDate(new Date(Date.UTC(2026, 8, 18)))).toBe("2026-09-18");
    expect(serializePickedDate(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-01-01");
  });

  it("round-trips through the picker's initial date on the same calendar day", () => {
    expect(serializePickedDate(pickerInitialDate("2026-09-15"))).toBe("2026-09-15");
  });
});

describe("pickerInitialDate", () => {
  it("opens on the stored date, as UTC midnight of that calendar day (the dialog's convention)", () => {
    const initial = pickerInitialDate("2026-09-15");
    expect(initial.getUTCFullYear()).toBe(2026);
    expect(initial.getUTCMonth()).toBe(8);
    expect(initial.getUTCDate()).toBe(15);
    expect(initial.getUTCHours()).toBe(0);
  });

  it("falls back to today for an absent or unreadable value", () => {
    const now = new Date(2026, 8, 20, 3, 15);
    for (const value of [null, undefined, "", "garbage"]) {
      const initial = pickerInitialDate(value, now);
      expect(initial.getUTCDate()).toBe(20);
      expect(initial.getUTCHours()).toBe(0);
    }
    // The caller's `now` is not mutated.
    expect(now.getHours()).toBe(3);
  });
});
