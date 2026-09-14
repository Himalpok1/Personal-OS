// Task repeat presets (Checkpoint 9.4) -- the small, opinionated vocabulary
// the mobile "Repeat" field offers instead of the full RRULE editor: Never ·
// Daily · Weekdays · Weekly · Monthly · Every N days, optionally "after I
// complete it". Each preset maps to exactly one RRULE string and back, so the
// field can round-trip a stored task without ever clobbering a rule it does
// not understand (anything outside this vocabulary reports `custom` and the
// existing RecurrenceEditor takes over).
//
// Client-safe by construction: imports only ./editor.js and ../timezone.js,
// never the core barrel and never `rrule` (which is loaded server-side through
// `createRequire`, a Node-only mechanism). apps/mobile reaches this module
// through the `./recurrence/task-presets` deep subpath in package.json.
//
// Three semantics here were fixed by the 9.4 audit and are pinned by tests:
//
//   1. WEEKLY always writes an explicit BYDAY, so the stored rule says what
//      the owner chose rather than "whatever DTSTART's weekday is". Reading
//      the other way is looser (9.4 review): a bare `FREQ=WEEKLY` on a
//      due_date anchor IS the weekly preset, because the server re-anchors a
//      bare rule on the new DTSTART on every due-date edit anyway, so
//      `BYDAY=<due weekday>` is behaviour-identical to the bare form -- and
//      every "Weekly" task the pre-9.4 editor wrote is exactly that bare
//      form. Same for a bare `FREQ=MONTHLY` and the monthly preset.
//   2. MONTHLY on the 29th/30th/31st is NOT "every month". rrule implements
//      RFC 5545 literally: `BYMONTHDAY=31` SKIPS months without a 31st rather
//      than clamping to their last day. So a due date that IS the last day of
//      its month -- ANY month, Feb 28 in a common year included -- becomes
//      `BYMONTHDAY=-1` (last day, every month), and a 29th or 30th that is
//      not month-end keeps its literal day with the summary warning that
//      shorter months are skipped.
//   3. A completion-anchored rule may carry only FREQ and INTERVAL
//      (validateCompletionAnchoredRule; docs/ARCHITECTURE.md: "BYDAY=MO,WE,FR
//      is incoherent relative to an arbitrary completion instant"). So
//      `afterCompletion` never emits a BY* part, and Weekdays -- which IS a
//      BY* part -- refuses it outright rather than degrading to "daily".

import { toWallClockComponents, type WallClockComponents } from "../timezone.js";
import {
  formatRecurrenceSummary,
  LAST_DAY_OF_MONTH,
  parseRRuleStringToEditorState,
  type RecurrenceEditorState,
  type RecurrenceWeekday,
} from "./editor.js";

export type TaskRepeatPreset =
  "never" | "daily" | "weekdays" | "weekly" | "monthly" | "every_n_days";

export const TASK_REPEAT_PRESETS: readonly TaskRepeatPreset[] = [
  "never",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "every_n_days",
];

/** Bounds for the "Every N days" interval. Below 2 is "daily"; above a year is not a chore. */
export const EVERY_N_DAYS_MIN = 2;
export const EVERY_N_DAYS_MAX = 365;

const WEEKDAYS_MON_TO_FRI: readonly RecurrenceWeekday[] = ["MO", "TU", "WE", "TH", "FR"];

// JS `Date.getUTCDay()` order (0 = Sunday) → RFC 5545 weekday codes.
const WEEKDAY_BY_JS_DAY: readonly RecurrenceWeekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const WEEKDAY_LABEL: Record<RecurrenceWeekday, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

/** The calendar date (year/month/day) of a wall clock; time-of-day is irrelevant here. */
export type LocalDate = Pick<WallClockComponents, "year" | "month" | "day">;

/** RFC 5545 weekday code of a local calendar date. Pure calendar arithmetic, no zone. */
export function weekdayOfLocalDate(date: LocalDate): RecurrenceWeekday {
  const jsDay = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  const code = WEEKDAY_BY_JS_DAY[jsDay];
  if (code === undefined) throw new Error("weekdayOfLocalDate: unreachable weekday index");
  return code;
}

/** Number of days in the local date's month (Gregorian, leap-year aware). */
export function daysInMonth(date: LocalDate): number {
  // Day 0 of the NEXT month is the last day of this one.
  return new Date(Date.UTC(date.year, date.month, 0)).getUTCDate();
}

export function isLastDayOfMonth(date: LocalDate): boolean {
  return date.day === daysInMonth(date);
}

/**
 * The BYMONTHDAY value the monthly preset writes for a due date -- see
 * semantic 2 in the header. Exported so the summary and the field can agree
 * on when to show the "skips shorter months" caveat.
 */
