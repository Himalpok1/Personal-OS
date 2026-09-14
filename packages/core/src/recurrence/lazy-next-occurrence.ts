import { createRequire } from "node:module";
import type * as RRuleModule from "rrule";
import {
  resolveWallClockToInstant,
  toWallClockComponents,
  wallClockToNaiveDate,
  type WallClockComponents,
} from "../timezone.js";

// See due-date-window.ts for why this isn't a plain named import.
const require = createRequire(import.meta.url);
const rrulePkg = require("rrule") as typeof RRuleModule;
const { RRule, RRuleSet, rrulestr } = rrulePkg;

import { validateCompletionAnchoredRule } from "./editor.js";
export { validateCompletionAnchoredRule };

export interface CompletionAnchoredRule {
  rrule: string;
  recurrenceTimezone: string;
}

export interface NextLazyOccurrenceResult {
  occursAt: Date;
  occursLocal: WallClockComponents;
}

function fromFloatingDate(date: Date): WallClockComponents {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

/** Local time-of-day the successor should keep; see computeNextLazyOccurrence. */
export interface LazyWallTime {
  hour: number;
  minute: number;
  second: number;
}

/**
 * The wall-clock time-of-day stored in a `timestamp` WITHOUT time zone
 * column (`occurrences.occurs_local`, `tasks.due_local`) as drizzle hands it
 * back. pg-core decodes a naive timestamp by appending "+0000" before
 * `new Date(...)`, so the wall-clock fields the recurrence engine wrote
 * through wallClockToNaiveDate come back on the Date's *UTC* getters -- the
 * same "floating" convention wallClockToNaiveDate documents on the way in.
 * Reading the local getters instead would apply the SERVER's zone and shift
 * the time-of-day on every host that is not UTC.
 *
 * One implementation, shared by the API's in-transaction successor insert
 * and the worker's belt-and-braces job (Checkpoint 9.4): both must hand
 * computeNextLazyOccurrence the identical wallTime or they compute two
 * different instants for one successor.
 */
export function wallTimeOfNaiveTimestamp(naive: Date): LazyWallTime {
  return {
    hour: naive.getUTCHours(),
    minute: naive.getUTCMinutes(),
    second: naive.getUTCSeconds(),
  };
}

export interface ComputeNextLazyOccurrenceOptions {
  /**
   * When set, the successor lands on `fromInstant`'s local DATE plus the
   * rule's interval, at THIS wall-clock time rather than at the completion
   * instant's own time-of-day. Callers pass the completed occurrence's
   * `occurs_local` time (Checkpoint 9.4) -- read it through
   * wallTimeOfNaiveTimestamp.
   */
  wallTime?: LazyWallTime;
  /**
   * EXCLUSIVE lower bound on the result: the successor is the first instance
   * of the series strictly after this instant. Callers pass the completed
   * occurrence's own `occurs_at`. Without it, completing a row INTERVAL days
   * (or more) early puts the successor at or before the completed row's own
   * instant, which collides on `occurrences_parent_occurs_at_key` and
   * silently ends the series (Checkpoint 9.4 review).
   */
  after?: Date;
}

// How many interval steps the `after` loop may take before giving up. A
// completion can only be finitely early, and one step already clears the
// completed row's instant in every realistic case; the bound exists so a
// pathological input (an `after` centuries ahead) throws instead of spinning.
const MAX_AFTER_STEPS = 1000;

function validateWallTime(wallTime: LazyWallTime): void {
  const ok =
    Number.isInteger(wallTime.hour) &&
    wallTime.hour >= 0 &&
    wallTime.hour <= 23 &&
    Number.isInteger(wallTime.minute) &&
    wallTime.minute >= 0 &&
    wallTime.minute <= 59 &&
    Number.isInteger(wallTime.second) &&
    wallTime.second >= 0 &&
    wallTime.second <= 59;
  if (!ok) throw new Error("computeNextLazyOccurrence: wallTime is not a valid time of day");
}

function validateAfter(after: Date): void {
  if (Number.isNaN(after.getTime())) {
    throw new Error("computeNextLazyOccurrence: after is not a valid instant");
  }
}

type CalendarFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

interface FreqInterval {
  freq: string;
  interval: number;
}

// Only ever called AFTER validateCompletionAnchoredRule, which guarantees
// `KEY=VALUE` parts, a known FREQ, a positive-integer INTERVAL and nothing
// else but WKST -- so this is a lookup, not a parser.
function readFreqInterval(rrule: string): FreqInterval {
  const parts = new Map<string, string>();
  for (const part of rrule
    .trim()
    .replace(/^RRULE:/i, "")
    .split(";")) {
    const eqIdx = part.indexOf("=");
    parts.set(part.slice(0, eqIdx).trim().toUpperCase(), part.slice(eqIdx + 1).trim());
  }
  const freq = parts.get("FREQ");
  if (freq === undefined) throw new Error("computeNextLazyOccurrence: rule has no FREQ");
  const interval = parts.get("INTERVAL");
  return { freq: freq.toUpperCase(), interval: interval === undefined ? 1 : Number(interval) };
}

function isCalendarFrequency(freq: string): freq is CalendarFrequency {
  return freq === "DAILY" || freq === "WEEKLY" || freq === "MONTHLY" || freq === "YEARLY";
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the NEXT month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

type LocalDate = Pick<WallClockComponents, "year" | "month" | "day">;

// `steps` interval-steps from `anchor`, as a local calendar date. Every
// candidate is computed from the ANCHOR, never from the previous candidate,
// so the month-end clamp below cannot compound inside one call (anchor + 2
// months is anchor's day-of-month clamped to THAT month, not the already-
// clamped day carried forward).
function stepLocalDate(
  anchor: LocalDate,
  freq: CalendarFrequency,
  interval: number,
  steps: number,
): LocalDate {
  switch (freq) {
    case "DAILY":
    case "WEEKLY": {
      const days = (freq === "DAILY" ? 1 : 7) * interval * steps;
      // Date.UTC normalises an out-of-range day, and never applies DST.
      const shifted = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + days));
      return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
      };
    }
    case "MONTHLY":
    case "YEARLY": {
      const months = (freq === "MONTHLY" ? 1 : 12) * interval * steps;
      const zeroBased = anchor.month - 1 + months;
      const year = anchor.year + Math.floor(zeroBased / 12);
      const month = (zeroBased % 12) + 1;
      return { year, month, day: Math.min(anchor.day, daysInMonth(year, month)) };
    }
  }
}

