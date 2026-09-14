import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toWallClockComponents } from "../timezone.js";
import { parseRRuleStringToEditorState, serializeEditorStateToRRule } from "./editor.js";
import { validateCompletionAnchoredRule } from "./lazy-next-occurrence.js";
import {
  daysInMonth,
  describeTaskRepeat,
  editorStateToPreset,
  EVERY_N_DAYS_MAX,
  EVERY_N_DAYS_MIN,
  isLastDayOfMonth,
  monthlyMonthDayFor,
  presetToEditorState,
  TASK_REPEAT_PRESETS,
  weekdayOfLocalDate,
  type TaskRepeatPreset,
} from "./task-presets.js";

const TZ = "America/Chicago";

function rruleFor(preset: TaskRepeatPreset, dueIso: string | null, extra = {}): string | null {
  const dueLocal = dueIso === null ? null : toWallClockComponents(new Date(dueIso), TZ);
  return serializeEditorStateToRRule(
    presetToEditorState(preset, { dueLocal, timezone: TZ, ...extra }),
  ).rrule;
}

describe("client-safety of the task-presets module", () => {
  it("imports neither rrule, node builtins, createRequire nor the core barrel", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./task-presets.ts", import.meta.url)),
      "utf8",
    );
    // Comments are stripped first so the guard cannot be satisfied -- or
    // tripped -- by prose (the 9.0 containment-guard precedent).
    const code = source.replace(/^\s*\/\/.*$/gm, "");
    const specifiers = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(specifiers.sort()).toEqual(["../timezone.js", "./editor.js"]);
    expect(code).not.toMatch(/createRequire|node:|require\(/);
  });
});

describe("calendar helpers", () => {
  it("weekdayOfLocalDate maps calendar dates to RFC 5545 codes", () => {
    expect(weekdayOfLocalDate({ year: 2026, month: 9, day: 13 })).toBe("SU"); // today
    expect(weekdayOfLocalDate({ year: 2026, month: 9, day: 14 })).toBe("MO");
    expect(weekdayOfLocalDate({ year: 2026, month: 3, day: 8 })).toBe("SU"); // spring-forward
    expect(weekdayOfLocalDate({ year: 2026, month: 11, day: 1 })).toBe("SU"); // fall-back
    expect(weekdayOfLocalDate({ year: 2026, month: 1, day: 31 })).toBe("SA");
  });

  it("daysInMonth / isLastDayOfMonth handle leap years and month ends", () => {
    expect(daysInMonth({ year: 2026, month: 2, day: 1 })).toBe(28);
    expect(daysInMonth({ year: 2028, month: 2, day: 1 })).toBe(29);
    expect(daysInMonth({ year: 2100, month: 2, day: 1 })).toBe(28); // century, not leap
    expect(daysInMonth({ year: 2026, month: 12, day: 1 })).toBe(31);
    expect(isLastDayOfMonth({ year: 2026, month: 2, day: 28 })).toBe(true);
    expect(isLastDayOfMonth({ year: 2028, month: 2, day: 28 })).toBe(false);
    expect(isLastDayOfMonth({ year: 2026, month: 4, day: 30 })).toBe(true);
    expect(isLastDayOfMonth({ year: 2026, month: 1, day: 30 })).toBe(false);
  });

  it("monthlyMonthDayFor: ≤28 literal, month-end → -1, 29/30 not month-end → literal", () => {
    expect(monthlyMonthDayFor({ year: 2026, month: 1, day: 15 })).toBe(15);
    expect(monthlyMonthDayFor({ year: 2026, month: 1, day: 28 })).toBe(28);
    expect(monthlyMonthDayFor({ year: 2026, month: 1, day: 31 })).toBe(-1);
    expect(monthlyMonthDayFor({ year: 2026, month: 4, day: 30 })).toBe(-1);
    // The LAST day of ANY month is -1 -- Feb 28 in a common year included
    // (9.4 review: a `day <= 28` short-circuit used to report 28). In a leap
    // year Feb 28 is not month-end and stays literal.
    expect(monthlyMonthDayFor({ year: 2026, month: 2, day: 28 })).toBe(-1);
    expect(monthlyMonthDayFor({ year: 2028, month: 2, day: 28 })).toBe(28); // leap Feb
    expect(monthlyMonthDayFor({ year: 2028, month: 2, day: 29 })).toBe(-1);
    expect(monthlyMonthDayFor({ year: 2026, month: 1, day: 30 })).toBe(30);
    expect(monthlyMonthDayFor({ year: 2026, month: 1, day: 29 })).toBe(29);
  });
});