export function monthlyMonthDayFor(date: LocalDate): number {
  // Month-end is checked FIRST: Feb 28 in a common year is the last day of
  // its month and means "the last day", not "the 28th" (9.4 review -- a
  // `day <= 28` short-circuit used to win here).
  if (isLastDayOfMonth(date)) return LAST_DAY_OF_MONTH;
  return date.day;
}

export interface PresetToEditorStateOptions {
  /**
   * The task's due date as wall-clock components in `timezone`
   * (`toWallClockComponents(dueAt, timezone)`), or null when the task has no
   * due date yet. Weekly and monthly derive their BY* part from it; with no
   * due date, weekly falls back to TODAY's weekday in `timezone` (the series
   * starts now, which is exactly what the API's series anchor does when
   * due_at is omitted -- see recurrence/series-anchor.ts) and monthly to
   * today's day of month.
   */
  dueLocal: LocalDate | null;
  /** Only read for `every_n_days`; must be an integer in [EVERY_N_DAYS_MIN, EVERY_N_DAYS_MAX]. */
  interval?: number;
  /** Anchor the rule on completion (`completion_date`) instead of the due date. */
  afterCompletion?: boolean;
  /** IANA zone recorded as `recurrence_timezone` and used for the "today" fallback. */
  timezone: string;
  /** Injectable clock for the no-due-date fallback; defaults to the real one. */
  now?: Date;
}

function baseState(
  timezone: string,
  anchor: "due_date" | "completion_date",
): RecurrenceEditorState {
  return {
    enabled: true,
    frequency: "DAILY",
    interval: 1,
    weekdays: [],
    monthDay: null,
    endMode: "never",
    untilDate: null,
    count: null,
    anchor,
    timezone,
    isCustom: false,
    rawRrule: null,
  };
}

/**
 * Builds the RecurrenceEditorState for a preset such that
 * `serializeEditorStateToRRule(state).rrule` is exactly:
 *
 *   daily         FREQ=DAILY
 *   weekdays      FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
 *   weekly        FREQ=WEEKLY;BYDAY=<due weekday>
 *   monthly       FREQ=MONTHLY;BYMONTHDAY=<d | -1>
 *   every_n_days  FREQ=DAILY;INTERVAL=<N>
 *   never         (enabled: false → rrule null)
 *
 * With `afterCompletion`, daily/weekly/monthly/every_n_days drop their BY*
 * part and carry `anchor: "completion_date"` (the serializer then also omits
 * until/count, which completion-anchored rules cannot have); `weekdays`
 * throws, because there is no honest FREQ+INTERVAL rendering of it.
 */
export function presetToEditorState(
  preset: TaskRepeatPreset,
  opts: PresetToEditorStateOptions,
): RecurrenceEditorState {
  const anchor = opts.afterCompletion ? "completion_date" : "due_date";
  const state = baseState(opts.timezone, anchor);

  switch (preset) {
    case "never":
      return { ...state, enabled: false, frequency: "WEEKLY", anchor: "due_date" };

    case "daily":
      return state;

    case "every_n_days": {
      const interval = opts.interval;
      if (
        interval === undefined ||
        !Number.isInteger(interval) ||
        interval < EVERY_N_DAYS_MIN ||
        interval > EVERY_N_DAYS_MAX
      ) {
        throw new Error(
          `every_n_days requires an integer interval between ${EVERY_N_DAYS_MIN} and ${EVERY_N_DAYS_MAX}`,
        );
      }
      return { ...state, interval };
    }

    case "weekdays":
      if (opts.afterCompletion) {
        // Semantic 3: BYDAY is forbidden on a completion-anchored rule and
        // "weekdays after I complete it" has no FREQ+INTERVAL meaning.
        throw new Error("weekdays cannot be anchored on completion");
      }
      return { ...state, frequency: "WEEKLY", weekdays: [...WEEKDAYS_MON_TO_FRI] };

    case "weekly": {
      if (opts.afterCompletion) return { ...state, frequency: "WEEKLY" };
      const date = opts.dueLocal ?? toWallClockComponents(opts.now ?? new Date(), opts.timezone);
      // Semantic 1: always explicit, never "whatever DTSTART happens to be".
      return { ...state, frequency: "WEEKLY", weekdays: [weekdayOfLocalDate(date)] };
    }

    case "monthly": {
      if (opts.afterCompletion) return { ...state, frequency: "MONTHLY" };
      const date = opts.dueLocal ?? toWallClockComponents(opts.now ?? new Date(), opts.timezone);
      return { ...state, frequency: "MONTHLY", monthDay: monthlyMonthDayFor(date) };
    }
  }
}

export type TaskRepeatSelection =
  | { preset: "never"; afterCompletion: false }
  | { preset: "daily" | "weekdays" | "weekly" | "monthly"; afterCompletion: boolean }
  | { preset: "every_n_days"; interval: number; afterCompletion: boolean }
  | { preset: "custom" };

