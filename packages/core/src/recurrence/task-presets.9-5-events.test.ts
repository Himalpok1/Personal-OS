import { describe, expect, it } from "vitest";
import { toWallClockComponents } from "../timezone.js";
import { parseRRuleStringToEditorState, serializeEditorStateToRRule } from "./editor.js";
import {
  describeTaskRepeat,
  editorStateToPreset,
  presetToEditorState,
  type TaskRepeatPreset,
} from "./task-presets.js";
import { validateEventRecurrenceRule } from "./validation.js";

// Checkpoint 9.5 (Lane E): the event Repeat field is "a copy of
// TaskRepeatField minus the completion chip" (contract §8), so it drives the
// SAME preset module with `afterCompletion: false` and stores the result with
// `recurrence_anchor: null` (events have no anchor column semantics). These
// tests pin exactly the RRULE strings an event will persist for each preset,
// the summaries the detail screen renders, and the preset<->state round trip
// with a null anchor -- so Lane D's copy and the server's validator agree by
// construction.

const TZ = "America/Chicago";

function eventRruleFor(preset: TaskRepeatPreset, startLocalIso: string, interval?: number) {
  const startLocal = toWallClockComponents(new Date(startLocalIso), TZ);
  return serializeEditorStateToRRule(
    presetToEditorState(preset, {
      dueLocal: startLocal,
      timezone: TZ,
      afterCompletion: false,
      ...(interval === undefined ? {} : { interval }),
    }),
  );
}

describe("event presets -> exact RRULE strings (afterCompletion: false)", () => {
  it("Never -> rrule null and every recurrence column null", () => {
    expect(eventRruleFor("never", "2026-09-14T09:00:00-05:00")).toEqual({
      rrule: null,
      recurrence_timezone: null,
      recurrence_until: null,
      recurrence_count: null,
      recurrence_anchor: null,
    });
  });

  it("Daily -> FREQ=DAILY", () => {
    expect(eventRruleFor("daily", "2026-09-14T09:00:00-05:00").rrule).toBe("FREQ=DAILY");
  });

  it("Weekdays -> FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR regardless of the start weekday", () => {
    expect(eventRruleFor("weekdays", "2026-09-13T09:00:00-05:00").rrule).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    ); // a Sunday start
    expect(eventRruleFor("weekdays", "2026-09-16T09:00:00-05:00").rrule).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    );
  });

  it("Weekly -> explicit BYDAY of the START's LOCAL weekday, derived in the event zone (not UTC)", () => {
    // 2026-09-14T23:30 Chicago is Monday locally but already Tuesday in UTC
    // (04:30Z on the 15th). The preset must say MO.
    expect(eventRruleFor("weekly", "2026-09-14T23:30:00-05:00").rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(eventRruleFor("weekly", "2026-09-19T09:00:00-05:00").rrule).toBe("FREQ=WEEKLY;BYDAY=SA");
  });

  it("Monthly -> BYMONTHDAY=<d> for a mid-month start, and -1 for ANY month-end start (Feb 28 common year, Apr 30, May 31)", () => {
    expect(eventRruleFor("monthly", "2026-09-15T09:00:00-05:00").rrule).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=15",
    );
    expect(eventRruleFor("monthly", "2026-02-28T09:00:00-06:00").rrule).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=-1",
    );
    expect(eventRruleFor("monthly", "2028-02-28T09:00:00-06:00").rrule).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=28",
    ); // leap year: Feb 28 is NOT month-end
    expect(eventRruleFor("monthly", "2028-02-29T09:00:00-06:00").rrule).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=-1",
    );
    expect(eventRruleFor("monthly", "2026-04-30T09:00:00-05:00").rrule).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=-1",
    );
    expect(eventRruleFor("monthly", "2026-05-31T09:00:00-05:00").rrule).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=-1",
    );
    // A 30th that is not month-end keeps its literal day (documented: skips shorter months).
    expect(eventRruleFor("monthly", "2026-09-30T09:00:00-05:00").rrule).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=-1",
    ); // Sept has 30 days -> month-end -> -1
    expect(eventRruleFor("monthly", "2026-10-30T09:00:00-05:00").rrule).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=30",
    );
  });

  it("Monthly derives the day from the LOCAL date -- a late-evening 31st in Chicago (UTC already the 1st) is still month-end", () => {
    expect(eventRruleFor("monthly", "2026-08-31T23:30:00-05:00").rrule).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=-1",
    );
  });

  it("Every N days -> FREQ=DAILY;INTERVAL=N", () => {
    expect(eventRruleFor("every_n_days", "2026-09-14T09:00:00-05:00", 3).rrule).toBe(
      "FREQ=DAILY;INTERVAL=3",
    );
    expect(() => eventRruleFor("every_n_days", "2026-09-14T09:00:00-05:00", 1)).toThrow();
  });

  it("every preset's RRULE passes validateEventRecurrenceRule with the event's zone", () => {
    const rrules = [
      eventRruleFor("daily", "2026-09-14T09:00:00-05:00").rrule,
      eventRruleFor("weekdays", "2026-09-14T09:00:00-05:00").rrule,
      eventRruleFor("weekly", "2026-09-14T09:00:00-05:00").rrule,
      eventRruleFor("monthly", "2026-09-15T09:00:00-05:00").rrule,
      eventRruleFor("monthly", "2026-09-30T09:00:00-05:00").rrule,
      eventRruleFor("every_n_days", "2026-09-14T09:00:00-05:00", 5).rrule,
    ];
    for (const rrule of rrules) {
      expect(rrule).not.toBeNull();
      expect(() => validateEventRecurrenceRule(rrule!, TZ), rrule!).not.toThrow();
    }
  });

  it("serializes recurrence_anchor 'due_date' from the preset state -- an EVENT writer must map that to null before persisting", () => {
    // presetToEditorState has no "no anchor" mode: with afterCompletion false
    // it emits anchor "due_date". Events carry no anchor, so the event
    // composer drops it. Pinned so the copy in apps/mobile is made
    // deliberately rather than by passing the task shape through.
    expect(eventRruleFor("daily", "2026-09-14T09:00:00-05:00").recurrence_anchor).toBe("due_date");
    expect(eventRruleFor("daily", "2026-09-14T09:00:00-05:00").recurrence_timezone).toBe(TZ);
  });
});