describe("presetToEditorState → serializeEditorStateToRRule (exact strings)", () => {
  // Wednesday 2026-09-16 09:00 Chicago.
  const DUE = "2026-09-16T14:00:00.000Z";

  it("never → rrule null", () => {
    expect(rruleFor("never", DUE)).toBeNull();
    const serialized = serializeEditorStateToRRule(
      presetToEditorState("never", { dueLocal: null, timezone: TZ }),
    );
    expect(serialized).toEqual({
      rrule: null,
      recurrence_timezone: null,
      recurrence_until: null,
      recurrence_count: null,
      recurrence_anchor: null,
    });
  });

  it("daily → FREQ=DAILY", () => {
    expect(rruleFor("daily", DUE)).toBe("FREQ=DAILY");
    expect(rruleFor("daily", null)).toBe("FREQ=DAILY");
  });

  it("weekdays → FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR regardless of the due weekday", () => {
    expect(rruleFor("weekdays", DUE)).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(rruleFor("weekdays", "2026-09-13T14:00:00.000Z")).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    );
    expect(rruleFor("weekdays", null)).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  });

  it("weekly ALWAYS writes an explicit BYDAY of the due weekday", () => {
    expect(rruleFor("weekly", DUE)).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(rruleFor("weekly", "2026-09-13T14:00:00.000Z")).toBe("FREQ=WEEKLY;BYDAY=SU");
  });

  it("weekly reads the weekday in the RECURRENCE zone, not UTC", () => {
    // 2026-09-16 23:30 Chicago is 2026-09-17 04:30Z (Thursday in UTC, Wednesday locally).
    const dueLocal = toWallClockComponents(new Date("2026-09-17T04:30:00.000Z"), TZ);
    expect(dueLocal.day).toBe(16);
    const rrule = serializeEditorStateToRRule(
      presetToEditorState("weekly", { dueLocal, timezone: TZ }),
    ).rrule;
    expect(rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
  });

  it("weekly with no due date falls back to today's weekday in the zone (injected clock)", () => {
    // 2026-09-14 00:30 Chicago = 2026-09-14T05:30Z: Monday locally AND in UTC;
    // 2026-09-13 23:30 Chicago = 2026-09-14T04:30Z: Sunday locally, Monday in UTC.
    expect(rruleFor("weekly", null, { now: new Date("2026-09-14T05:30:00.000Z") })).toBe(
      "FREQ=WEEKLY;BYDAY=MO",
    );
    expect(rruleFor("weekly", null, { now: new Date("2026-09-14T04:30:00.000Z") })).toBe(
      "FREQ=WEEKLY;BYDAY=SU",
    );
  });

  it("monthly: day ≤ 28 → BYMONTHDAY=<d>", () => {
    expect(rruleFor("monthly", DUE)).toBe("FREQ=MONTHLY;BYMONTHDAY=16");
    expect(rruleFor("monthly", "2026-02-01T15:00:00.000Z")).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
    expect(rruleFor("monthly", "2026-01-28T15:00:00.000Z")).toBe("FREQ=MONTHLY;BYMONTHDAY=28");
  });

  it("monthly: a due date that IS the last day of its month → BYMONTHDAY=-1", () => {
    expect(rruleFor("monthly", "2026-01-31T15:00:00.000Z")).toBe("FREQ=MONTHLY;BYMONTHDAY=-1");
    expect(rruleFor("monthly", "2026-04-30T14:00:00.000Z")).toBe("FREQ=MONTHLY;BYMONTHDAY=-1");
    expect(rruleFor("monthly", "2028-02-29T15:00:00.000Z")).toBe("FREQ=MONTHLY;BYMONTHDAY=-1");
    // Feb 28 of a common year is month-end too (9.4 review).
    expect(rruleFor("monthly", "2026-02-28T15:00:00.000Z")).toBe("FREQ=MONTHLY;BYMONTHDAY=-1");
  });

  it("monthly: 29/30 that is NOT the last day → literal BYMONTHDAY (rrule skips shorter months)", () => {
    expect(rruleFor("monthly", "2026-01-30T15:00:00.000Z")).toBe("FREQ=MONTHLY;BYMONTHDAY=30");
    expect(rruleFor("monthly", "2026-01-29T15:00:00.000Z")).toBe("FREQ=MONTHLY;BYMONTHDAY=29");
    expect(rruleFor("monthly", "2028-02-28T15:00:00.000Z")).toBe("FREQ=MONTHLY;BYMONTHDAY=28");
  });

  it("monthly reads the day in the RECURRENCE zone (month-end at 23:30 local is still month-end)", () => {
    // 2026-01-31 23:30 Chicago = 2026-02-01 05:30Z.
    const dueLocal = toWallClockComponents(new Date("2026-02-01T05:30:00.000Z"), TZ);
    expect(dueLocal).toMatchObject({ month: 1, day: 31 });
    expect(
      serializeEditorStateToRRule(presetToEditorState("monthly", { dueLocal, timezone: TZ })).rrule,
    ).toBe("FREQ=MONTHLY;BYMONTHDAY=-1");
  });

  it("monthly with no due date falls back to today's day of month (injected clock)", () => {
    expect(rruleFor("monthly", null, { now: new Date("2026-09-15T12:00:00.000Z") })).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=15",
    );
    expect(rruleFor("monthly", null, { now: new Date("2026-09-30T12:00:00.000Z") })).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=-1",
    );
  });

  it("every_n_days → FREQ=DAILY;INTERVAL=<N> within [2, 365]", () => {
    expect(rruleFor("every_n_days", DUE, { interval: 3 })).toBe("FREQ=DAILY;INTERVAL=3");
    expect(rruleFor("every_n_days", null, { interval: EVERY_N_DAYS_MIN })).toBe(
      "FREQ=DAILY;INTERVAL=2",
    );
    expect(rruleFor("every_n_days", null, { interval: EVERY_N_DAYS_MAX })).toBe(
      "FREQ=DAILY;INTERVAL=365",
    );
  });

  it("every_n_days rejects a missing, non-integer or out-of-range interval", () => {
    for (const interval of [undefined, 1, 0, -3, 366, 2.5, Number.NaN]) {
      expect(() =>
        presetToEditorState("every_n_days", { dueLocal: null, timezone: TZ, interval }),
      ).toThrow(/integer interval between 2 and 365/);
    }
  });

  it("records the recurrence timezone and the due_date anchor", () => {
    const serialized = serializeEditorStateToRRule(
      presetToEditorState("daily", { dueLocal: null, timezone: "Europe/London" }),
    );
    expect(serialized.recurrence_timezone).toBe("Europe/London");
    expect(serialized.recurrence_anchor).toBe("due_date");
    expect(serialized.recurrence_until).toBeNull();
    expect(serialized.recurrence_count).toBeNull();
  });
});

