import {
  resolveWallClockToInstant,
  toWallClockComponents,
  type WallClockComponents,
} from "../timezone.js";

const ALLOWED_COMPLETION_ANCHORED_PARTS = new Set(["FREQ", "INTERVAL", "WKST"]);

export function validateCompletionAnchoredRule(rrule: string): void {
  const parts = rrule.replace(/^RRULE:/i, "").split(";");
  for (const part of parts) {
    const key = part.split("=")[0]?.trim().toUpperCase();
    if (!key) continue;
    if (!ALLOWED_COMPLETION_ANCHORED_PARTS.has(key)) {
      throw new Error(
        `completion-anchored recurrence rules may only use FREQ/INTERVAL, got "${key}" in "${rrule}"`,
      );
    }
  }
}

export const SUPPORTED_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type RecurrenceFrequency = (typeof SUPPORTED_FREQUENCIES)[number];

export const SUPPORTED_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type RecurrenceWeekday = (typeof SUPPORTED_WEEKDAYS)[number];

export type RecurrenceEndMode = "never" | "until" | "count";

export interface RecurrenceEditorState {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: RecurrenceWeekday[];
  monthDay: number | null;
  endMode: RecurrenceEndMode;
  untilDate: string | null; // Inclusive local calendar date YYYY-MM-DD
  count: number | null;
  anchor: "due_date" | "completion_date";
  timezone: string | null;
  isCustom: boolean;
  rawRrule: string | null;
  enabled?: boolean;
}

export interface SerializedRecurrenceRule {
  rrule: string | null;
  recurrence_timezone: string | null;
  recurrence_until: Date | null;
  recurrence_count: number | null;
  recurrence_anchor: "due_date" | "completion_date" | null;
}

export interface ParseRRuleExtras {
  recurrenceTimezone?: string | null;
  recurrenceUntil?: Date | string | null;
  recurrenceCount?: number | null;
  recurrenceAnchor?: "due_date" | "completion_date" | null;
  defaultTimezone?: string;
}

const WEEKDAY_NAMES: Record<RecurrenceWeekday, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

/**
 * Resolves an inclusive local calendar date (YYYY-MM-DD) in `timezone` at
 * 23:59:59.999 into a real UTC instant. Uses resolveWallClockToInstant for
 * DST-safety.
 */
export function resolveLocalUntilToInstant(dateStr: string, timezone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    throw new Error(`invalid date string "${dateStr}", expected YYYY-MM-DD`);
  }
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`invalid calendar date "${dateStr}"`);
  }

  const wallClock: WallClockComponents = {
    year,
    month,
    day,
    hour: 23,
    minute: 59,
    second: 59,
  };
  const instantAt59 = resolveWallClockToInstant(wallClock, timezone);
  return new Date(instantAt59.getTime() + 999);
}

/**
 * Resolves a real UTC instant to the local calendar date (YYYY-MM-DD) in
 * `timezone`.
 */