// Anchored strictly from fromInstant -- a task completed three weeks late
// still generates its next occurrence three days (say) after the actual
// completion, never from the original due date it missed. fromStatus is
// accepted (rather than folded away) because "completed" vs "skipped" is
// meaningful to callers/audit logs even though the date math is identical
// either way -- both anchor from the same instant per ARCHITECTURE.md.
//
// `opts.wallTime` (Checkpoint 9.4): the DATE still anchors from the
// completion -- "every 3 days" completed on the 7th means the 10th -- but the
// TIME of day is the previous occurrence's, not the instant the owner happened
// to tap Done. Without it, a 9am chore completed at 21:47 became a 21:47
// chore forever after, and its derived reminder (occurrence-reminder.ts)
// drifted with it. Both writers of the successor -- the API's in-transaction
// insert and the worker's belt-and-braces job -- must pass the SAME wallTime
// (the completed row's occurs_local time), or they compute two different
// instants for one successor and the second insert is not a no-op.
//
// With wallTime the step is PURE CALENDAR ARITHMETIC in recurrenceTimezone,
// not an rrule iteration: validateCompletionAnchoredRule guarantees the rule
// is FREQ+INTERVAL only, so DAILY is +INTERVAL days, WEEKLY +7·INTERVAL days,
// MONTHLY +INTERVAL months and YEARLY +INTERVAL years, with the day-of-month
// CLAMPED to the target month's length. That clamp is a product decision,
// pinned by tests, and it differs from what rrule does with the same rule:
// rrule gives a MONTHLY rule anchored on the 31st an implicit BYMONTHDAY=31
// and SKIPS every month without a 31st, so "every month after I complete it"
// completed on Jan 31 would jump to Mar 31. A chore completed on the 31st
// means "next month", so here Jan 31 → Feb 28 (29 in a leap year), and
// Feb 29 → Feb 28 the year after. The clamp is taken from the COMPLETION
// date's day-of-month on every call -- done Jan 31 → Feb 28; done Feb 28 →
// Mar 28 -- so a series completed on the last day of the month drifts to the
// 28th over time. That drift is accepted as the simplest honest rule: the
// anchor is always the instant the owner actually acted, never a remembered
// day-of-month, exactly as it is for every other frequency. The only
// alternative -- carrying "I meant month-end" as state -- is what the
// due_date anchor with BYMONTHDAY=-1 is for. A sub-daily FREQ (SECONDLY,
// MINUTELY, HOURLY) has no calendar step to take with a fixed time-of-day
// and keeps the pre-9.4 rrule iteration from the substituted wall time.
//
// `opts.after` (Checkpoint 9.4 review): the +INTERVAL candidate is computed
// from the completion, so completing a row INTERVAL days or more EARLY
// yields a successor at or before the completed row's own occurs_at, which
// the unique key `(parent_type, parent_id, occurs_at)` rejects -- and the
// insert is `onConflictDoNothing`, so the series simply ended with nobody
// told. Callers pass the completed row's occurs_at; the successor is then
// the first instance strictly after it, stepping by whole intervals from the
// completion so the cadence is preserved. The same bound applies on the
// legacy rrule path. Without `opts` the behaviour is byte-identical to
// before 9.4.
export function computeNextLazyOccurrence(
  rule: CompletionAnchoredRule,
  fromInstant: Date,
  fromStatus: "completed" | "skipped",
  opts?: ComputeNextLazyOccurrenceOptions,
): NextLazyOccurrenceResult {
  if (fromStatus !== "completed" && fromStatus !== "skipped") {
    throw new Error(`invalid fromStatus "${String(fromStatus)}"`);
  }
  validateCompletionAnchoredRule(rule.rrule);
  const after = opts?.after;
  if (after !== undefined) validateAfter(after);

  const fromLocalRaw = toWallClockComponents(fromInstant, rule.recurrenceTimezone);
  let fromLocal = fromLocalRaw;
  if (opts?.wallTime !== undefined) {
    validateWallTime(opts.wallTime);
    const { freq, interval } = readFreqInterval(rule.rrule);
    if (isCalendarFrequency(freq)) {
      return stepCalendar(
        rule.recurrenceTimezone,
        fromLocalRaw,
        opts.wallTime,
        freq,
        interval,
        after,
      );
    }
    // Sub-daily FREQ: substituting the time-of-day BEFORE the rule runs keeps
    // everything in floating wall-clock space, so the interval is applied to
    // a local wall clock and the result is resolved to an instant exactly
    // once, per occurrence, through recurrenceTimezone.
    fromLocal = { ...fromLocalRaw, ...opts.wallTime };
  }
  return stepRRule(rule, fromLocal, after);
}