describe("afterCompletion (completion_date anchor)", () => {
  const DUE = "2026-09-16T14:00:00.000Z";

  it("daily / weekly / monthly / every_n_days emit FREQ(+INTERVAL) only, anchored on completion", () => {
    const cases: Array<[TaskRepeatPreset, string, Record<string, unknown>]> = [
      ["daily", "FREQ=DAILY", {}],
      ["weekly", "FREQ=WEEKLY", {}],
      ["monthly", "FREQ=MONTHLY", {}],
      ["every_n_days", "FREQ=DAILY;INTERVAL=3", { interval: 3 }],
    ];
    for (const [preset, expected, extra] of cases) {
      const serialized = serializeEditorStateToRRule(
        presetToEditorState(preset, {
          dueLocal: toWallClockComponents(new Date(DUE), TZ),
          timezone: TZ,
          afterCompletion: true,
          ...extra,
        }),
      );
      expect(serialized.rrule).toBe(expected);
      expect(serialized.recurrence_anchor).toBe("completion_date");
      // The rule the API will validate at write time must pass the
      // completion-anchored grammar exactly as emitted.
      expect(() => validateCompletionAnchoredRule(serialized.rrule as string)).not.toThrow();
    }
  });

  it("weekdays + afterCompletion throws (no FREQ+INTERVAL rendering exists)", () => {
    expect(() =>
      presetToEditorState("weekdays", { dueLocal: null, timezone: TZ, afterCompletion: true }),
    ).toThrow(/weekdays cannot be anchored on completion/);
  });

  it("never ignores afterCompletion", () => {
    const state = presetToEditorState("never", {
      dueLocal: null,
      timezone: TZ,
      afterCompletion: true,
    });
    expect(state.enabled).toBe(false);
    expect(serializeEditorStateToRRule(state).rrule).toBeNull();
  });
});

