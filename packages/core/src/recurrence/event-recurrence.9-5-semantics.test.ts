import { describe, expect, it } from "vitest";
import { formatLocalDate } from "../actionability.js";
import {
  formatInstantWithOffset,
  resolveWallClockToInstant,
  toWallClockComponents,
} from "../timezone.js";
import { expandRecurrenceInRange, type ExpandedOccurrence } from "./due-date-window.js";
import { resolveLocalUntilToInstant } from "./editor.js";
import { allDayInstanceDates, buildEventRecurrenceRule } from "./event-recurrence.js";

// Checkpoint 9.5 (Lane E): pins the EVENT recurrence semantics the new
// event-authoring surface relies on, end to end through the one shared
// builder (ADR-042: buildEventRecurrenceRule is the ONLY place a stored event
// row becomes a rule) and the shared range expander. Every instant below is
// chosen so the assertion is only true if the wall-clock invariant, the
// all-day noon anchor, and the pure-date contract actually hold.
//
// DST facts used (IANA, 2026):
//   America/Chicago   spring-forward 03-08 (02:00 -> 03:00), fall-back 11-01
//   Europe/London     spring-forward 03-29,              fall-back 10-25
//   Pacific/Auckland  DST ends 04-05 (+13 -> +12),        DST starts 09-27
//   America/Santiago  DST ends 04-05,                     DST starts 09-06 -- local
//                     midnight 2026-09-06 does NOT exist (00:00 -> 01:00).

const ZONES = ["America/Chicago", "Europe/London", "Pacific/Auckland", "America/Santiago"] as const;

function timedRule(
  tz: string,
  startLocalIso: string,
  rrule: string,
  extras: { recurrenceUntil?: Date; recurrenceCount?: number; recurrenceExdates?: string[] } = {},
) {
  const startsAt = resolveWallClockToInstant(parseLocalIso(startLocalIso), tz);
  const rule = buildEventRecurrenceRule({
    rrule,
    recurrenceTimezone: tz,
    allDay: false,
    startsAt,
    startDate: null,
    recurrenceUntil: extras.recurrenceUntil ?? null,
    recurrenceCount: extras.recurrenceCount ?? null,
    recurrenceExdates: extras.recurrenceExdates ?? null,
  });
  if (!rule) throw new Error("expected a rule");
  return rule;
}

function allDayRule(
  tz: string,
  startDate: string,
  rrule: string,
  extras: { recurrenceUntil?: Date; recurrenceCount?: number; recurrenceExdates?: string[] } = {},
) {
  const rule = buildEventRecurrenceRule({
    rrule,
    recurrenceTimezone: tz,
    allDay: true,
    startsAt: null,
    startDate,
    recurrenceUntil: extras.recurrenceUntil ?? null,
    recurrenceCount: extras.recurrenceCount ?? null,
    recurrenceExdates: extras.recurrenceExdates ?? null,
  });
  if (!rule) throw new Error("expected a rule");
  return rule;
}

function parseLocalIso(localIso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localIso);
  if (!m) throw new Error(`bad local iso ${localIso}`);
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6] ?? 0),
  };
}

function localDatesOf(occurrences: ExpandedOccurrence[]): string[] {
  return occurrences.map((o) => formatLocalDate(o.occursLocal));
}

function utc(iso: string): Date {
  return new Date(iso);
}

const RANGE_2026 = [utc("2026-01-01T00:00:00Z"), utc("2027-01-01T00:00:00Z")] as const;

