// Snooze targets for a task (Checkpoint 9.3, client-side only -- no API
// change). A snooze is an ordinary PATCH of `due_at` (and `remind_at`, when
// the task has one) to a new instant; this module only decides WHICH instant.
//
// Deliberately imports nothing but ./timezone, so the `./task-snooze` deep
// subpath in package.json is client-safe: apps/mobile must never import the
// core barrel (it re-exports rrule and Node-only device-auth modules).
//
// DST safety follows docs/ARCHITECTURE.md ("the wall-clock time is the
// invariant, not the instant"): "tomorrow at 9am" is computed as the CALENDAR
// day after `now`'s local date in `tz`, at 09:00 wall clock, resolved to an
// instant through the same primitive the recurrence engine uses -- never by
// adding 24 hours to an instant, which is an hour off twice a year.
// "In one hour" is the one target that IS an elapsed duration, so it is
// instant arithmetic on purpose.

import { resolveWallClockToInstant, toWallClockComponents } from "./timezone.js";

/** Wall-clock hour the morning snooze targets land on. */
export const SNOOZE_MORNING_HOUR = 9;

export interface SnoozeTargets {
  /** 09:00 local on the calendar day after `now`'s local date, as an ISO instant. */
  tomorrowMorning: string;
  /** `now` + 60 minutes, as an ISO instant. */
  inOneHour: string;
  /** 09:00 local on the calendar day seven days after `now`'s local date, as an ISO instant. */
  nextWeekMorning: string;
}

export type SnoozeChoice = keyof SnoozeTargets;

const ONE_HOUR_MS = 60 * 60 * 1000;

function morningAfterLocalDays(now: Date, tz: string, days: number): Date {
  const today = toWallClockComponents(now, tz);
  // Calendar arithmetic on a naive UTC date: Date.UTC never applies DST, so
  // adding `days` here moves the CALENDAR date exactly, with month/year
  // rollover handled by the engine. The result's UTC getters are the target
  // local date, which is then resolved in `tz`.
  const shifted = new Date(Date.UTC(today.year, today.month - 1, today.day + days));
  return resolveWallClockToInstant(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: SNOOZE_MORNING_HOUR,
      minute: 0,
      second: 0,
    },
    tz,
  );
}

/**
 * The three snooze instants for a task, given the current instant and the
 * IANA zone the user is reading the clock in (the DEVICE's zone -- a task's
 * own timezone affects display only, per the frozen Today semantics).
 */
export function computeSnoozeTargets(now: Date, tz: string): SnoozeTargets {
  if (Number.isNaN(now.getTime())) throw new Error("computeSnoozeTargets: invalid `now`");
  return {
    tomorrowMorning: morningAfterLocalDays(now, tz, 1).toISOString(),
    inOneHour: new Date(now.getTime() + ONE_HOUR_MS).toISOString(),
    nextWeekMorning: morningAfterLocalDays(now, tz, 7).toISOString(),
  };
}

export interface SnoozePatch {
  due_at: string;
  remind_at?: string;
}

/**
 * The PATCH body that applies a snooze. `due_at` always moves; `remind_at`
 * moves only when the task already HAS a reminder -- snoozing must never
 * create a reminder the user did not set (a reminder is what makes the
 * primary device schedule a local alarm).
 */
export function buildSnoozePatch(task: { remind_at: string | null }, target: string): SnoozePatch {
  return task.remind_at === null ? { due_at: target } : { due_at: target, remind_at: target };
}
