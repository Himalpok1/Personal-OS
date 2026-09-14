import { describe, expect, it } from "vitest";
import {
  combineDateAndTime,
  datePickerInitialInstant,
  formatFieldLabel,
  isPastInstant,
  pickerInitialInstant,
  serializePickedInstant,
} from "./datetime-field-state";

// Checkpoint 8.4 Lane 4/5. These fields were hand-typed ISO-8601 TextInputs
// with no validation since Phase 2, so the parsing has to tolerate whatever
// is already stored as well as what a picker now produces.
describe("combineDateAndTime", () => {
  it("takes the calendar date from one picker and the wall clock from the other", () => {
    // The date dialog reports UTC MIDNIGHT of the chosen day (Material3
    // selectedDateMillis); the time dialog's date is meaningless.
    const datePart = new Date(Date.UTC(2026, 8, 15));
    const timePart = new Date(2026, 0, 1, 14, 30, 59, 999);
    const combined = combineDateAndTime(datePart, timePart);

    expect(combined.getFullYear()).toBe(2026);
    expect(combined.getMonth()).toBe(8);
    expect(combined.getDate()).toBe(15);
    expect(combined.getHours()).toBe(14);
    expect(combined.getMinutes()).toBe(30);
  });

  it("keeps the PICKED day in a zone west of UTC (the Rabbit R1 off-by-one, 9.5 acceptance)", () => {
    // Sep 18 00:00Z is Sep 17 19:00 in America/Chicago. Reading the date
    // part with local getters returned the 17th; the user picked the 18th.
    const picked = new Date(Date.UTC(2026, 8, 18));
    const combined = combineDateAndTime(picked, new Date(2026, 0, 1, 7, 18));
    expect(combined.getDate()).toBe(18);
    expect(combined.getHours()).toBe(7);
    expect(combined.getMinutes()).toBe(18);
  });

  it("zeroes seconds and milliseconds, which no picker offers", () => {
    const combined = combineDateAndTime(
      new Date(Date.UTC(2026, 8, 15)),
      new Date(2026, 0, 1, 14, 30, 59, 999),
    );
    expect(combined.getSeconds()).toBe(0);
    expect(combined.getMilliseconds()).toBe(0);
  });

  it("does not mutate either input", () => {
    const datePart = new Date(Date.UTC(2026, 8, 15, 3));
    const timePart = new Date(2026, 0, 1, 14, 30, 0);
    combineDateAndTime(datePart, timePart);
    expect(datePart.getUTCHours()).toBe(3);
    expect(timePart.getDate()).toBe(1);
  });
});

describe("serializePickedInstant", () => {
  it("carries an explicit offset so the value is never ambiguous", () => {
    const instant = new Date("2026-09-15T19:00:00Z");
    expect(serializePickedInstant(instant, "America/Chicago")).toBe("2026-09-15T14:00:00-05:00");
  });

  it("uses the zone's offset for THAT instant, across a DST boundary", () => {
    expect(serializePickedInstant(new Date("2026-01-15T15:30:00Z"), "America/Chicago")).toBe(
      "2026-01-15T09:30:00-06:00",
    );
  });
});

describe("formatFieldLabel", () => {
  it("returns null for absent values rather than a placeholder string", () => {
    expect(formatFieldLabel(null)).toBeNull();
    expect(formatFieldLabel(undefined)).toBeNull();
    expect(formatFieldLabel("")).toBeNull();
  });

  it("returns null for unparseable stored text instead of rendering 'Invalid Date'", () => {
    // These fields accepted free text for three phases; rows can hold anything.
    expect(formatFieldLabel("next tuesday-ish")).toBeNull();
    expect(formatFieldLabel("2026-13-45T99:99:99")).toBeNull();
  });

  it("renders a real value as something a person can read", () => {
    const label = formatFieldLabel("2026-09-15T19:00:00Z");
    expect(label).not.toBeNull();
    expect(label).toMatch(/2026/);
  });
});

describe("pickerInitialInstant", () => {
  const now = new Date("2026-09-01T00:00:00Z");

  it("opens on the current value when there is one", () => {
    expect(pickerInitialInstant("2026-09-15T19:00:00Z", now).toISOString()).toBe(
      "2026-09-15T19:00:00.000Z",
    );
  });

  it("opens on now when the field is empty or unreadable", () => {
    expect(pickerInitialInstant(null, now)).toBe(now);
    expect(pickerInitialInstant("garbage", now)).toBe(now);
  });
});

describe("isPastInstant", () => {
  const now = new Date("2026-09-15T12:00:00Z");

  it("flags an instant already gone", () => {
    expect(isPastInstant("2026-09-15T11:59:00Z", now)).toBe(true);
  });

  it("does not flag a future instant", () => {
    expect(isPastInstant("2026-09-15T12:01:00Z", now)).toBe(false);
  });

  it("never flags an absent or unreadable value -- it is informational, not validation", () => {
    expect(isPastInstant(null, now)).toBe(false);
    expect(isPastInstant("garbage", now)).toBe(false);
  });
});

describe("datePickerInitialInstant", () => {
  it("opens the date dialog on the LOCAL calendar day of the instant (UTC midnight of that day)", () => {
    // 23:30 local on the 15th: the raw instant's UTC date is already the
    // 16th in any zone west of UTC, which is where the dialog would open.
    const local = new Date(2026, 8, 15, 23, 30);
    const initial = datePickerInitialInstant(local);
    expect(initial.getUTCFullYear()).toBe(2026);
    expect(initial.getUTCMonth()).toBe(8);
    expect(initial.getUTCDate()).toBe(15);
    expect(initial.getUTCHours()).toBe(0);
  });
});