export function resolveInstantToLocalUntil(instant: Date, timezone: string): string {
  const { year, month, day } = toWallClockComponents(instant, timezone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parses an RFC 5545 RRULE string into client-safe RecurrenceEditorState.
 * If the rule contains unsupported constructs (e.g. BYSETPOS, BYMONTH,
 * ordinal BYDAY like 2MO, or embedded UNTIL/COUNT), sets `isCustom: true` and
 * preserves `rawRrule` without mutating.
 */
export function parseRRuleStringToEditorState(
  rrule: string | null | undefined,
  extras?: ParseRRuleExtras,
): RecurrenceEditorState {
  const timezone = extras?.recurrenceTimezone ?? extras?.defaultTimezone ?? null;
  const anchor = extras?.recurrenceAnchor ?? "due_date";

  let endMode: RecurrenceEndMode = "never";
  let untilDate: string | null = null;
  let count: number | null = null;

  if (extras?.recurrenceUntil != null) {
    endMode = "until";
    if (typeof extras.recurrenceUntil === "string") {
      untilDate = extras.recurrenceUntil.includes("T")
        ? resolveInstantToLocalUntil(new Date(extras.recurrenceUntil), timezone ?? "UTC")
        : extras.recurrenceUntil.slice(0, 10);
    } else if (extras.recurrenceUntil instanceof Date) {
      untilDate = resolveInstantToLocalUntil(extras.recurrenceUntil, timezone ?? "UTC");
    }
  } else if (extras?.recurrenceCount != null) {
    endMode = "count";
    count = extras.recurrenceCount;
  }

  if (!rrule || rrule.trim() === "") {
    return {
      enabled: false,
      frequency: "WEEKLY",
      interval: 1,
      weekdays: [],
      monthDay: null,
      endMode,
      untilDate,
      count,
      anchor,
      timezone,
      isCustom: false,
      rawRrule: null,
    };
  }

  const clean = rrule.trim().replace(/^RRULE:/i, "");
  const tokens = clean.split(";").filter((t) => t.trim().length > 0);
  const map = new Map<string, string>();
  let isCustom = false;

  for (const token of tokens) {
    const eqIdx = token.indexOf("=");
    if (eqIdx === -1) {
      isCustom = true;
      continue;
    }
    const key = token.slice(0, eqIdx).trim().toUpperCase();
    const val = token.slice(eqIdx + 1).trim();
    map.set(key, val);
  }

  const recognizedKeys = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "WKST"]);
  for (const key of map.keys()) {
    if (!recognizedKeys.has(key)) {
      isCustom = true;
    }
  }

  const rawFreq = map.get("FREQ")?.toUpperCase();
  const isSupportedFreq = (f: string | undefined): f is RecurrenceFrequency =>
    f !== undefined && (SUPPORTED_FREQUENCIES as readonly string[]).includes(f);
  if (!isSupportedFreq(rawFreq)) {
    isCustom = true;
  }
  const freq: RecurrenceFrequency = isSupportedFreq(rawFreq) ? rawFreq : "WEEKLY";

  let interval = 1;
  if (map.has("INTERVAL")) {
    const parsedInt = Number(map.get("INTERVAL"));
    if (!Number.isInteger(parsedInt) || parsedInt < 1) {
      isCustom = true;
    } else {
      interval = parsedInt;
    }
  }

  const isSupportedWeekday = (w: string): w is RecurrenceWeekday =>
    (SUPPORTED_WEEKDAYS as readonly string[]).includes(w);

  const weekdays: RecurrenceWeekday[] = [];
  if (map.has("BYDAY")) {
    if (freq !== "WEEKLY") {
      isCustom = true;
    } else {
      const rawDays = (map.get("BYDAY") ?? "").split(",").map((d) => d.trim().toUpperCase());
      for (const d of rawDays) {
        if (isSupportedWeekday(d)) {
          weekdays.push(d);
        } else {
          isCustom = true;
        }
      }
    }
  }

  let monthDay: number | null = null;
  if (map.has("BYMONTHDAY")) {
    if (freq !== "MONTHLY") {
      isCustom = true;
    } else {
      const num = Number(map.get("BYMONTHDAY"));
      if (Number.isInteger(num) && num >= 1 && num <= 31) {
        monthDay = num;
      } else {
        isCustom = true;
      }
    }
  }

  if (anchor === "completion_date") {
    for (const key of map.keys()) {
      if (key !== "FREQ" && key !== "INTERVAL" && key !== "WKST") {
        isCustom = true;
      }
    }
  }

  return {
    enabled: true,
    frequency: freq,
    interval,
    weekdays,
    monthDay,
    endMode,
    untilDate,
    count,
    anchor,
    timezone,
    isCustom,
    rawRrule: isCustom ? rrule : null,
  };
}

/**
 * Serializes RecurrenceEditorState back to RRULE and separate database columns.
 */
export function serializeEditorStateToRRule(
  state: RecurrenceEditorState,
): SerializedRecurrenceRule {
  if (state.enabled === false || (!state.frequency && !state.rawRrule && !state.isCustom)) {
    return {
      rrule: null,
      recurrence_timezone: null,
      recurrence_until: null,
      recurrence_count: null,
      recurrence_anchor: null,
    };
  }

  let rruleStr: string | null = null;

  if (state.isCustom) {
    rruleStr = state.rawRrule ?? null;
  } else if (state.frequency) {
    const parts: string[] = [`FREQ=${state.frequency}`];
    if (state.interval > 1) {
      parts.push(`INTERVAL=${state.interval}`);
    }
    if (state.anchor !== "completion_date") {
      if (state.frequency === "WEEKLY" && state.weekdays.length > 0) {
        parts.push(`BYDAY=${state.weekdays.join(",")}`);
      } else if (state.frequency === "MONTHLY" && state.monthDay != null) {
        parts.push(`BYMONTHDAY=${state.monthDay}`);
      }
    }
    rruleStr = parts.join(";");
  }

  let recurrenceUntil: Date | null = null;
  let recurrenceCount: number | null = null;

  if (rruleStr && state.anchor !== "completion_date") {
    if (state.endMode === "until" && state.untilDate) {
      recurrenceUntil = resolveLocalUntilToInstant(state.untilDate, state.timezone ?? "UTC");
    } else if (state.endMode === "count" && state.count != null && state.count >= 1) {
      recurrenceCount = state.count;
    }
  }

  return {
    rrule: rruleStr,
    recurrence_timezone: rruleStr ? (state.timezone ?? null) : null,
    recurrence_until: recurrenceUntil,
    recurrence_count: recurrenceCount,
    recurrence_anchor: rruleStr ? (state.anchor ?? "due_date") : null,
  };
}