function sameWeekdaySet(a: readonly RecurrenceWeekday[], b: readonly RecurrenceWeekday[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((d) => set.has(d));
}

/**
 * The inverse of presetToEditorState: which preset (if any) an editor state
 * expresses. Anything the presets cannot reproduce byte-for-byte -- a custom
 * rule, an until/count end, an interval on weekly/monthly, a weekday set
 * other than one day or Mon–Fri -- is `custom`, so the field never rewrites
 * a rule it did not author.
 */
export function editorStateToPreset(state: RecurrenceEditorState): TaskRepeatSelection {
  if (state.enabled === false) return { preset: "never", afterCompletion: false };
  if (state.isCustom || state.rawRrule) return { preset: "custom" };
  if (state.endMode !== "never") return { preset: "custom" };

  const afterCompletion = state.anchor === "completion_date";

  switch (state.frequency) {
    case "DAILY":
      if (state.weekdays.length > 0 || state.monthDay != null) return { preset: "custom" };
      if (state.interval === 1) return { preset: "daily", afterCompletion };
      if (state.interval >= EVERY_N_DAYS_MIN && state.interval <= EVERY_N_DAYS_MAX) {
        return { preset: "every_n_days", interval: state.interval, afterCompletion };
      }
      return { preset: "custom" };

    case "WEEKLY":
      if (state.interval !== 1 || state.monthDay != null) return { preset: "custom" };
      if (afterCompletion) {
        return state.weekdays.length === 0
          ? { preset: "weekly", afterCompletion }
          : { preset: "custom" };
      }
      if (sameWeekdaySet(state.weekdays, WEEKDAYS_MON_TO_FRI)) {
        return { preset: "weekdays", afterCompletion: false };
      }
      // Exactly one explicit weekday is the preset's own output; a bare
      // FREQ=WEEKLY (no BYDAY) is the pre-9.4 editor's output for the same
      // choice and is behaviour-identical on a due_date anchor (semantic 1).
      if (state.weekdays.length <= 1) return { preset: "weekly", afterCompletion: false };
      return { preset: "custom" };

    case "MONTHLY":
      if (state.interval !== 1 || state.weekdays.length > 0) return { preset: "custom" };
      if (afterCompletion) {
        return state.monthDay == null
          ? { preset: "monthly", afterCompletion }
          : { preset: "custom" };
      }
      // A bare FREQ=MONTHLY follows DTSTART's day-of-month, which is what an
      // explicit BYMONTHDAY=<due day> says too (semantic 1).
      return { preset: "monthly", afterCompletion: false };

    case "YEARLY":
      return { preset: "custom" };
  }
}

export interface TaskRepeatFields {
  rrule: string | null;
  recurrence_anchor: "due_date" | "completion_date" | null;
  recurrence_timezone: string | null;
  recurrence_until?: Date | string | null;
  recurrence_count?: number | null;
}

function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/**
 * One short line describing how a task repeats, in the preset vocabulary
 * where the rule is one of the presets and formatRecurrenceSummary's wording
 * otherwise:
 *
 *   "Daily" · "Weekdays" · "Weekly on Mon" · "Monthly on the 15th" ·
 *   "Monthly on the 30th (skips shorter months)" · "Monthly on the last day" ·
 *   "Every 3 days" · "Every 3 days after I complete it" · "Does not repeat"
 *
 * Never echoes task text; the only inputs are the recurrence columns.
 */
export function describeTaskRepeat(task: TaskRepeatFields): string {
  if (!task.rrule) return "Does not repeat";
  const state = parseRRuleStringToEditorState(task.rrule, {
    recurrenceTimezone: task.recurrence_timezone,
    recurrenceUntil: task.recurrence_until,
    recurrenceCount: task.recurrence_count,
    recurrenceAnchor: task.recurrence_anchor,
  });
  const selection = editorStateToPreset(state);
  const suffix =
    "afterCompletion" in selection && selection.afterCompletion ? " after I complete it" : "";

  switch (selection.preset) {
    case "never":
      return "Does not repeat";
    case "daily":
      return `Daily${suffix}`;
    case "every_n_days":
      return `Every ${selection.interval} days${suffix}`;
    case "weekdays":
      return "Weekdays";
    case "weekly": {
      const day = state.weekdays[0];
      return day === undefined ? `Weekly${suffix}` : `Weekly on ${WEEKDAY_LABEL[day]}`;
    }
    case "monthly": {
      const monthDay = state.monthDay;
      if (monthDay == null) return `Monthly${suffix}`;
      if (monthDay === LAST_DAY_OF_MONTH) return "Monthly on the last day";
      // Semantic 2: 29/30/31 is honest about what rrule will do.
      return monthDay >= 29
        ? `Monthly on the ${ordinal(monthDay)} (skips shorter months)`
        : `Monthly on the ${ordinal(monthDay)}`;
    }
    case "custom":
      return formatRecurrenceSummary(state);
  }
}