describe("describeTaskRepeat for event-shaped fields (recurrence_anchor: null)", () => {
  const cases: Array<[string, string]> = [
    ["FREQ=DAILY", "Daily"],
    ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "Weekdays"],
    ["FREQ=WEEKLY;BYDAY=MO", "Weekly on Mon"],
    ["FREQ=WEEKLY;BYDAY=SU", "Weekly on Sun"],
    ["FREQ=WEEKLY", "Weekly"],
    ["FREQ=MONTHLY;BYMONTHDAY=15", "Monthly on the 15th"],
    ["FREQ=MONTHLY;BYMONTHDAY=1", "Monthly on the 1st"],
    ["FREQ=MONTHLY;BYMONTHDAY=2", "Monthly on the 2nd"],
    ["FREQ=MONTHLY;BYMONTHDAY=3", "Monthly on the 3rd"],
    ["FREQ=MONTHLY;BYMONTHDAY=11", "Monthly on the 11th"],
    ["FREQ=MONTHLY;BYMONTHDAY=22", "Monthly on the 22nd"],
    ["FREQ=MONTHLY;BYMONTHDAY=30", "Monthly on the 30th (skips shorter months)"],
    ["FREQ=MONTHLY;BYMONTHDAY=31", "Monthly on the 31st (skips shorter months)"],
    ["FREQ=MONTHLY;BYMONTHDAY=-1", "Monthly on the last day"],
    ["FREQ=MONTHLY", "Monthly"],
    ["FREQ=DAILY;INTERVAL=3", "Every 3 days"],
  ];
  for (const [rrule, expected] of cases) {
    it(`${rrule} -> "${expected}"`, () => {
      expect(describeTaskRepeat({ rrule, recurrence_anchor: null, recurrence_timezone: TZ })).toBe(
        expected,
      );
    });
  }

  it("null rrule -> 'Does not repeat'", () => {
    expect(
      describeTaskRepeat({ rrule: null, recurrence_anchor: null, recurrence_timezone: null }),
    ).toBe("Does not repeat");
  });

  it("never appends 'after I complete it' when the anchor is null, even for a bare FREQ+INTERVAL rule", () => {
    for (const rrule of ["FREQ=DAILY", "FREQ=DAILY;INTERVAL=2", "FREQ=WEEKLY", "FREQ=MONTHLY"]) {
      expect(
        describeTaskRepeat({ rrule, recurrence_anchor: null, recurrence_timezone: TZ }),
      ).not.toContain("after I complete it");
    }
  });

  it("an until/count end or a rule outside the vocabulary falls back to the full summary (custom), still without anchor wording", () => {
    const withUntil = describeTaskRepeat({
      rrule: "FREQ=DAILY",
      recurrence_anchor: null,
      recurrence_timezone: TZ,
      recurrence_until: new Date("2026-12-31T05:59:59.999Z"),
    });
    expect(withUntil).not.toBe("Daily");
    expect(withUntil).not.toContain("after I complete it");
    const yearly = describeTaskRepeat({
      rrule: "FREQ=YEARLY",
      recurrence_anchor: null,
      recurrence_timezone: TZ,
    });
    expect(yearly).not.toBe("Does not repeat");
    expect(yearly).not.toContain("after I complete it");
  });
});

