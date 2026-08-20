// Pure, zero React Native import on purpose -- same pattern as
// notifications/reconcile.ts and notifications/reminder-eligibility.ts (see
// their header comments): this repo's mobile vitest config only transforms
// `src/**/*.test.ts`, not `.tsx`, so the actual day/time-slot placement math
// for the week view lives here as plain data-in/data-out functions and gets
// real automated coverage, while week-grid.tsx (the RN component) stays a
// thin renderer over this module's output with no logic of its own worth
// testing separately.
//
// Timezone note: unlike EventSchema, EventRangeItemSchema (see
// packages/schema/src/events.ts) carries no per-event `timezone` field --
// starts_at/ends_at/occurs_at/occurs_ends_at are plain UTC-offset ISO
// instants. This module renders them in the *device's* local wall-clock
// time via Date's local getHours()/getMinutes(), exactly like any calendar
// app displays instants relative to the clock it's running on. That makes
// this module's output dependent on the process's local timezone the same
// way the real app is -- tests fix `process.env.TZ` to make that
// deterministic across machines (see week-grid-layout.test.ts).
import { addDays, isSameDay, startOfDay, startOfWeek } from "date-fns";
import type { EventRangeItem } from "@personal-os/schema";

export const DAYS_PER_WEEK = 7;
export const MINUTES_PER_DAY = 24 * 60;

// Sunday-start week, matching date-fns's own default (weekStartsOn: 0) and
// the common US convention -- no requirement in the checkpoint brief said
// otherwise, so this is the documented default rather than a silent
// assumption. `anyDateInWeek` may be any date/time within the week to
// display; the returned days are each normalized to local midnight.
export function getWeekDays(anyDateInWeek: Date): Date[] {
  const start = startOfWeek(anyDateInWeek);
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) => addDays(start, index));
}

// Parses a "YYYY-MM-DD" calendar date (as returned by start_date/end_date)
// into a LOCAL-midnight Date, deliberately never via `new Date(dateString)`
// -- the bare-string form parses as UTC midnight in JS, which lands on the
// wrong local calendar day for anyone west of UTC. This is exactly the
// "all-day events are dates, not timestamp-midnight hacks" gotcha
// documented in docs/ARCHITECTURE.md, applied on the read/render side.
export function parseCalendarDate(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localMinutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

interface ResolvedRange {
  start: Date;
  end: Date;
}

// Recurring instances are positioned by their actual occurrence instant,
// never the parent series' template starts_at/ends_at -- see
// EventRangeItemSchema's doc comment: starts_at/ends_at always describe the
// *source event itself* (the series' dtstart/dtend, identical on every
// instance), while occurs_at/occurs_ends_at carry the instance-specific
// real instants a calendar view must actually use.
function resolveTimedRange(entry: EventRangeItem): ResolvedRange | null {
  const startIso = entry.is_recurring_instance ? entry.occurs_at : entry.starts_at;
  const endIso = entry.is_recurring_instance ? entry.occurs_ends_at : entry.ends_at;
  if (!startIso) return null;
  const start = new Date(startIso);
  // No end (a bare point-in-time capture) is treated as a zero-duration
  // marker -- startMinutes === endMinutes below. The component, not this
  // pure layer, is responsible for giving a degenerate duration a minimum
  // tap-friendly visual height.
  const end = endIso ? new Date(endIso) : start;
  return { start, end };
}

function resolveAllDayRange(entry: EventRangeItem): ResolvedRange | null {
  if (!entry.start_date) return null;
  const start = parseCalendarDate(entry.start_date);
  const end = entry.end_date ? parseCalendarDate(entry.end_date) : start;
  return { start, end };
}

export interface AllDayPlacement {
  entry: EventRangeItem;
  dayIndex: number;
}

export interface TimedPlacement {
  entry: EventRangeItem;
  dayIndex: number;
  // Minutes since LOCAL wall-clock midnight of that day's column, clipped
  // to [0, MINUTES_PER_DAY]. Deliberately computed from getHours()/
  // getMinutes() (wall-clock reads) rather than an elapsed-millisecond
  // difference across the day boundary -- see this file's header comment
  // and week-grid-layout.test.ts's DST case for why: a day boundary can be
  // 23 or 25 real hours on a DST transition day, but the grid always draws
  // 24 wall-clock hour rows (0:00-23:59), same as any conventional
  // calendar UI. Reading local hour/minute components directly sidesteps
  // that mismatch entirely instead of having to special-case it.
  startMinutes: number;
  endMinutes: number;
}

export interface WeekLayout {
  days: Date[];
  allDay: AllDayPlacement[];
  timed: TimedPlacement[];
}

// Assigns every entry to the day column(s) -- and, for timed entries, the
// time-of-day slot(s) -- it belongs in for the week containing `week`.
// A multi-day all-day entry gets one placement per day it overlaps within
// the displayed week (Google Calendar's own convention, per the checkpoint
// brief). A timed entry that crosses local midnight (including a genuine
// multi-day span) likewise gets one placement per calendar day it
// overlaps, each clipped to that day's own [0, MINUTES_PER_DAY] window --
// it is never silently dropped or collapsed onto a single day.
export function layoutWeek(week: Date, entries: EventRangeItem[]): WeekLayout {
  const days = getWeekDays(week);
  const allDay: AllDayPlacement[] = [];
  const timed: TimedPlacement[] = [];

  for (const entry of entries) {
    if (entry.all_day) {
      const range = resolveAllDayRange(entry);
      if (!range) continue;
      days.forEach((day, dayIndex) => {
        if (day.getTime() >= range.start.getTime() && day.getTime() <= range.end.getTime()) {
          allDay.push({ entry, dayIndex });
        }
      });
      continue;
    }

    const range = resolveTimedRange(entry);
    if (!range) continue;

    days.forEach((day, dayIndex) => {
      const dayStart = startOfDay(day);
      const dayEnd = addDays(dayStart, 1);
      // No overlap with this day at all -- entry entirely before or at-or-
      // after this day's window. The "<=" / ">=" (not "<" / ">") at both
      // ends is what prevents an entry that starts or ends exactly at a
      // local midnight from being counted on both adjacent days, or on
      // neither.
      if (range.end.getTime() <= dayStart.getTime() || range.start.getTime() >= dayEnd.getTime()) {
        return;
      }

      const startsBeforeThisDay = range.start.getTime() < dayStart.getTime();
      const endsAtOrAfterNextMidnight = range.end.getTime() >= dayEnd.getTime();

      const startMinutes = startsBeforeThisDay ? 0 : localMinutesOfDay(range.start);
      const endMinutes = endsAtOrAfterNextMidnight ? MINUTES_PER_DAY : localMinutesOfDay(range.end);

      timed.push({
        entry,
        dayIndex,
        startMinutes,
        endMinutes: Math.max(endMinutes, startMinutes),
      });
    });
  }

  return { days, allDay, timed };
}

// True if `a` and `b` fall on the same local calendar day -- a thin
// re-export point so week-grid.tsx never needs its own date-fns import
// just for this one comparison (used to label "today" and to build the
// Date passed to onSlotPress).
export function isSameLocalDay(a: Date, b: Date): boolean {
  return isSameDay(a, b);
}
