import {
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
} from "@personal-os/core/recurrence/editor";
import { describe, expect, it } from "vitest";
import { applyEventStartChange, eventRepeatContext, eventStartInstant } from "./event-repeat-state";
import { selectPreset, summaryFor } from "./task-repeat-state";

const TZ = "America/Chicago";

const NEVER: RecurrenceEditorState = {
  enabled: false,
  frequency: "DAILY",
  interval: 1,
  weekdays: [],
  monthDay: null,
  endMode: "never",
  untilDate: null,
  count: null,
  anchor: "due_date",
  timezone: TZ,
  isCustom: false,
  rawRrule: null,
};

const rruleOf = (state: RecurrenceEditorState) => serializeEditorStateToRRule(state).rrule;

describe("eventStartInstant", () => {
  it("reads a timed start as the instant it is", () => {
    expect(
      eventStartInstant(
        { allDay: false, startDate: null, startsAt: "2026-09-14T09:00:00-05:00" },
        TZ,
      ),
    ).toBe("2026-09-14T14:00:00.000Z");
  });

  it("reads an all-day start as LOCAL NOON of that date in the zone -- the same calendar day at any offset", () => {
    // UTC midnight of 2026-09-14 would be Sept 13 in Chicago; noon is not.
    expect(eventStartInstant({ allDay: true, startDate: "2026-09-14", startsAt: null }, TZ)).toBe(
      "2026-09-14T17:00:00.000Z",
    );
    expect(
      eventStartInstant(
        { allDay: true, startDate: "2026-09-14", startsAt: null },
        "Pacific/Auckland",
      ),
    ).toBe("2026-09-14T00:00:00.000Z");
  });

  it("is null for an absent or unreadable start", () => {
    expect(eventStartInstant({ allDay: true, startDate: null, startsAt: null }, TZ)).toBeNull();
    expect(
      eventStartInstant({ allDay: true, startDate: "2026-9-1", startsAt: null }, TZ),
    ).toBeNull();
    expect(eventStartInstant({ allDay: false, startDate: null, startsAt: "nope" }, TZ)).toBeNull();
  });
});

describe("event presets map to the exact RRULE strings, derived from the START", () => {
  // Mon 2026-09-14 09:00 Chicago.
  const MONDAY = eventRepeatContext(
    { allDay: false, startDate: null, startsAt: "2026-09-14T09:00:00-05:00" },
    TZ,
  );

  it("Daily / Weekdays / Every N days carry no BY* part", () => {
    expect(rruleOf(selectPreset(NEVER, "daily", MONDAY))).toBe("FREQ=DAILY");
    expect(rruleOf(selectPreset(NEVER, "weekdays", MONDAY))).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    );
    expect(rruleOf(selectPreset(NEVER, "every_n_days", MONDAY))).toBe("FREQ=DAILY;INTERVAL=2");
  });

  it("Weekly writes the start's weekday; Monthly the start's day of month, -1 at month-end", () => {
    expect(rruleOf(selectPreset(NEVER, "weekly", MONDAY))).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(rruleOf(selectPreset(NEVER, "monthly", MONDAY))).toBe("FREQ=MONTHLY;BYMONTHDAY=14");
    const monthEnd = eventRepeatContext(
      { allDay: true, startDate: "2026-09-30", startsAt: null },
      TZ,
    );
    expect(rruleOf(selectPreset(NEVER, "monthly", monthEnd))).toBe("FREQ=MONTHLY;BYMONTHDAY=-1");
    expect(rruleOf(selectPreset(NEVER, "weekly", monthEnd))).toBe("FREQ=WEEKLY;BYDAY=WE");
  });

  it("an all-day start late in a negative-offset zone still derives from ITS date, not the UTC date", () => {
    // 2026-09-13 is a Sunday. `new Date("2026-09-13")` is UTC midnight, which
    // Chicago reads as Saturday the 12th -- the bug the noon anchor prevents.
    const sunday = eventRepeatContext(
      { allDay: true, startDate: "2026-09-13", startsAt: null },
      TZ,
    );
    expect(rruleOf(selectPreset(NEVER, "weekly", sunday))).toBe("FREQ=WEEKLY;BYDAY=SU");
  });

  it("the summary reads in the preset vocabulary with no completion suffix", () => {
    expect(summaryFor(selectPreset(NEVER, "weekly", MONDAY))).toBe("Weekly on Mon");
    expect(summaryFor(selectPreset(NEVER, "every_n_days", MONDAY))).toBe("Every 2 days");
  });
});

describe("applyEventStartChange re-derives Weekly/Monthly when the start moves", () => {
  const monday = { allDay: false as const, startDate: null, startsAt: "2026-09-14T09:00:00-05:00" };
  const thursday = {
    allDay: false as const,
    startDate: null,
    startsAt: "2026-09-17T09:00:00-05:00",
  };

  it("Weekly follows the new weekday, Monthly the new day of month", () => {
    const weekly = selectPreset(NEVER, "weekly", eventRepeatContext(monday, TZ));
    expect(rruleOf(applyEventStartChange(weekly, thursday, TZ))).toBe("FREQ=WEEKLY;BYDAY=TH");
    const monthly = selectPreset(NEVER, "monthly", eventRepeatContext(monday, TZ));
    expect(rruleOf(applyEventStartChange(monthly, thursday, TZ))).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=17",
    );
  });

  it("switching to all-day re-derives from the calendar date", () => {
    const weekly = selectPreset(NEVER, "weekly", eventRepeatContext(monday, TZ));
    const next = applyEventStartChange(
      weekly,
      { allDay: true, startDate: "2026-09-19", startsAt: null },
      TZ,
    );
    expect(rruleOf(next)).toBe("FREQ=WEEKLY;BYDAY=SA");
  });

  it("leaves Daily, Never and a custom rule untouched", () => {
    const daily = selectPreset(NEVER, "daily", eventRepeatContext(monday, TZ));
    expect(applyEventStartChange(daily, thursday, TZ)).toBe(daily);
    expect(applyEventStartChange(NEVER, thursday, TZ)).toBe(NEVER);
    const custom: RecurrenceEditorState = {
      ...NEVER,
      enabled: true,
      isCustom: true,
      rawRrule: "FREQ=YEARLY",
    };
    expect(applyEventStartChange(custom, thursday, TZ)).toBe(custom);
  });
});