describe("round trip: editorStateToPreset ∘ presetToEditorState with a null-anchor event row", () => {
  const presets: Array<{ preset: TaskRepeatPreset; startIso: string; interval?: number }> = [
    { preset: "daily", startIso: "2026-09-14T09:00:00-05:00" },
    { preset: "weekdays", startIso: "2026-09-14T09:00:00-05:00" },
    { preset: "weekly", startIso: "2026-09-16T09:00:00-05:00" },
    { preset: "monthly", startIso: "2026-09-15T09:00:00-05:00" },
    { preset: "monthly", startIso: "2026-09-30T09:00:00-05:00" },
    { preset: "every_n_days", startIso: "2026-09-14T09:00:00-05:00", interval: 4 },
  ];

  for (const { preset, startIso, interval } of presets) {
    it(`${preset}${interval ? ` (N=${interval})` : ""}: serialize -> store with anchor null -> parse -> same preset, afterCompletion false`, () => {
      const serialized = eventRruleFor(preset, startIso, interval);
      // What an event row would hold: the rrule + zone, anchor NULL.
      const parsed = parseRRuleStringToEditorState(serialized.rrule, {
        recurrenceTimezone: serialized.recurrence_timezone,
        recurrenceUntil: null,
        recurrenceCount: null,
        recurrenceAnchor: null,
      });
      expect(parsed.isCustom).toBe(false);
      expect(parsed.anchor).toBe("due_date"); // null anchor parses as the due-date default
      const selection = editorStateToPreset(parsed);
      expect(selection.preset).toBe(preset);
      expect("afterCompletion" in selection ? selection.afterCompletion : false).toBe(false);
      if (preset === "every_n_days") {
        expect(selection).toEqual({ preset, interval, afterCompletion: false });
      }
      // And re-serialising the parsed state reproduces the identical rrule.
      expect(serializeEditorStateToRRule(parsed).rrule).toBe(serialized.rrule);
    });
  }

  it("the direct state round trip (no persistence) is identity for every preset", () => {
    const startLocal = toWallClockComponents(new Date("2026-09-15T09:00:00-05:00"), TZ);
    for (const preset of ["daily", "weekdays", "weekly", "monthly"] as const) {
      const state = presetToEditorState(preset, {
        dueLocal: startLocal,
        timezone: TZ,
        afterCompletion: false,
      });
      expect(editorStateToPreset(state)).toEqual({ preset, afterCompletion: false });
    }
    const n = presetToEditorState("every_n_days", {
      dueLocal: startLocal,
      timezone: TZ,
      afterCompletion: false,
      interval: 7,
    });
    expect(editorStateToPreset(n)).toEqual({
      preset: "every_n_days",
      interval: 7,
      afterCompletion: false,
    });
    const never = presetToEditorState("never", { dueLocal: startLocal, timezone: TZ });
    expect(editorStateToPreset(never)).toEqual({ preset: "never", afterCompletion: false });
  });

  it("a rule the event field cannot author reports custom and is never rewritten (BYDAY=MO,WE; YEARLY; INTERVAL on WEEKLY)", () => {
    for (const rrule of [
      "FREQ=WEEKLY;BYDAY=MO,WE",
      "FREQ=YEARLY",
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
    ]) {
      const parsed = parseRRuleStringToEditorState(rrule, {
        recurrenceTimezone: TZ,
        recurrenceAnchor: null,
      });
      expect(editorStateToPreset(parsed), rrule).toEqual({ preset: "custom" });
      expect(serializeEditorStateToRRule(parsed).rrule, rrule).toBe(rrule);
    }
  });
});
