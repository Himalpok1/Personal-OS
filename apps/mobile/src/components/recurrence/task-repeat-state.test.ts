import {
  parseRRuleStringToEditorState,
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
} from "@personal-os/core/recurrence/editor";
import { EVERY_N_DAYS_MAX, EVERY_N_DAYS_MIN } from "@personal-os/core/recurrence/task-presets";
import { describe, expect, it } from "vitest";
import {
  applyDueDateChange,
  canAnchorOnCompletion,
  dueLocalOf,
  effectiveTimezone,
  isRepeatEnabled,
  needsDueDateHint,
  removeRepeat,
  selectionOf,
  selectPreset,
  setAfterCompletion,
  setInterval,
  summaryFor,
  type TaskRepeatContext,
} from "./task-repeat-state";

const TZ = "America/Chicago";
// A Monday, 09:00 Chicago (CDT, UTC-5).
const MONDAY_DUE = "2026-09-14T14:00:00.000Z";
// The 31st of a month -- last day, so monthly writes BYMONTHDAY=-1.
const MONTH_END_DUE = "2026-10-31T14:00:00.000Z";
// Injected clock: Wednesday 2026-09-16.
const NOW = new Date("2026-09-16T15:00:00.000Z");

function ctx(dueAt: string | null = MONDAY_DUE): TaskRepeatContext {
  return { dueAt, timezone: TZ, now: NOW };
}

function never(timezone: string | null = TZ): RecurrenceEditorState {
  return {
    enabled: false,
    frequency: "DAILY",
    interval: 1,
    weekdays: [],
    monthDay: null,
    endMode: "never",
    untilDate: null,
    count: null,
    anchor: "due_date",
    timezone,
    isCustom: false,
    rawRrule: null,
  };
}

function rrule(state: RecurrenceEditorState): string | null {
  return serializeEditorStateToRRule(state).rrule;
}

describe("dueLocalOf", () => {
  it("reads the due instant as a calendar date in the zone", () => {
    expect(dueLocalOf(MONDAY_DUE, TZ)).toEqual({ year: 2026, month: 9, day: 14 });
    // 03:00Z on the 15th is still the 14th in Chicago.
    expect(dueLocalOf("2026-09-15T03:00:00.000Z", TZ)).toEqual({ year: 2026, month: 9, day: 14 });
  });

  it("is null for no due date or an unparseable one", () => {
    expect(dueLocalOf(null, TZ)).toBeNull();
    expect(dueLocalOf("not a date", TZ)).toBeNull();
  });
});

describe("effectiveTimezone", () => {
  it("keeps a loaded rule's own zone and falls back to the device's", () => {
    expect(effectiveTimezone(never("Pacific/Auckland"), ctx())).toBe("Pacific/Auckland");
    expect(effectiveTimezone(never(null), ctx())).toBe(TZ);
  });
});