describe("timed 09:00 daily event across US DST (wall clock invariant, offset moves)", () => {
  it("America/Chicago: spring-forward 2026-03-08 -- every occurrence is 09:00 local, UTC offset -06:00 -> -05:00", () => {
    const tz = "America/Chicago";
    const rule = timedRule(tz, "2026-03-06T09:00", "FREQ=DAILY");
    const out = expandRecurrenceInRange(
      rule,
      utc("2026-03-06T00:00:00Z"),
      utc("2026-03-10T23:59:59Z"),
    );
    expect(out).toHaveLength(5);
    for (const o of out) {
      expect(o.occursLocal.hour).toBe(9);
      expect(o.occursLocal.minute).toBe(0);
      expect(toWallClockComponents(o.occursAt, tz).hour).toBe(9);
    }
    const withOffset = out.map((o) => formatInstantWithOffset(o.occursAt, tz));
    expect(withOffset).toEqual([
      "2026-03-06T09:00:00-06:00",
      "2026-03-07T09:00:00-06:00",
      "2026-03-08T09:00:00-05:00",
      "2026-03-09T09:00:00-05:00",
      "2026-03-10T09:00:00-05:00",
    ]);
    // The real instants therefore step 24h, 23h, 24h, 24h -- never a flat 24h.
    const deltasH = out
      .slice(1)
      .map((o, i) => (o.occursAt.getTime() - out[i]!.occursAt.getTime()) / 3_600_000);
    expect(deltasH).toEqual([24, 23, 24, 24]);
    expect(out[2]!.occursAt.toISOString()).toBe("2026-03-08T14:00:00.000Z");
  });

  it("America/Chicago: fall-back 2026-11-01 -- 09:00 local stays 09:00, offset -05:00 -> -06:00, one 25h gap", () => {
    const tz = "America/Chicago";
    const rule = timedRule(tz, "2026-10-30T09:00", "FREQ=DAILY");
    const out = expandRecurrenceInRange(
      rule,
      utc("2026-10-30T00:00:00Z"),
      utc("2026-11-03T23:59:59Z"),
    );
    expect(out.map((o) => formatInstantWithOffset(o.occursAt, tz))).toEqual([
      "2026-10-30T09:00:00-05:00",
      "2026-10-31T09:00:00-05:00",
      "2026-11-01T09:00:00-06:00",
      "2026-11-02T09:00:00-06:00",
      "2026-11-03T09:00:00-06:00",
    ]);
    const deltasH = out
      .slice(1)
      .map((o, i) => (o.occursAt.getTime() - out[i]!.occursAt.getTime()) / 3_600_000);
    expect(deltasH).toEqual([24, 25, 24, 24]);
    expect(out[2]!.occursAt.toISOString()).toBe("2026-11-01T15:00:00.000Z");
  });

  it("the same series expanded from a UTC-anchored dtstart WOULD drift -- proving the builder anchors on wall clock, not instant", () => {
    const tz = "America/Chicago";
    const rule = timedRule(tz, "2026-03-06T09:00", "FREQ=DAILY");
    // dtstart carries the wall-clock components, not a UTC instant.
    expect(rule.dtstart).toEqual({ year: 2026, month: 3, day: 6, hour: 9, minute: 0, second: 0 });
    expect(rule.recurrenceTimezone).toBe(tz);
  });
});