function stepCalendar(
  timezone: string,
  fromLocal: WallClockComponents,
  wallTime: LazyWallTime,
  freq: CalendarFrequency,
  interval: number,
  after: Date | undefined,
): NextLazyOccurrenceResult {
  for (let steps = 1; steps <= MAX_AFTER_STEPS; steps += 1) {
    const occursLocal: WallClockComponents = {
      ...stepLocalDate(fromLocal, freq, interval, steps),
      ...wallTime,
    };
    const occursAt = resolveWallClockToInstant(occursLocal, timezone);
    if (after === undefined || occursAt.getTime() > after.getTime()) {
      return { occursAt, occursLocal };
    }
  }
  throw new Error(
    `computeNextLazyOccurrence: no occurrence after the bound within ${MAX_AFTER_STEPS} steps`,
  );
}

function stepRRule(
  rule: CompletionAnchoredRule,
  fromLocal: WallClockComponents,
  after: Date | undefined,
): NextLazyOccurrenceResult {
  const dtstart = wallClockToNaiveDate(fromLocal);
  const parsed = rrulestr(rule.rrule, { dtstart, forceset: false });
  if (parsed instanceof RRuleSet) {
    throw new Error("computeNextLazyOccurrence expects a single RRULE, not a compound rule set");
  }

  const rr = new RRule({ ...parsed.origOptions, dtstart, until: null, count: 2 });
  const [, next] = rr.all();
  if (!next) {
    throw new Error(`could not compute next occurrence for rule "${rule.rrule}"`);
  }

  let candidate = next;
  let occursLocal = fromFloatingDate(candidate);
  let occursAt = resolveWallClockToInstant(occursLocal, rule.recurrenceTimezone);
  if (after !== undefined) {
    // Unbounded iterator for the bound loop; the count:2 rule above stays
    // exactly what it was so the no-`after` result is unchanged.
    const iter = new RRule({ ...parsed.origOptions, dtstart, until: null, count: null });
    let steps = 1;
    while (occursAt.getTime() <= after.getTime()) {
      if (steps >= MAX_AFTER_STEPS) {
        throw new Error(
          `computeNextLazyOccurrence: no occurrence after the bound within ${MAX_AFTER_STEPS} steps`,
        );
      }
      const following = iter.after(candidate, false);
      if (!following) {
        throw new Error(`could not compute next occurrence for rule "${rule.rrule}"`);
      }
      candidate = following;
      occursLocal = fromFloatingDate(candidate);
      occursAt = resolveWallClockToInstant(occursLocal, rule.recurrenceTimezone);
      steps += 1;
    }
  }
  return { occursAt, occursLocal };
}