describe("editorStateToPreset (round trip and refusal)", () => {
  const DUE = "2026-09-16T14:00:00.000Z";
  const dueLocal = toWallClockComponents(new Date(DUE), TZ);

  it("round-trips every preset through serialize → parse → preset", () => {
    for (const preset of TASK_REPEAT_PRESETS) {
      for (const afterCompletion of [false, true]) {
        if (preset === "weekdays" && afterCompletion) continue;
        const opts = { dueLocal, timezone: TZ, afterCompletion, interval: 4 };
        const serialized = serializeEditorStateToRRule(presetToEditorState(preset, opts));
        const parsed = parseRRuleStringToEditorState(serialized.rrule, {
          recurrenceTimezone: serialized.recurrence_timezone,
          recurrenceAnchor: serialized.recurrence_anchor,
        });
        const selection = editorStateToPreset(parsed);
        if (preset === "never") {
          expect(selection).toEqual({ preset: "never", afterCompletion: false });
        } else if (preset === "every_n_days") {
          expect(selection).toEqual({ preset, interval: 4, afterCompletion });
        } else {
          expect(selection).toEqual({ preset, afterCompletion });
        }
      }
    }
  });

  it("recognises the last-day monthly rule as the monthly preset", () => {
    expect(
      editorStateToPreset(parseRRuleStringToEditorState("FREQ=MONTHLY;BYMONTHDAY=-1")),
    ).toEqual({ preset: "monthly", afterCompletion: false });
  });

  it("a bare due_date FREQ=WEEKLY / FREQ=MONTHLY is the weekly / monthly preset (9.4 review)", () => {
    // The pre-9.4 editor wrote exactly these for "Weekly" and "Monthly", and
    // on a due_date anchor the server re-anchors a bare rule on the new
    // DTSTART at every due-date edit, so they are behaviour-identical to the
    // explicit BYDAY / BYMONTHDAY the preset writes. Reporting them as custom
    // would render every existing Weekly task as "Custom repeat rule".
    expect(editorStateToPreset(parseRRuleStringToEditorState("FREQ=WEEKLY"))).toEqual({
      preset: "weekly",
      afterCompletion: false,
    });
    expect(editorStateToPreset(parseRRuleStringToEditorState("FREQ=WEEKLY;INTERVAL=1"))).toEqual({
      preset: "weekly",
      afterCompletion: false,
    });
    expect(editorStateToPreset(parseRRuleStringToEditorState("FREQ=MONTHLY"))).toEqual({
      preset: "monthly",
      afterCompletion: false,
    });
    // The completion_date mapping is unchanged: bare is the preset, BY* is custom.
    expect(
      editorStateToPreset(
        parseRRuleStringToEditorState("FREQ=WEEKLY", { recurrenceAnchor: "completion_date" }),
      ),
    ).toEqual({ preset: "weekly", afterCompletion: true });
    expect(
      editorStateToPreset(
        parseRRuleStringToEditorState("FREQ=MONTHLY", { recurrenceAnchor: "completion_date" }),
      ),
    ).toEqual({ preset: "monthly", afterCompletion: true });
    // An interval or an end still makes them custom.
    expect(editorStateToPreset(parseRRuleStringToEditorState("FREQ=WEEKLY;INTERVAL=2"))).toEqual({
      preset: "custom",
    });
    expect(editorStateToPreset(parseRRuleStringToEditorState("FREQ=MONTHLY;INTERVAL=2"))).toEqual({
      preset: "custom",
    });
    expect(
      editorStateToPreset(parseRRuleStringToEditorState("FREQ=WEEKLY", { recurrenceCount: 4 })),
    ).toEqual({ preset: "custom" });
  });

  it("describes the bare rules in the preset vocabulary", () => {
    expect(
      describeTaskRepeat({
        rrule: "FREQ=WEEKLY",
        recurrence_anchor: "due_date",
        recurrence_timezone: TZ,
      }),
    ).toBe("Weekly");
    expect(
      describeTaskRepeat({
        rrule: "FREQ=MONTHLY",
        recurrence_anchor: "due_date",
        recurrence_timezone: TZ,
      }),
    ).toBe("Monthly");
  });

  it("reports custom for anything the presets cannot reproduce byte-for-byte", () => {
    const custom = [
      "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      "FREQ=WEEKLY;BYDAY=SA,SU",
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
      "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1",
      "FREQ=MONTHLY;BYMONTHDAY=-2",
      "FREQ=YEARLY",
      "FREQ=DAILY;INTERVAL=366",
      "FREQ=WEEKLY;BYDAY=2MO",
      "FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO",
    ];
    for (const rrule of custom) {
      expect(editorStateToPreset(parseRRuleStringToEditorState(rrule)), rrule).toEqual({
        preset: "custom",
      });
    }
  });

  it("reports custom when the rule has an until or count end", () => {
    expect(
      editorStateToPreset(
        parseRRuleStringToEditorState("FREQ=DAILY", { recurrenceCount: 5, recurrenceTimezone: TZ }),
      ),
    ).toEqual({ preset: "custom" });
    expect(
      editorStateToPreset(
        parseRRuleStringToEditorState("FREQ=DAILY", {
          recurrenceUntil: "2026-12-31",
          recurrenceTimezone: TZ,
        }),
      ),
    ).toEqual({ preset: "custom" });
  });

  it("a completion-anchored rule with a BY* part is custom (parse already flags it)", () => {
    expect(
      editorStateToPreset(
        parseRRuleStringToEditorState("FREQ=WEEKLY;BYDAY=MO", {
          recurrenceAnchor: "completion_date",
        }),
      ),
    ).toEqual({ preset: "custom" });
  });
});