describe("selectPreset", () => {
  it("writes exactly one rule string per preset", () => {
    expect(rrule(selectPreset(never(), "daily", ctx()))).toBe("FREQ=DAILY");
    expect(rrule(selectPreset(never(), "weekdays", ctx()))).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    );
    expect(rrule(selectPreset(never(), "weekly", ctx()))).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(rrule(selectPreset(never(), "monthly", ctx()))).toBe("FREQ=MONTHLY;BYMONTHDAY=14");
    expect(rrule(selectPreset(never(), "every_n_days", ctx()))).toBe(
      `FREQ=DAILY;INTERVAL=${EVERY_N_DAYS_MIN}`,
    );
    expect(rrule(selectPreset(selectPreset(never(), "daily", ctx()), "never", ctx()))).toBeNull();
  });

  it("derives weekly and monthly from the due date, in the rule's zone", () => {
    expect(rrule(selectPreset(never(), "monthly", ctx(MONTH_END_DUE)))).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=-1",
    );
    // 03:00Z Tuesday is still Monday in Chicago -- the zone decides.
    expect(rrule(selectPreset(never(), "weekly", ctx("2026-09-15T03:00:00.000Z")))).toBe(
      "FREQ=WEEKLY;BYDAY=MO",
    );
    // A loaded rule keeps ITS zone: 03:00Z Tuesday is already Tuesday in London.
    expect(
      rrule(selectPreset(never("Europe/London"), "weekly", ctx("2026-09-15T03:00:00.000Z"))),
    ).toBe("FREQ=WEEKLY;BYDAY=TU");
  });

  it("falls back to today's weekday / day of month with no due date", () => {
    expect(rrule(selectPreset(never(), "weekly", ctx(null)))).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(rrule(selectPreset(never(), "monthly", ctx(null)))).toBe("FREQ=MONTHLY;BYMONTHDAY=16");
  });

  it("records the rule's timezone", () => {
    expect(serializeEditorStateToRRule(selectPreset(never(null), "daily", ctx()))).toMatchObject({
      recurrence_timezone: TZ,
      recurrence_anchor: "due_date",
    });
  });

  it("carries the completion anchor across presets, except onto Weekdays", () => {
    const dailyAfter = setAfterCompletion(selectPreset(never(), "daily", ctx()), true, ctx());
    expect(serializeEditorStateToRRule(dailyAfter).recurrence_anchor).toBe("completion_date");

    const weeklyAfter = selectPreset(dailyAfter, "weekly", ctx());
    expect(serializeEditorStateToRRule(weeklyAfter)).toMatchObject({
      rrule: "FREQ=WEEKLY",
      recurrence_anchor: "completion_date",
    });

    const weekdays = selectPreset(dailyAfter, "weekdays", ctx());
    expect(serializeEditorStateToRRule(weekdays)).toMatchObject({
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      recurrence_anchor: "due_date",
    });
  });

  it("keeps the every-N interval when switching away and back", () => {
    const everyThree = setInterval(never(), 3, ctx());
    const daily = selectPreset(everyThree, "daily", ctx());
    expect(rrule(daily)).toBe("FREQ=DAILY");
    // Daily is interval 1, so the 3 is gone once the preset is left...
    expect(rrule(selectPreset(daily, "every_n_days", ctx()))).toBe(
      `FREQ=DAILY;INTERVAL=${EVERY_N_DAYS_MIN}`,
    );
    // ...but an every-N state re-selecting every-N keeps its own value.
    expect(rrule(selectPreset(everyThree, "every_n_days", ctx()))).toBe("FREQ=DAILY;INTERVAL=3");
  });
});

describe("setInterval", () => {
  it("clamps to the supported range and selects Every N days", () => {
    expect(rrule(setInterval(never(), 3, ctx()))).toBe("FREQ=DAILY;INTERVAL=3");
    expect(rrule(setInterval(never(), 1, ctx()))).toBe(`FREQ=DAILY;INTERVAL=${EVERY_N_DAYS_MIN}`);
    expect(rrule(setInterval(never(), 0, ctx()))).toBe(`FREQ=DAILY;INTERVAL=${EVERY_N_DAYS_MIN}`);
    expect(rrule(setInterval(never(), 9999, ctx()))).toBe(
      `FREQ=DAILY;INTERVAL=${EVERY_N_DAYS_MAX}`,
    );
    expect(rrule(setInterval(never(), Number.NaN, ctx()))).toBe(
      `FREQ=DAILY;INTERVAL=${EVERY_N_DAYS_MIN}`,
    );
    expect(rrule(setInterval(never(), 2.9, ctx()))).toBe("FREQ=DAILY;INTERVAL=2");
  });

  it("keeps the completion anchor", () => {
    const after = setAfterCompletion(selectPreset(never(), "daily", ctx()), true, ctx());
    expect(serializeEditorStateToRRule(setInterval(after, 4, ctx()))).toMatchObject({
      rrule: "FREQ=DAILY;INTERVAL=4",
      recurrence_anchor: "completion_date",
    });
  });

  it("never rewrites a custom rule", () => {
    const custom = parseRRuleStringToEditorState("FREQ=YEARLY;BYMONTH=3", {
      recurrenceTimezone: TZ,
    });
    expect(setInterval(custom, 3, ctx())).toBe(custom);
  });
});

