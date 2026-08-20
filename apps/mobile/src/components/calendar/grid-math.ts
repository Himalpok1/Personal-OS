// Pure date-bucketing logic for the month grid, deliberately kept free of
// any React/React Native import -- same "thin composition over tested pure
// logic" precedent as notifications/reconcile.ts. This is the first module
// in apps/mobile to depend on date-fns; see grid-math.test.ts for the
// Node-safety verification and the sibling web-bundle check run alongside
// it (see docs/STATUS.md's Checkpoint 4.2 entry once filed).
//
// Design note: this bucketing is deliberately LOCAL-DEVICE-TIMEZONE based
// (plain `Date`, no IANA timezone parameter), unlike packages/core's
// server-side recurrence machinery (resolveWallClockToInstant etc.), which
// resolves against an explicit `recurrence_timezone`/`timezone` column for
// authoritative reminder scheduling. This module only decides which calendar
// cell to render an already-resolved instant in on the viewer's own device,
// the same way `quick-add-fab.tsx` already uses
// `Intl.DateTimeFormat().resolvedOptions().timeZone` (the device's own zone)
// rather than a stored one. That is the correct behavior for a calendar UI:
// a US traveler in Tokyo should see their events bucketed onto Tokyo's
// calendar days, not Chicago's.
import type { EventRangeItem } from "@personal-os/schema";
import { addDays, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek } from "date-fns";

// A complete grid is always full weeks -- 4, 5, or 6 rows depending on how
// the month falls -- so the caller never has to special-case a partial
// leading or trailing row.
export function getMonthGridDays(month: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));

  const days: Date[] = [];
  let cursor = gridStart;
  while (cursor <= gridEnd) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function dayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

// Parses a `YYYY-MM-DD` date-only string (as EventRangeItem's
// start_date/end_date are) as a LOCAL calendar date at local midnight.
// `new Date("YYYY-MM-DD")` parses as UTC midnight instead, which shifts a
// day when read back in any negative-UTC-offset timezone -- exactly the
// off-by-one class of bug docs/ARCHITECTURE.md's gotcha #2 warns about for
// all-day events ("storing an all-day event as midnight-timestamptz makes it
// jump days for anyone crossing a zone"). This function is the guard against
// that on the read/render side.
function parseCalendarDateOnly(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(year, month - 1, day);
}

interface EntrySpan {
  start: Date; // local calendar day, inclusive
  end: Date; // local calendar day, inclusive
}

// Resolves which calendar days an entry occupies, per the three source
// kinds EventRangeItemSchema documents:
//   - all_day: true               -> start_date/end_date (calendar dates)
//   - is_recurring_instance: true -> occurs_at/occurs_ends_at (the real
//                                     instance instants, NOT the parent
//                                     series' starts_at template)
//   - otherwise (one-off timed)   -> starts_at/ends_at
function resolveEntrySpan(entry: EventRangeItem): EntrySpan | null {
  if (entry.all_day) {
    if (!entry.start_date) return null;
    const start = parseCalendarDateOnly(entry.start_date);
    const end = entry.end_date ? parseCalendarDateOnly(entry.end_date) : start;
    return { start, end };
  }
  if (entry.is_recurring_instance) {
    if (!entry.occurs_at) return null;
    const start = startOfDay(new Date(entry.occurs_at));
    const end = startOfDay(new Date(entry.occurs_ends_at ?? entry.occurs_at));
    return { start, end };
  }
  if (!entry.starts_at) return null;
  const start = startOfDay(new Date(entry.starts_at));
  const end = startOfDay(new Date(entry.ends_at ?? entry.starts_at));
  return { start, end };
}

// Buckets entries by the local calendar day (yyyy-MM-dd key) they fall on,
// clipped to [rangeStart, rangeEnd] inclusive. A multi-day-spanning entry
// (all-day or timed) appears in every day's bucket it overlaps, not just its
// start day.
export function groupEntriesByDay(
  entries: EventRangeItem[],
  rangeStart: Date,
  rangeEnd: Date,
): Map<string, EventRangeItem[]> {
  const buckets = new Map<string, EventRangeItem[]>();
  const clampStart = startOfDay(rangeStart);
  const clampEnd = startOfDay(rangeEnd);

  for (const entry of entries) {
    const span = resolveEntrySpan(entry);
    if (!span) continue;

    const spanStart = span.start < clampStart ? clampStart : span.start;
    const spanEnd = span.end > clampEnd ? clampEnd : span.end;
    if (spanStart > spanEnd) continue;

    let cursor = spanStart;
    while (cursor <= spanEnd) {
      const key = dayKey(cursor);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(entry);
      } else {
        buckets.set(key, [entry]);
      }
      cursor = addDays(cursor, 1);
    }
  }

  return buckets;
}
