import { describe, expect, it } from "vitest";
import { normalizeRrule, recurrenceChanged, type RecurrenceState } from "./task-recurrence-diff.js";

// Checkpoint 9.4. PATCH /tasks/:id's branch A regenerates the occurrence
// window only when this helper says something changed, so its "unchanged"
// verdicts are what keep occurrence ids and snoozes stable across a title
// edit or an editor round-trip.

const base: RecurrenceState = {
  rrule: "FREQ=WEEKLY;BYDAY=MO",
  recurrenceTimezone: "America/Chicago",
  recurrenceAnchor: "due_date",
  recurrenceUntil: null,
  recurrenceCount: null,
  recurrenceExdates: null,
  dueAt: new Date("2026-09-14T14:00:00Z"),
};

describe("normalizeRrule", () => {
  it("returns null for null, undefined and blank input", () => {
    expect(normalizeRrule(null)).toBeNull();
    expect(normalizeRrule(undefined)).toBeNull();
    expect(normalizeRrule("   ")).toBeNull();
    expect(normalizeRrule("RRULE:")).toBeNull();
  });

  it("strips the default INTERVAL=1 so the editor's serialisation equals the parser's", () => {
    expect(normalizeRrule("FREQ=DAILY;INTERVAL=1")).toBe("FREQ=DAILY");
    expect(normalizeRrule("FREQ=DAILY")).toBe("FREQ=DAILY");
  });

  it("keeps a non-default interval", () => {
    expect(normalizeRrule("FREQ=DAILY;INTERVAL=3")).toBe("FREQ=DAILY;INTERVAL=3");
    expect(normalizeRrule("FREQ=DAILY;INTERVAL=10")).toBe("FREQ=DAILY;INTERVAL=10");
  });

  it("sorts parts case-insensitively and upper-cases keys, dropping the RRULE: prefix", () => {
    expect(normalizeRrule("rrule:byday=MO;freq=WEEKLY")).toBe("BYDAY=MO;FREQ=WEEKLY");
    expect(normalizeRrule("FREQ=WEEKLY;BYDAY=MO")).toBe("BYDAY=MO;FREQ=WEEKLY");
  });

  it("does not equate genuinely different rules", () => {
    expect(normalizeRrule("FREQ=WEEKLY;BYDAY=MO")).not.toBe(normalizeRrule("FREQ=WEEKLY;BYDAY=TU"));
    expect(normalizeRrule("FREQ=DAILY")).not.toBe(normalizeRrule("FREQ=WEEKLY"));
  });
});

describe("recurrenceChanged", () => {
  it("is false for an identical state", () => {
    expect(recurrenceChanged(base, { ...base })).toBe(false);
  });

  it("is false when only the rrule spelling differs (INTERVAL=1, part order, prefix)", () => {
    expect(
      recurrenceChanged(base, { ...base, rrule: "RRULE:BYDAY=MO;FREQ=WEEKLY;INTERVAL=1" }),
    ).toBe(false);
  });

  it("is false when due_at is a different Date object for the same instant", () => {
    expect(recurrenceChanged(base, { ...base, dueAt: new Date(base.dueAt!.getTime()) })).toBe(
      false,
    );
  });

  it("treats an empty exdates array and null as the same", () => {
    expect(recurrenceChanged(base, { ...base, recurrenceExdates: [] })).toBe(false);
    expect(
      recurrenceChanged(
        { ...base, recurrenceExdates: ["2026-10-05", "2026-09-28"] },
        { ...base, recurrenceExdates: ["2026-09-28", "2026-10-05"] },
      ),
    ).toBe(false);
  });

  it("treats a null anchor as due_date", () => {
    expect(recurrenceChanged(base, { ...base, recurrenceAnchor: null })).toBe(false);
  });

  it.each<[string, Partial<RecurrenceState>]>([
    ["rrule", { rrule: "FREQ=WEEKLY;BYDAY=TU" }],
    ["interval", { rrule: "FREQ=WEEKLY;BYDAY=MO;INTERVAL=2" }],
    ["timezone", { recurrenceTimezone: "Europe/London" }],
    ["anchor", { recurrenceAnchor: "completion_date" }],
    ["until", { recurrenceUntil: new Date("2026-12-31T00:00:00Z") }],
    ["count", { recurrenceCount: 5 }],
    ["exdates", { recurrenceExdates: ["2026-09-21"] }],
    ["due_at instant", { dueAt: new Date("2026-09-14T15:00:00Z") }],
    ["due_at cleared", { dueAt: null }],
  ])("is true when %s changes", (_label, patch) => {
    expect(recurrenceChanged(base, { ...base, ...patch })).toBe(true);
  });
});