describe("setAfterCompletion", () => {
  it("drops the BY* part and anchors on completion", () => {
    const weekly = selectPreset(never(), "weekly", ctx());
    expect(serializeEditorStateToRRule(setAfterCompletion(weekly, true, ctx()))).toMatchObject({
      rrule: "FREQ=WEEKLY",
      recurrence_anchor: "completion_date",
    });
    const monthly = selectPreset(never(), "monthly", ctx());
    expect(serializeEditorStateToRRule(setAfterCompletion(monthly, true, ctx()))).toMatchObject({
      rrule: "FREQ=MONTHLY",
      recurrence_anchor: "completion_date",
    });
  });

  it("restores the due-date derivation when turned off again", () => {
    const weekly = selectPreset(never(), "weekly", ctx());
    const roundTrip = setAfterCompletion(setAfterCompletion(weekly, true, ctx()), false, ctx());
    expect(rrule(roundTrip)).toBe("FREQ=WEEKLY;BYDAY=MO");
  });

  it("is refused for Weekdays, Never and a custom rule", () => {
    const weekdays = selectPreset(never(), "weekdays", ctx());
    expect(setAfterCompletion(weekdays, true, ctx())).toBe(weekdays);
    expect(canAnchorOnCompletion(weekdays)).toBe(false);

    const off = never();
    expect(setAfterCompletion(off, true, ctx())).toBe(off);
    expect(canAnchorOnCompletion(off)).toBe(false);

    const custom = parseRRuleStringToEditorState("FREQ=WEEKLY;BYDAY=MO,WE", {
      recurrenceTimezone: TZ,
    });
    expect(setAfterCompletion(custom, true, ctx())).toBe(custom);
    expect(canAnchorOnCompletion(custom)).toBe(false);

    expect(canAnchorOnCompletion(selectPreset(never(), "daily", ctx()))).toBe(true);
    expect(canAnchorOnCompletion(selectPreset(never(), "every_n_days", ctx()))).toBe(true);
  });
});

describe("applyDueDateChange", () => {
  it("re-derives a weekly rule from the new due date", () => {
    const weekly = selectPreset(never(), "weekly", ctx());
    // Friday 2026-09-18.
    const moved = applyDueDateChange(weekly, ctx("2026-09-18T14:00:00.000Z"));
    expect(rrule(moved)).toBe("FREQ=WEEKLY;BYDAY=FR");
  });

  it("re-derives a monthly rule, including the last-day case", () => {
    const monthly = selectPreset(never(), "monthly", ctx());
    expect(rrule(applyDueDateChange(monthly, ctx(MONTH_END_DUE)))).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=-1",
    );
    expect(rrule(applyDueDateChange(monthly, ctx("2026-09-30T14:00:00.000Z")))).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=-1",
    );
    expect(rrule(applyDueDateChange(monthly, ctx("2026-10-30T14:00:00.000Z")))).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=30",
    );
  });

  it("leaves daily, every-N, completion-anchored, custom and never alone", () => {
    const daily = selectPreset(never(), "daily", ctx());
    expect(applyDueDateChange(daily, ctx(MONTH_END_DUE))).toBe(daily);

    const everyN = setInterval(never(), 5, ctx());
    expect(applyDueDateChange(everyN, ctx(MONTH_END_DUE))).toBe(everyN);

    const weeklyAfter = setAfterCompletion(selectPreset(never(), "weekly", ctx()), true, ctx());
    expect(applyDueDateChange(weeklyAfter, ctx(MONTH_END_DUE))).toBe(weeklyAfter);

    const custom = parseRRuleStringToEditorState("FREQ=WEEKLY;BYDAY=MO,WE", {
      recurrenceTimezone: TZ,
    });
    expect(applyDueDateChange(custom, ctx(MONTH_END_DUE))).toBe(custom);

    const off = never();
    expect(applyDueDateChange(off, ctx(MONTH_END_DUE))).toBe(off);
  });

  it("does not touch a Weekdays rule (its BYDAY is fixed, not derived)", () => {
    const weekdays = selectPreset(never(), "weekdays", ctx());
    expect(applyDueDateChange(weekdays, ctx("2026-09-19T14:00:00.000Z"))).toBe(weekdays);
  });
});

