// Regression suite for the Checkpoint 5.7.1 all-day noon-anchor leak.
//
// The shipped bug: a RECURRING all-day event rendered "12:00" on Today,
// because ADR-042 anchors such a series' DTSTART at LOCAL NOON and the time
// fallback chain reached occurs_at without ever checking all_day. Found on the
// production device as "12:00, P57-SMOKE all-day weekly".
//
// The noon anchor is expressed as noon-local-as-UTC, so its UTC hour differs
// per zone -- 17:00Z for Chicago (UTC-5), 00:00Z *next day* for Auckland
// (UTC+12), 16:00Z for Santiago (UTC-4). Every one of those must render as the
// all-day label and never as a clock time.

import { describe, expect, it } from "vitest";
import { eventTimeLabel, formatEventTime } from "./event-time-label";

// Local noon expressed as a UTC instant, per zone.
const NOON_ANCHORS = {
  "America/Chicago": "2026-08-25T17:00:00.000Z",
  "Pacific/Auckland": "2026-08-24T12:00:00.000Z",
  "America/Santiago": "2026-08-25T16:00:00.000Z",
} as const;

const allDayInstance = (occursAt: string) => ({
  all_day: true,
  starts_at: null,
  ends_at: null,
  occurs_at: occursAt,
});

describe("eventTimeLabel — all-day never leaks a clock time", () => {
  for (const [zone, anchor] of Object.entries(NOON_ANCHORS)) {
    it(`recurring all-day instance renders the all-day label, not a time (${zone})`, () => {
      const label = eventTimeLabel(allDayInstance(anchor), "All day");
      expect(label).toBe("All day");
      // The actual defect signature, asserted directly.
      expect(label).not.toContain("12:00");
      expect(label).not.toMatch(/\d{1,2}:\d{2}/);
    });
  }

  it("non-recurring all-day event (occurs_at null) also renders the all-day label", () => {
    expect(
      eventTimeLabel({ all_day: true, starts_at: null, ends_at: null, occurs_at: null }, "All day"),
    ).toBe("All day");
  });

  it("honours the caller's label casing without changing the rule", () => {
    expect(eventTimeLabel(allDayInstance(NOON_ANCHORS["America/Chicago"]), "ALL-DAY")).toBe(
      "ALL-DAY",
    );
  });

  // Mutation guard: if the all_day short-circuit is ever removed or moved
  // below the timestamp branches, this is what would come back.
  it("would render a clock time if all_day were ignored — proving the guard is load-bearing", () => {
    const anchor = NOON_ANCHORS["America/Chicago"];
    const withoutGuard = eventTimeLabel(
      { all_day: false, starts_at: null, ends_at: null, occurs_at: anchor },
      "All day",
    );
    expect(withoutGuard).toMatch(/\d{2}:\d{2}/);
    expect(eventTimeLabel(allDayInstance(anchor), "All day")).not.toBe(withoutGuard);
  });

  it("an all-day event is labelled even if a stray starts_at is somehow present", () => {
    // EventCreateSchema forbids this combination, so it is unreachable through
    // the API -- but the helper must not depend on that to stay correct.
    expect(
      eventTimeLabel(
        {
          all_day: true,
          starts_at: "2026-08-25T14:00:00.000Z",
          ends_at: "2026-08-25T15:00:00.000Z",
          occurs_at: null,
        },
        "All day",
      ),
    ).toBe("All day");
  });
});

describe("eventTimeLabel — timed events still format normally", () => {
  it("renders a range when both ends are present", () => {
    const label = eventTimeLabel(
      {
        all_day: false,
        starts_at: "2026-08-25T14:00:00.000Z",
        ends_at: "2026-08-25T15:00:00.000Z",
        occurs_at: null,
      },
      "All day",
    );
    expect(label).toBe(
      `${formatEventTime("2026-08-25T14:00:00.000Z")}–${formatEventTime("2026-08-25T15:00:00.000Z")}`,
    );
  });

  it("falls back to occurs_at for a TIMED recurring instance (the legitimate use)", () => {
    const occursAt = "2026-08-25T14:00:00.000Z";
    expect(
      eventTimeLabel({ all_day: false, starts_at: null, ends_at: null, occurs_at: occursAt }, "x"),
    ).toBe(formatEventTime(occursAt));
  });

  it("renders the all-day label when a timed event carries no usable instant", () => {
    expect(
      eventTimeLabel({ all_day: false, starts_at: null, ends_at: null, occurs_at: null }, "All day"),
    ).toBe("All day");
  });
});