export type RecurrenceSummaryInput =
  | RecurrenceEditorState
  | {
      rrule?: string | null;
      recurrence_timezone?: string | null;
      recurrence_until?: Date | string | null;
      recurrence_count?: number | null;
      recurrence_anchor?: "due_date" | "completion_date" | null;
    };

/**
 * Formats a clean, human-readable recurrence summary string.
 */
export function formatRecurrenceSummary(stateOrFields: RecurrenceSummaryInput): string {
  let state: RecurrenceEditorState;

  if (
    typeof stateOrFields === "object" &&
    stateOrFields !== null &&
    "frequency" in stateOrFields &&
    "isCustom" in stateOrFields
  ) {
    state = stateOrFields;
  } else {
    const fields = stateOrFields ?? {};
    if (!fields.rrule) {
      return "Does not repeat";
    }
    state = parseRRuleStringToEditorState(fields.rrule, {
      recurrenceTimezone: fields.recurrence_timezone,
      recurrenceUntil: fields.recurrence_until,
      recurrenceCount: fields.recurrence_count,
      recurrenceAnchor: fields.recurrence_anchor,
    });
  }

  if (state.enabled === false || (!state.isCustom && !state.rawRrule && !state.frequency)) {
    return "Does not repeat";
  }

  if (state.isCustom) {
    const base = state.rawRrule ? `Custom (${state.rawRrule})` : "Custom recurrence";
    if (state.endMode === "count" && state.count != null) {
      return `${base}, ending after ${state.count} occurrence${state.count === 1 ? "" : "s"}`;
    }
    if (state.endMode === "until" && state.untilDate) {
      return `${base}, until ${state.untilDate}`;
    }
    return base;
  }

  let summary = "";

  if (state.anchor === "completion_date") {
    if (state.interval === 1) {
      switch (state.frequency) {
        case "DAILY":
          summary = "Repeats daily after completion";
          break;
        case "WEEKLY":
          summary = "Repeats weekly after completion";
          break;
        case "MONTHLY":
          summary = "Repeats monthly after completion";
          break;
        case "YEARLY":
          summary = "Repeats yearly after completion";
          break;
      }
    } else {
      switch (state.frequency) {
        case "DAILY":
          summary = `Repeats every ${state.interval} days after completion`;
          break;
        case "WEEKLY":
          summary = `Repeats every ${state.interval} weeks after completion`;
          break;
        case "MONTHLY":
          summary = `Repeats every ${state.interval} months after completion`;
          break;
        case "YEARLY":
          summary = `Repeats every ${state.interval} years after completion`;
          break;
      }
    }
    return summary;
  }

  // Due date anchored
  switch (state.frequency) {
    case "DAILY":
      summary = state.interval === 1 ? "Daily" : `Every ${state.interval} days`;
      break;

    case "WEEKLY": {
      if (state.weekdays.length === 0) {
        summary = state.interval === 1 ? "Weekly" : `Every ${state.interval} weeks`;
      } else if (state.weekdays.length === 7) {
        summary = state.interval === 1 ? "Daily" : `Every ${state.interval} weeks on all days`;
      } else if (
        state.weekdays.length === 5 &&
        ["MO", "TU", "WE", "TH", "FR"].every((d) => state.weekdays.includes(d as RecurrenceWeekday))
      ) {
        summary =
          state.interval === 1 ? "Every weekday" : `Every ${state.interval} weeks on weekdays`;
      } else if (
        state.weekdays.length === 2 &&
        ["SA", "SU"].every((d) => state.weekdays.includes(d as RecurrenceWeekday))
      ) {
        summary =
          state.interval === 1 ? "Every weekend" : `Every ${state.interval} weeks on weekends`;
      } else {
        const days = state.weekdays.map((d) => WEEKDAY_NAMES[d] || d).join(", ");
        summary =
          state.interval === 1 ? `Weekly on ${days}` : `Every ${state.interval} weeks on ${days}`;
      }
      break;
    }

    case "MONTHLY":
      if (state.monthDay != null) {
        summary =
          state.interval === 1
            ? `Monthly on day ${state.monthDay}`
            : `Every ${state.interval} months on day ${state.monthDay}`;
      } else {
        summary = state.interval === 1 ? "Monthly" : `Every ${state.interval} months`;
      }
      break;

    case "YEARLY":
      summary = state.interval === 1 ? "Yearly" : `Every ${state.interval} years`;
      break;
  }

  if (state.endMode === "count" && state.count != null) {
    summary += `, ending after ${state.count} occurrence${state.count === 1 ? "" : "s"}`;
  } else if (state.endMode === "until" && state.untilDate) {
    summary += `, until ${state.untilDate}`;
  }

  return summary;
}