describe("timed weekly / weekdays / monthly expansions in four zones", () => {
  for (const tz of ZONES) {
    it(`${tz}: FREQ=WEEKLY;BYDAY=MO,WE from a Monday yields exactly Mon+Wed local dates at 09:00 local`, () => {
      const rule = timedRule(tz, "2026-03-02T09:00", "FREQ=WEEKLY;BYDAY=MO,WE"); // 03-02 is a Monday
      const out = expandRecurrenceInRange(
        rule,
        resolveWallClockToInstant(parseLocalIso("2026-03-01T00:00"), tz),
        resolveWallClockToInstant(parseLocalIso("2026-04-12T23:59:59"), tz),
      );
      expect(localDatesOf(out)).toEqual([
        "2026-03-02",
        "2026-03-04",
        "2026-03-09",
        "2026-03-11",
        "2026-03-16",
        "2026-03-18",
        "2026-03-23",
        "2026-03-25",
        "2026-03-30",
        "2026-04-01",
        "2026-04-06",
        "2026-04-08",
      ]);
      // Every occurrence stays at 09:00 IN ITS ZONE across each zone's own
      // transition (Chicago 03-08, London 03-29, Auckland 04-05, Santiago 04-05).
      for (const o of out) expect(toWallClockComponents(o.occursAt, tz).hour).toBe(9);
    });

    it(`${tz}: weekdays preset (BYDAY=MO..FR) skips Saturday and Sunday only`, () => {
      const rule = timedRule(tz, "2026-03-02T09:00", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
      const out = expandRecurrenceInRange(
        rule,
        resolveWallClockToInstant(parseLocalIso("2026-03-02T00:00"), tz),
        resolveWallClockToInstant(parseLocalIso("2026-03-15T23:59:59"), tz),
      );
      expect(localDatesOf(out)).toEqual([
        "2026-03-02",
        "2026-03-03",
        "2026-03-04",
        "2026-03-05",
        "2026-03-06",
        "2026-03-09",
        "2026-03-10",
        "2026-03-11",
        "2026-03-12",
        "2026-03-13",
      ]);
    });

    it(`${tz}: FREQ=MONTHLY;BYMONTHDAY=15 lands on the 15th of every month at 09:00 local`, () => {
      const rule = timedRule(tz, "2026-01-15T09:00", "FREQ=MONTHLY;BYMONTHDAY=15");
      const out = expandRecurrenceInRange(rule, RANGE_2026[0], RANGE_2026[1]);
      expect(localDatesOf(out)).toEqual(
        Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}-15`),
      );
      for (const o of out) expect(toWallClockComponents(o.occursAt, tz).hour).toBe(9);
    });

    it(`${tz}: FREQ=MONTHLY;BYMONTHDAY=-1 lands on Feb 28, Apr 30, May 31 (and every other month-end)`, () => {
      const rule = timedRule(tz, "2026-01-31T09:00", "FREQ=MONTHLY;BYMONTHDAY=-1");
      const out = expandRecurrenceInRange(rule, RANGE_2026[0], RANGE_2026[1]);
      expect(localDatesOf(out)).toEqual([
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
        "2026-05-31",
        "2026-06-30",
        "2026-07-31",
        "2026-08-31",
        "2026-09-30",
        "2026-10-31",
        "2026-11-30",
        "2026-12-31",
      ]);
    });

    it(`${tz}: BYMONTHDAY=-1 in a leap year lands on Feb 29`, () => {
      const rule = timedRule(tz, "2028-01-31T09:00", "FREQ=MONTHLY;BYMONTHDAY=-1");
      const out = expandRecurrenceInRange(
        rule,
        utc("2028-02-01T00:00:00Z"),
        utc("2028-03-01T00:00:00Z"),
      );
      expect(localDatesOf(out)).toEqual(["2028-02-29"]);
    });

    it(`${tz}: FREQ=MONTHLY;BYMONTHDAY=31 SKIPS short months (RFC 5545 literal -- why the preset writes -1 for month-end)`, () => {
      const rule = timedRule(tz, "2026-01-31T09:00", "FREQ=MONTHLY;BYMONTHDAY=31");
      const out = expandRecurrenceInRange(rule, RANGE_2026[0], RANGE_2026[1]);
      expect(localDatesOf(out)).toEqual([
        "2026-01-31",
        "2026-03-31",
        "2026-05-31",
        "2026-07-31",
        "2026-08-31",
        "2026-10-31",
        "2026-12-31",
      ]);
    });
  }
});

describe("all-day recurring series keep PURE dates across DST (ADR-042 noon anchor, ADR-045 never a time)", () => {
  for (const tz of ZONES) {
    it(`${tz}: daily all-day series across every 2026 transition -- consecutive calendar dates, no shifted or duplicated date`, () => {
      const rule = allDayRule(tz, "2026-01-01", "FREQ=DAILY");
      expect(rule.dtstart.hour).toBe(12);
      // Range widened a day each side: Auckland noon on 01-01 is 12-31T23:00Z.
      const out = expandRecurrenceInRange(
        rule,
        utc("2025-12-31T00:00:00Z"),
        utc("2027-01-02T00:00:00Z"),
      );
      const dates = localDatesOf(out).filter((d) => d.startsWith("2026-"));
      expect(dates).toHaveLength(365);
      expect(new Set(dates).size).toBe(365);
      expect(dates[0]).toBe("2026-01-01");
      expect(dates[364]).toBe("2026-12-31");
      // The pure date is what the instance carries; the noon anchor instant
      // renders back to the SAME date in its own zone (never the day before
      // or after), which is exactly the guarantee a midnight anchor lacks.
      for (const o of out) {
        expect(o.occursLocal.hour).toBe(12);
        expect(formatLocalDate(toWallClockComponents(o.occursAt, tz))).toBe(
          formatLocalDate(o.occursLocal),
        );
        expect(allDayInstanceDates(o.occursLocal, "2026-01-01", "2026-01-01").startDate).toBe(
          formatLocalDate(o.occursLocal),
        );
      }
    });
  }

  it("America/Santiago: a weekly all-day series whose instance falls on the nonexistent-midnight date 2026-09-06 still yields that exact date", () => {
    const tz = "America/Santiago";
    // Prove the premise: local midnight 2026-09-06 does not exist in Santiago
    // (the clock goes 23:59:59 -> 01:00:00), so a midnight anchor would have
    // been resolved to some OTHER wall clock.
    const midnight = resolveWallClockToInstant(parseLocalIso("2026-09-06T00:00"), tz);
    expect(toWallClockComponents(midnight, tz).hour).not.toBe(0);
    // Noon exists and round-trips.
    const noon = resolveWallClockToInstant(parseLocalIso("2026-09-06T12:00"), tz);
    expect(toWallClockComponents(noon, tz)).toMatchObject({ day: 6, hour: 12 });

    const rule = allDayRule(tz, "2026-08-30", "FREQ=WEEKLY;BYDAY=SU"); // 08-30 is a Sunday
    const out = expandRecurrenceInRange(
      rule,
      utc("2026-08-29T00:00:00Z"),
      utc("2026-09-21T00:00:00Z"),
    );
    expect(localDatesOf(out)).toEqual(["2026-08-30", "2026-09-06", "2026-09-13", "2026-09-20"]);
    expect(out[1]!.occursAt.getTime()).toBe(noon.getTime());
  });

  it("a 3-day all-day weekly series preserves its span on every instance across a DST boundary", () => {
    const tz = "America/Chicago";
    const rule = allDayRule(tz, "2026-03-02", "FREQ=WEEKLY;BYDAY=MO");
    const out = expandRecurrenceInRange(
      rule,
      utc("2026-03-01T00:00:00Z"),
      utc("2026-03-20T00:00:00Z"),
    );
    const spans = out.map((o) => allDayInstanceDates(o.occursLocal, "2026-03-02", "2026-03-04"));
    expect(spans).toEqual([
      { startDate: "2026-03-02", endDate: "2026-03-04" },
      { startDate: "2026-03-09", endDate: "2026-03-11" }, // spans the 03-08 transition's aftermath
      { startDate: "2026-03-16", endDate: "2026-03-18" },
    ]);
  });
});

describe("EXDATE removes exactly one instance and nothing else", () => {
  it("timed daily series (Chicago, across spring-forward): the exdate's instance is gone, its neighbours intact", () => {
    const tz = "America/Chicago";
    const rule = timedRule(tz, "2026-03-06T09:00", "FREQ=DAILY", {
      recurrenceExdates: ["2026-03-08"],
    });
    const out = expandRecurrenceInRange(
      rule,
      utc("2026-03-06T00:00:00Z"),
      utc("2026-03-10T23:59:59Z"),
    );
    expect(localDatesOf(out)).toEqual(["2026-03-06", "2026-03-07", "2026-03-09", "2026-03-10"]);
    // The exdate is matched at the rule's OWN time-of-day, so it is the
    // 09:00 instance -- i.e. the 14:00Z one on the post-transition day --
    // that is removed, not a midnight-based approximation.
    expect(out.map((o) => o.occursAt.toISOString())).not.toContain("2026-03-08T14:00:00.000Z");
    expect(out.map((o) => o.occursAt.toISOString())).toContain("2026-03-09T14:00:00.000Z");
  });

  it("all-day weekly series (Auckland): the exdate's DATE is gone; the weeks either side are untouched", () => {
    const tz = "Pacific/Auckland";
    const rule = allDayRule(tz, "2026-03-30", "FREQ=WEEKLY;BYDAY=MO", {
      recurrenceExdates: ["2026-04-06"], // the Monday right after NZ DST ends (04-05)
    });
    const out = expandRecurrenceInRange(
      rule,
      utc("2026-03-28T00:00:00Z"),
      utc("2026-04-22T00:00:00Z"),
    );
    expect(localDatesOf(out)).toEqual(["2026-03-30", "2026-04-13", "2026-04-20"]);
  });

  it("an exdate that matches no instance (wrong weekday) removes nothing", () => {
    const tz = "Europe/London";
    const rule = timedRule(tz, "2026-03-02T09:00", "FREQ=WEEKLY;BYDAY=MO", {
      recurrenceExdates: ["2026-03-03"], // a Tuesday
    });
    const out = expandRecurrenceInRange(
      rule,
      utc("2026-03-01T00:00:00Z"),
      utc("2026-03-24T00:00:00Z"),
    );
    expect(localDatesOf(out)).toEqual(["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23"]);
  });
});

describe("recurrence_until on an ALL-DAY series -- pins DOCUMENTED DEBT, not desired behaviour", () => {
  // docs/STATUS.md ledger: "All-day `recurrence_until` must resolve to
  // end-of-local-day. The shipped mobile editor always serializes it to
  // 23:59:59.999 ... a raw API caller sending midnight silently loses the
  // final occurrence (a noon-anchored instance sorts after it)." Both halves
  // are asserted here so any change to either is deliberate.
  const tz = "America/Chicago";

  it("end-of-local-day UNTIL (what resolveLocalUntilToInstant / the editor writes) KEEPS the final date's instance", () => {
    const until = resolveLocalUntilToInstant("2026-09-20", tz); // 2026-09-21T04:59:59.999Z
    expect(until.toISOString()).toBe("2026-09-21T04:59:59.999Z");
    const rule = allDayRule(tz, "2026-09-18", "FREQ=DAILY", { recurrenceUntil: until });
    const out = expandRecurrenceInRange(
      rule,
      utc("2026-09-17T00:00:00Z"),
      utc("2026-09-25T00:00:00Z"),
    );
    expect(localDatesOf(out)).toEqual(["2026-09-18", "2026-09-19", "2026-09-20"]);
  });

  it("DEBT: a local-MIDNIGHT UNTIL on the final date silently DROPS that date's instance (noon anchor > midnight)", () => {
    const untilAtMidnight = resolveWallClockToInstant(parseLocalIso("2026-09-20T00:00"), tz);
    const rule = allDayRule(tz, "2026-09-18", "FREQ=DAILY", { recurrenceUntil: untilAtMidnight });
    const out = expandRecurrenceInRange(
      rule,
      utc("2026-09-17T00:00:00Z"),
      utc("2026-09-25T00:00:00Z"),
    );
    // Current behaviour: 09-20 is missing. If this assertion ever fails
    // because 09-20 is present, the debt has been closed server-side and the
    // ledger entry should be retired with it.
    expect(localDatesOf(out)).toEqual(["2026-09-18", "2026-09-19"]);
  });

  it("timed series: UNTIL is a real-instant cutoff, inclusive at the exact instant", () => {
    const rule = timedRule(tz, "2026-09-18T09:00", "FREQ=DAILY", {
      recurrenceUntil: resolveWallClockToInstant(parseLocalIso("2026-09-20T09:00"), tz),
    });
    const out = expandRecurrenceInRange(
      rule,
      utc("2026-09-17T00:00:00Z"),
      utc("2026-09-25T00:00:00Z"),
    );
    expect(localDatesOf(out)).toEqual(["2026-09-18", "2026-09-19", "2026-09-20"]);
  });

  it("recurrenceCount caps the series regardless of zone or DST", () => {
    for (const tz2 of ZONES) {
      const rule = timedRule(tz2, "2026-03-06T09:00", "FREQ=DAILY", { recurrenceCount: 4 });
      const out = expandRecurrenceInRange(
        rule,
        utc("2026-03-01T00:00:00Z"),
        utc("2026-04-01T00:00:00Z"),
      );
      expect(localDatesOf(out), tz2).toEqual([
        "2026-03-06",
        "2026-03-07",
        "2026-03-08",
        "2026-03-09",
      ]);
    }
  });
});