describe("custom detection and the two ways out", () => {
  it("round-trips a stored rule the presets cannot express as custom, unchanged", () => {
    const loaded = parseRRuleStringToEditorState("FREQ=WEEKLY;BYDAY=MO,WE,FR", {
      recurrenceTimezone: TZ,
      recurrenceCount: 10,
    });
    expect(selectionOf(loaded)).toEqual({ preset: "custom" });
    expect(isRepeatEnabled(loaded)).toBe(true);
    expect(serializeEditorStateToRRule(loaded)).toMatchObject({
      rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      recurrence_count: 10,
    });
  });

  it("reports a stored preset rule as that preset", () => {
    const loaded = parseRRuleStringToEditorState("FREQ=DAILY;INTERVAL=3", {
      recurrenceTimezone: TZ,
      recurrenceAnchor: "completion_date",
    });
    expect(selectionOf(loaded)).toEqual({
      preset: "every_n_days",
      interval: 3,
      afterCompletion: true,
    });
  });

  it("removeRepeat is the sanctioned discard", () => {
    const custom = parseRRuleStringToEditorState("FREQ=YEARLY", { recurrenceTimezone: TZ });
    const removed = removeRepeat(custom, ctx());
    expect(rrule(removed)).toBeNull();
    expect(isRepeatEnabled(removed)).toBe(false);
    expect(selectionOf(removed)).toEqual({ preset: "never", afterCompletion: false });
  });
});

describe("needsDueDateHint", () => {
  it("applies to any enabled repeat without a due date, including custom", () => {
    expect(needsDueDateHint(selectPreset(never(), "daily", ctx(null)), null)).toBe(true);
    expect(needsDueDateHint(selectPreset(never(), "daily", ctx()), MONDAY_DUE)).toBe(false);
    expect(needsDueDateHint(never(), null)).toBe(false);
    const custom = parseRRuleStringToEditorState("FREQ=YEARLY", { recurrenceTimezone: TZ });
    expect(needsDueDateHint(custom, null)).toBe(true);
  });

  it("does not serialize -- a half-typed until date in the advanced editor must not throw during render", () => {
    // The inline RecurrenceEditor holds "2026-1" between two keystrokes;
    // serializeEditorStateToRRule refuses it (resolveLocalUntilToInstant
    // throws), and this pair runs on every render of the field.
    const partial: RecurrenceEditorState = {
      ...parseRRuleStringToEditorState("FREQ=WEEKLY;BYDAY=MO,WE", { recurrenceTimezone: TZ }),
      endMode: "until",
      untilDate: "2026-1",
    };
    expect(() => serializeEditorStateToRRule(partial)).toThrow();
    expect(isRepeatEnabled(partial)).toBe(true);
    expect(needsDueDateHint(partial, null)).toBe(true);
    expect(needsDueDateHint(partial, MONDAY_DUE)).toBe(false);
    expect(isRepeatEnabled({ ...partial, enabled: false })).toBe(false);
  });
});

describe("summaryFor", () => {
  it("uses the preset vocabulary", () => {
    expect(summaryFor(never())).toBe("Does not repeat");
    expect(summaryFor(selectPreset(never(), "daily", ctx()))).toBe("Daily");
    expect(summaryFor(selectPreset(never(), "weekdays", ctx()))).toBe("Weekdays");
    expect(summaryFor(selectPreset(never(), "weekly", ctx()))).toBe("Weekly on Mon");
    expect(summaryFor(selectPreset(never(), "monthly", ctx()))).toBe("Monthly on the 14th");
    expect(summaryFor(selectPreset(never(), "monthly", ctx(MONTH_END_DUE)))).toBe(
      "Monthly on the last day",
    );
    expect(summaryFor(selectPreset(never(), "monthly", ctx("2026-10-30T14:00:00.000Z")))).toBe(
      "Monthly on the 30th (skips shorter months)",
    );
    expect(summaryFor(setInterval(never(), 3, ctx()))).toBe("Every 3 days");
    expect(summaryFor(setAfterCompletion(setInterval(never(), 3, ctx()), true, ctx()))).toBe(
      "Every 3 days after I complete it",
    );
    expect(summaryFor(setAfterCompletion(selectPreset(never(), "daily", ctx()), true, ctx()))).toBe(
      "Daily after I complete it",
    );
  });

  it("describes a custom rule without serializing it -- a half-typed until date must not throw", () => {
    const custom = parseRRuleStringToEditorState("FREQ=WEEKLY;BYDAY=MO,WE", {
      recurrenceTimezone: TZ,
    });
    expect(summaryFor(custom)).toBe("Weekly on Mon, Wed");
    const typing: RecurrenceEditorState = { ...custom, endMode: "until", untilDate: "2026-1" };
    expect(() => serializeEditorStateToRRule(typing)).toThrow();
    expect(() => summaryFor(typing)).not.toThrow();
  });
});