describe("describeTaskRepeat", () => {
  const base = { recurrence_timezone: TZ, recurrence_until: null, recurrence_count: null };
  const due = (rrule: string | null) => ({
    ...base,
    rrule,
    recurrence_anchor: "due_date" as const,
  });
  const done = (rrule: string) => ({
    ...base,
    rrule,
    recurrence_anchor: "completion_date" as const,
  });

  it("describes each preset in one short line", () => {
    expect(describeTaskRepeat(due(null))).toBe("Does not repeat");
    expect(describeTaskRepeat(due("FREQ=DAILY"))).toBe("Daily");
    expect(describeTaskRepeat(due("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"))).toBe("Weekdays");
    expect(describeTaskRepeat(due("FREQ=WEEKLY;BYDAY=MO"))).toBe("Weekly on Mon");
    expect(describeTaskRepeat(due("FREQ=WEEKLY;BYDAY=SU"))).toBe("Weekly on Sun");
    expect(describeTaskRepeat(due("FREQ=MONTHLY;BYMONTHDAY=15"))).toBe("Monthly on the 15th");
    expect(describeTaskRepeat(due("FREQ=MONTHLY;BYMONTHDAY=1"))).toBe("Monthly on the 1st");
    expect(describeTaskRepeat(due("FREQ=MONTHLY;BYMONTHDAY=2"))).toBe("Monthly on the 2nd");
    expect(describeTaskRepeat(due("FREQ=MONTHLY;BYMONTHDAY=3"))).toBe("Monthly on the 3rd");
    expect(describeTaskRepeat(due("FREQ=MONTHLY;BYMONTHDAY=11"))).toBe("Monthly on the 11th");
    expect(describeTaskRepeat(due("FREQ=MONTHLY;BYMONTHDAY=22"))).toBe("Monthly on the 22nd");
    expect(describeTaskRepeat(due("FREQ=MONTHLY;BYMONTHDAY=-1"))).toBe("Monthly on the last day");
    expect(describeTaskRepeat(due("FREQ=DAILY;INTERVAL=3"))).toBe("Every 3 days");
  });

  it("warns that 29/30/31 skip shorter months", () => {
    expect(describeTaskRepeat(due("FREQ=MONTHLY;BYMONTHDAY=29"))).toBe(
      "Monthly on the 29th (skips shorter months)",
    );
    expect(describeTaskRepeat(due("FREQ=MONTHLY;BYMONTHDAY=30"))).toBe(
      "Monthly on the 30th (skips shorter months)",
    );
    expect(describeTaskRepeat(due("FREQ=MONTHLY;BYMONTHDAY=31"))).toBe(
      "Monthly on the 31st (skips shorter months)",
    );
  });

  it("appends 'after I complete it' for completion-anchored presets", () => {
    expect(describeTaskRepeat(done("FREQ=DAILY"))).toBe("Daily after I complete it");
    expect(describeTaskRepeat(done("FREQ=DAILY;INTERVAL=3"))).toBe(
      "Every 3 days after I complete it",
    );
    expect(describeTaskRepeat(done("FREQ=WEEKLY"))).toBe("Weekly after I complete it");
    expect(describeTaskRepeat(done("FREQ=MONTHLY"))).toBe("Monthly after I complete it");
  });

  it("delegates to formatRecurrenceSummary for custom rules", () => {
    expect(describeTaskRepeat(due("FREQ=WEEKLY;BYDAY=MO,WE,FR"))).toBe("Weekly on Mon, Wed, Fri");
    expect(describeTaskRepeat(due("FREQ=WEEKLY"))).toBe("Weekly");
    expect(describeTaskRepeat(due("FREQ=YEARLY"))).toBe("Yearly");
    expect(describeTaskRepeat({ ...due("FREQ=DAILY"), recurrence_count: 5 })).toBe(
      "Daily, ending after 5 occurrences",
    );
    expect(describeTaskRepeat(due("FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO"))).toBe(
      "Custom (FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO)",
    );
    expect(describeTaskRepeat(done("FREQ=WEEKLY;INTERVAL=2"))).toBe(
      "Repeats every 2 weeks after completion",
    );
  });
});
