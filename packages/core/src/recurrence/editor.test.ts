import { describe, expect, it } from "vitest";
import {
  formatRecurrenceSummary,
  parseRRuleStringToEditorState,
  resolveInstantToLocalUntil,
  resolveLocalUntilToInstant,
  serializeEditorStateToRRule,
  SUPPORTED_FREQUENCIES,
  SUPPORTED_WEEKDAYS,
  type RecurrenceEditorState,
} from "./editor.js";

describe("Recurrence Editor Constants & Types", () => {
  it("exports supported frequencies and weekdays", () => {
    expect(SUPPORTED_FREQUENCIES).toEqual(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
    expect(SUPPORTED_WEEKDAYS).toEqual(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
  });
});

describe("resolveLocalUntilToInstant and resolveInstantToLocalUntil", () => {
  it("resolves date in positive UTC offset (Asia/Tokyo, UTC+9)", () => {
    const instant = resolveLocalUntilToInstant("2026-08-20", "Asia/Tokyo");
    // 2026-08-20 23:59:59.999 in JST (UTC+9) is 2026-08-20 14:59:59.999 UTC
    expect(instant.toISOString()).toBe("2026-08-20T14:59:59.999Z");

    const localStr = resolveInstantToLocalUntil(instant, "Asia/Tokyo");
    expect(localStr).toBe("2026-08-20");
  });

  it("resolves date in negative UTC offset (America/New_York, EDT UTC-4)", () => {
    const instant = resolveLocalUntilToInstant("2026-08-20", "America/New_York");
    // 2026-08-20 23:59:59.999 EDT (UTC-4) is 2026-08-21 03:59:59.999 UTC
    expect(instant.toISOString()).toBe("2026-08-21T03:59:59.999Z");

    const localStr = resolveInstantToLocalUntil(instant, "America/New_York");
    expect(localStr).toBe("2026-08-20");
  });

  it("resolves date across DST fall-back transition (America/Chicago)", () => {
    // 2026-11-01 is fall-back in Chicago (CDT UTC-5 -> CST UTC-6 at 2am)
    // 23:59:59.999 on 2026-11-01 is in CST (UTC-6), so UTC is 2026-11-02 05:59:59.999
    const instant = resolveLocalUntilToInstant("2026-11-01", "America/Chicago");
    expect(instant.toISOString()).toBe("2026-11-02T05:59:59.999Z");

    const localStr = resolveInstantToLocalUntil(instant, "America/Chicago");
    expect(localStr).toBe("2026-11-01");
  });

  it("resolves date across DST spring-forward transition (America/Chicago)", () => {
    // 2026-03-08 is spring-forward in Chicago (CST UTC-6 -> CDT UTC-5 at 2am)
    // 23:59:59.999 on 2026-03-08 is in CDT (UTC-5), so UTC is 2026-03-09 04:59:59.999
    const instant = resolveLocalUntilToInstant("2026-03-08", "America/Chicago");
    expect(instant.toISOString()).toBe("2026-03-09T04:59:59.999Z");

    const localStr = resolveInstantToLocalUntil(instant, "America/Chicago");
    expect(localStr).toBe("2026-03-08");
  });

  it("throws for invalid date strings", () => {
    expect(() => resolveLocalUntilToInstant("invalid-date", "UTC")).toThrow(
      'invalid date string "invalid-date", expected YYYY-MM-DD',
    );
    expect(() => resolveLocalUntilToInstant("2026-13-01", "UTC")).toThrow(
      'invalid calendar date "2026-13-01"',
    );
    expect(() => resolveLocalUntilToInstant("2026-00-01", "UTC")).toThrow(
      'invalid calendar date "2026-00-01"',
    );
    expect(() => resolveLocalUntilToInstant("2026-05-32", "UTC")).toThrow(
      'invalid calendar date "2026-05-32"',
    );
  });
});

describe("parseRRuleStringToEditorState", () => {
  it("returns default editor state when rrule is empty or null", () => {
    const state = parseRRuleStringToEditorState(null, {
      defaultTimezone: "America/Chicago",
      recurrenceAnchor: "due_date",
    });
    expect(state).toEqual({
      enabled: false,
      frequency: "WEEKLY",
      interval: 1,
      weekdays: [],
      monthDay: null,
      endMode: "never",
      untilDate: null,
      count: null,
      anchor: "due_date",
      timezone: "America/Chicago",
      isCustom: false,
      rawRrule: null,
    });
  });

  it("parses simple daily rule", () => {
    const state = parseRRuleStringToEditorState("FREQ=DAILY;INTERVAL=3", {
      recurrenceTimezone: "America/New_York",
    });
    expect(state).toEqual({
      enabled: true,
      frequency: "DAILY",
      interval: 3,
      weekdays: [],
      monthDay: null,
      endMode: "never",
      untilDate: null,
      count: null,
      anchor: "due_date",
      timezone: "America/New_York",
      isCustom: false,
      rawRrule: null,
    });
  });

  it("parses weekly rule with weekdays and count=1", () => {
    const state = parseRRuleStringToEditorState("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;WKST=MO", {
      recurrenceTimezone: "UTC",
      recurrenceCount: 1,
    });
    expect(state).toEqual({
      enabled: true,
      frequency: "WEEKLY",
      interval: 2,
      weekdays: ["MO", "WE", "FR"],
      monthDay: null,
      endMode: "count",
      untilDate: null,
      count: 1,
      anchor: "due_date",
      timezone: "UTC",
      isCustom: false,
      rawRrule: null,
    });
  });

  it("parses weekly rule with count=2", () => {
    const state = parseRRuleStringToEditorState("FREQ=WEEKLY;INTERVAL=1;BYDAY=TU,TH", {
      recurrenceTimezone: "UTC",
      recurrenceCount: 2,
    });
    expect(state.count).toBe(2);
    expect(state.endMode).toBe("count");
  });

  it("parses monthly rule with monthDay and until Date", () => {
    const until = resolveLocalUntilToInstant("2026-12-31", "America/Chicago");
    const state = parseRRuleStringToEditorState("FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15", {
      recurrenceTimezone: "America/Chicago",
      recurrenceUntil: until,
    });
    expect(state).toEqual({
      enabled: true,
      frequency: "MONTHLY",
      interval: 1,
      weekdays: [],
      monthDay: 15,
      endMode: "until",
      untilDate: "2026-12-31",
      count: null,
      anchor: "due_date",
      timezone: "America/Chicago",
      isCustom: false,
      rawRrule: null,
    });
  });

  it("parses yearly rule", () => {
    const state = parseRRuleStringToEditorState("FREQ=YEARLY;INTERVAL=1", {
      recurrenceTimezone: "UTC",
    });
    expect(state.frequency).toBe("YEARLY");
    expect(state.interval).toBe(1);
    expect(state.isCustom).toBe(false);
  });

  it("detects custom rules with unsupported constructs", () => {
    // BYSETPOS
    const setpos = parseRRuleStringToEditorState("FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=1");
    expect(setpos.isCustom).toBe(true);
    expect(setpos.rawRrule).toBe("FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=1");

    // Ordinal BYDAY (2MO)
    const ordinal = parseRRuleStringToEditorState("FREQ=WEEKLY;BYDAY=2MO");
    expect(ordinal.isCustom).toBe(true);
    expect(ordinal.rawRrule).toBe("FREQ=WEEKLY;BYDAY=2MO");

    // BYDAY on MONTHLY
    const monthlyByDay = parseRRuleStringToEditorState("FREQ=MONTHLY;BYDAY=FR");
    expect(monthlyByDay.isCustom).toBe(true);

    // BYMONTH on WEEKLY
    const byMonth = parseRRuleStringToEditorState("FREQ=WEEKLY;BYMONTH=5");
    expect(byMonth.isCustom).toBe(true);

    // Embedded COUNT or UNTIL in string
    const embeddedCount = parseRRuleStringToEditorState("FREQ=DAILY;COUNT=5");
    expect(embeddedCount.isCustom).toBe(true);

    const embeddedUntil = parseRRuleStringToEditorState("FREQ=DAILY;UNTIL=20261231T000000Z");
    expect(embeddedUntil.isCustom).toBe(true);

    // Invalid frequency
    const hourly = parseRRuleStringToEditorState("FREQ=HOURLY;INTERVAL=2");
    expect(hourly.isCustom).toBe(true);

    // Completion-anchored rule with BYDAY (invalid for completion anchor)
    const compByDay = parseRRuleStringToEditorState("FREQ=WEEKLY;BYDAY=MO", {
      recurrenceAnchor: "completion_date",
    });
    expect(compByDay.isCustom).toBe(true);
  });
});

describe("serializeEditorStateToRRule", () => {
  it("serializes daily rule with count=1", () => {
    const state: RecurrenceEditorState = {
      frequency: "DAILY",
      interval: 1,
      weekdays: [],
      monthDay: null,
      endMode: "count",
      untilDate: null,
      count: 1,
      anchor: "due_date",
      timezone: "America/Chicago",
      isCustom: false,
      rawRrule: null,
    };
    const serialized = serializeEditorStateToRRule(state);
    expect(serialized).toEqual({
      rrule: "FREQ=DAILY",
      recurrence_timezone: "America/Chicago",
      recurrence_until: null,
      recurrence_count: 1,
      recurrence_anchor: "due_date",
    });
  });

  it("serializes weekly rule with interval=2, weekdays, and untilDate", () => {
    const state: RecurrenceEditorState = {
      frequency: "WEEKLY",
      interval: 2,
      weekdays: ["MO", "WE", "FR"],
      monthDay: null,
      endMode: "until",
      untilDate: "2026-12-31",
      count: null,
      anchor: "due_date",
      timezone: "America/Chicago",
      isCustom: false,
      rawRrule: null,
    };
    const serialized = serializeEditorStateToRRule(state);
    expect(serialized.rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR");
    expect(serialized.recurrence_timezone).toBe("America/Chicago");
    expect(serialized.recurrence_count).toBeNull();
    expect(serialized.recurrence_anchor).toBe("due_date");
    expect(serialized.recurrence_until?.toISOString()).toBe("2027-01-01T05:59:59.999Z");
  });

  it("serializes monthly rule with monthDay", () => {
    const state: RecurrenceEditorState = {
      frequency: "MONTHLY",
      interval: 1,
      weekdays: [],
      monthDay: 15,
      endMode: "never",
      untilDate: null,
      count: null,
      anchor: "due_date",
      timezone: "UTC",
      isCustom: false,
      rawRrule: null,
    };
    const serialized = serializeEditorStateToRRule(state);
    expect(serialized.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=15");
    expect(serialized.recurrence_until).toBeNull();
    expect(serialized.recurrence_count).toBeNull();
  });

  it("serializes completion-anchored rule without until/count/byday", () => {
    const state: RecurrenceEditorState = {
      frequency: "DAILY",
      interval: 3,
      weekdays: ["MO"],
      monthDay: null,
      endMode: "count",
      untilDate: "2026-12-31",
      count: 5,
      anchor: "completion_date",
      timezone: "America/Chicago",
      isCustom: false,
      rawRrule: null,
    };
    const serialized = serializeEditorStateToRRule(state);
    expect(serialized.rrule).toBe("FREQ=DAILY;INTERVAL=3");
    expect(serialized.recurrence_anchor).toBe("completion_date");
    expect(serialized.recurrence_until).toBeNull();
    expect(serialized.recurrence_count).toBeNull();
  });

  it("preserves rawRrule for custom states", () => {
    const state: RecurrenceEditorState = {
      frequency: "MONTHLY",
      interval: 1,
      weekdays: [],
      monthDay: null,
      endMode: "never",
      untilDate: null,
      count: null,
      anchor: "due_date",
      timezone: "UTC",
      isCustom: true,
      rawRrule: "FREQ=MONTHLY;BYDAY=2MO",
    };
    const serialized = serializeEditorStateToRRule(state);
    expect(serialized.rrule).toBe("FREQ=MONTHLY;BYDAY=2MO");
  });

  it("roundtrips cleanly between parse and serialize", () => {
    const originalRrule = "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH";
    const parsed = parseRRuleStringToEditorState(originalRrule, {
      recurrenceTimezone: "America/Chicago",
      recurrenceCount: 4,
    });
    const serialized = serializeEditorStateToRRule(parsed);
    expect(serialized.rrule).toBe(originalRrule);
    expect(serialized.recurrence_count).toBe(4);
    expect(serialized.recurrence_timezone).toBe("America/Chicago");
  });
});

describe("formatRecurrenceSummary", () => {
  it("formats non-repeating", () => {
    expect(formatRecurrenceSummary({ rrule: null })).toBe("Does not repeat");
    expect(formatRecurrenceSummary({ rrule: "" })).toBe("Does not repeat");
  });

  it("formats daily patterns", () => {
    expect(formatRecurrenceSummary({ rrule: "FREQ=DAILY" })).toBe("Daily");
    expect(formatRecurrenceSummary({ rrule: "FREQ=DAILY;INTERVAL=3" })).toBe("Every 3 days");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=DAILY",
        recurrence_count: 1,
      }),
    ).toBe("Daily, ending after 1 occurrence");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=DAILY;INTERVAL=2",
        recurrence_count: 5,
      }),
    ).toBe("Every 2 days, ending after 5 occurrences");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=DAILY",
        recurrence_until: "2026-12-31",
      }),
    ).toBe("Daily, until 2026-12-31");
  });

  it("formats weekly patterns with various weekday combinations", () => {
    expect(formatRecurrenceSummary({ rrule: "FREQ=WEEKLY" })).toBe("Weekly");
    expect(formatRecurrenceSummary({ rrule: "FREQ=WEEKLY;INTERVAL=2" })).toBe("Every 2 weeks");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      }),
    ).toBe("Every weekday");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR",
      }),
    ).toBe("Every 2 weeks on weekdays");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=WEEKLY;BYDAY=SA,SU",
      }),
    ).toBe("Every weekend");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=WEEKLY;INTERVAL=3;BYDAY=SA,SU",
      }),
    ).toBe("Every 3 weeks on weekends");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      }),
    ).toBe("Weekly on Mon, Wed, Fri");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH",
      }),
    ).toBe("Every 2 weeks on Tue, Thu");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU",
      }),
    ).toBe("Daily");
  });

  it("formats monthly and yearly patterns", () => {
    expect(formatRecurrenceSummary({ rrule: "FREQ=MONTHLY" })).toBe("Monthly");
    expect(formatRecurrenceSummary({ rrule: "FREQ=MONTHLY;BYMONTHDAY=15" })).toBe(
      "Monthly on day 15",
    );
    expect(formatRecurrenceSummary({ rrule: "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1" })).toBe(
      "Every 3 months on day 1",
    );
    expect(formatRecurrenceSummary({ rrule: "FREQ=YEARLY" })).toBe("Yearly");
    expect(formatRecurrenceSummary({ rrule: "FREQ=YEARLY;INTERVAL=2" })).toBe("Every 2 years");
  });

  it("formats completion-anchored recurrence", () => {
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=DAILY",
        recurrence_anchor: "completion_date",
      }),
    ).toBe("Repeats daily after completion");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=DAILY;INTERVAL=3",
        recurrence_anchor: "completion_date",
      }),
    ).toBe("Repeats every 3 days after completion");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=WEEKLY",
        recurrence_anchor: "completion_date",
      }),
    ).toBe("Repeats weekly after completion");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=WEEKLY;INTERVAL=2",
        recurrence_anchor: "completion_date",
      }),
    ).toBe("Repeats every 2 weeks after completion");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=MONTHLY",
        recurrence_anchor: "completion_date",
      }),
    ).toBe("Repeats monthly after completion");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=YEARLY",
        recurrence_anchor: "completion_date",
      }),
    ).toBe("Repeats yearly after completion");
  });

  it("formats custom rules", () => {
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=MONTHLY;BYDAY=2MO",
      }),
    ).toBe("Custom (FREQ=MONTHLY;BYDAY=2MO)");
    expect(
      formatRecurrenceSummary({
        rrule: "FREQ=MONTHLY;BYDAY=2MO",
        recurrence_count: 3,
      }),
    ).toBe("Custom (FREQ=MONTHLY;BYDAY=2MO), ending after 3 occurrences");
  });
});
