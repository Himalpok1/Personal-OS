// Per-occurrence reminder derivation (Checkpoint 9.4). A recurring task stores
// ONE `remind_at` on the parent row -- the reminder the owner set for the
// series anchor -- and each occurrence's reminder is derived from it here,
// never stored. The parent's remind_at is read as two facts: its wall-clock
// TIME in `recurrence_timezone`, and how many calendar days BEFORE the due
// date it falls. Both are then re-applied to every occurrence: "remind me the
// evening before, at 8pm" stays "the evening before, at 8pm" on every
// instance, across DST, in the series' own zone.
//
// Pure and client-safe: only ../timezone.js, no rrule, no Node builtins. The
// API's GET /reminders is the primary caller, but the module is reachable from
// apps/mobile through the `./recurrence/occurrence-reminder` deep subpath.
//
// Rules, each pinned by a test:
//   - `snoozedUntil` wins outright: a snoozed occurrence is due at the snooze
//     instant, and its reminder IS that instant.
//   - dayDelta = calendar days from remind's local date to due's local date,
//     computed on naive dates (Date.UTC never applies DST, so a difference of
//     N local days is exactly N * 86_400_000 ms in that space). A reminder
//     AFTER the due date (negative delta) is honoured with the same
//     arithmetic -- the occurrence's date minus a negative offset is a date
//     after it. The product CAN set one: due date and reminder are two
//     independent pickers, and "nudge me the day after" is a legitimate
//     choice the derivation must not silently rewrite into same-day
//     (Checkpoint 9.4 review; this used to clamp to 0 on the false premise
//     that no such reminder could exist).
//   - No due_at on the parent → dayDelta 0 (remind on the occurrence's own
//     day at the remind wall-clock time).
//   - The target is resolved through resolveWallClockToInstant, the same
//     DST-safe primitive the recurrence engine uses -- never by adding a
//     millisecond offset to occurs_at, which is an hour wrong twice a year.

import {
  resolveWallClockToInstant,
  toWallClockComponents,
  type WallClockComponents,
} from "../timezone.js";

export interface ReminderParent {
  /** The series anchor (tasks.due_at), or null for a series with no due date. */
  dueAt: Date | null;
  /** tasks.remind_at -- the reminder set for the anchor. */
  remindAt: Date;
  /** tasks.recurrence_timezone; the zone every wall-clock reading happens in. */
  recurrenceTimezone: string;
}

export interface ReminderOccurrence {
  occursAt: Date;
  snoozedUntil: Date | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function naiveDateMs(components: WallClockComponents): number {
  return Date.UTC(components.year, components.month - 1, components.day);
}

function shiftLocalDate(
  components: WallClockComponents,
  days: number,
): Pick<WallClockComponents, "year" | "month" | "day"> {
  const shifted = new Date(Date.UTC(components.year, components.month - 1, components.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * Calendar-day offset between the parent's reminder and its due date in the
 * recurrence zone: 0 for same day, 1 for "the day before", -1 for "the day
 * after", … Signed, never clamped (see header). Exported so GET /reminders
 * can log the offset as a number without re-deriving it.
 */
export function reminderDayOffset(parent: ReminderParent): number {
  if (parent.dueAt === null) return 0;
  const dueLocal = toWallClockComponents(parent.dueAt, parent.recurrenceTimezone);
  const remindLocal = toWallClockComponents(parent.remindAt, parent.recurrenceTimezone);
  return Math.round((naiveDateMs(dueLocal) - naiveDateMs(remindLocal)) / MS_PER_DAY);
}

export function deriveOccurrenceReminder(
  parent: ReminderParent,
  occurrence: ReminderOccurrence,
): Date {
  if (occurrence.snoozedUntil !== null) return occurrence.snoozedUntil;

  const tz = parent.recurrenceTimezone;
  const remindWall = toWallClockComponents(parent.remindAt, tz);
  const occursLocal = toWallClockComponents(occurrence.occursAt, tz);
  const targetDate = shiftLocalDate(occursLocal, -reminderDayOffset(parent));

  return resolveWallClockToInstant(
    {
      ...targetDate,
      hour: remindWall.hour,
      minute: remindWall.minute,
      second: remindWall.second,
    },
    tz,
  );
}
