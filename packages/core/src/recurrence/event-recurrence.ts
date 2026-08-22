import { addCalendarDays, formatLocalDate } from "../actionability.js";
import { toWallClockComponents, type WallClockComponents } from "../timezone.js";
import type { DueDateRecurrenceRule } from "./due-date-window.js";

// Canonical, shared event-recurrence-rule builder. Four call sites (the
// events.range route, the Today collector, the daily/weekly review
// collectors, and the agenda read model) each independently need to turn a
// stored events row into a DueDateRecurrenceRule for expandRecurrenceInRange
// -- this is the one place that translation lives, so timed and all-day
// recurrence semantics can never drift apart across those call sites.
export interface EventRecurrenceInput {
  rrule: string | null;
  recurrenceTimezone: string | null;
  allDay: boolean;
  startsAt: Date | null;
  startDate: string | null; // "YYYY-MM-DD"
  recurrenceUntil?: Date | null;
  recurrenceCount?: number | null;
  recurrenceExdates?: string[] | null;
}

function parseLocalDate(localDate: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) throw new Error(`invalid local date "${localDate}", expected YYYY-MM-DD`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function buildEventRecurrenceRule(
  input: EventRecurrenceInput,
): DueDateRecurrenceRule | null {
  if (!input.rrule || !input.recurrenceTimezone) return null;

  let dtstart: WallClockComponents;
  if (input.allDay) {
    if (!input.startDate) return null;
    const { year, month, day } = parseLocalDate(input.startDate);
    // Noon anchor keeps every generated all-day instance safely away from
    // any DST transition boundary -- see DueDateRecurrenceRule.dtstart's
    // own doc comment in ./due-date-window.ts.
    dtstart = { year, month, day, hour: 12, minute: 0, second: 0 };
  } else {
    if (!input.startsAt) return null;
    dtstart = toWallClockComponents(input.startsAt, input.recurrenceTimezone);
  }

  return {
    rrule: input.rrule,
    recurrenceTimezone: input.recurrenceTimezone,
    dtstart,
    recurrenceUntil: input.recurrenceUntil ?? undefined,
    recurrenceCount: input.recurrenceCount ?? undefined,
    recurrenceExdates: input.recurrenceExdates ?? undefined,
  };
}

// Derives the start/end calendar dates for one generated all-day instance,
// preserving the parent series' original day-span (e.g. a 3-day all-day
// event stays 3 days on every recurrence) rather than collapsing every
// instance to a single day.
export function allDayInstanceDates(
  occursLocal: WallClockComponents,
  parentStartDate: string,
  parentEndDate: string | null,
): { startDate: string; endDate: string } {
  let dayOffset = 0;
  if (parentEndDate !== null) {
    const start = parseLocalDate(parentStartDate);
    const end = parseLocalDate(parentEndDate);
    const startMs = Date.UTC(start.year, start.month - 1, start.day, 12);
    const endMs = Date.UTC(end.year, end.month - 1, end.day, 12);
    // Clamped: an inverted span (end before start) is rejected upstream by
    // EventCreateSchema and the detach handler, but this shared helper must
    // defend itself rather than trust every future caller -- a negative
    // offset would emit endDate < startDate and silently drop instances
    // from the date-overlap filter. Mirrors the Math.max(0, ...) already
    // used by mobile's computeOccurrenceTiming.
    dayOffset = Math.max(0, Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)));
  }

  const startDate = formatLocalDate(occursLocal);
  const endDate = addCalendarDays(startDate, dayOffset);
  return { startDate, endDate };
}
