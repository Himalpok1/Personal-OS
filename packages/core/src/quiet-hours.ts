import { resolveWallClockToInstant, toWallClockComponents } from "./timezone.js";

function parseTimeToMinutes(time: string): number {
  const [hourStr, minuteStr] = time.split(":");
  return Number(hourStr ?? 0) * 60 + Number(minuteStr ?? 0);
}

// Used by apps/worker's notifications.dispatch job: confirmation/digest
// notifications are suppressed while the target device is in quiet hours,
// alerts never are (a service-down alert is exactly the "tell me now" case
// quiet hours shouldn't block). There is no "send at the end of quiet
// hours" catch-up in Phase 3 -- a suppressed notification is simply never
// sent to that device, per docs/ARCHITECTURE.md's notification design.
//
// All three quiet-hours fields must be set for suppression to apply --
// a device with any of them unset is never considered in quiet hours.
// Handles the overnight-wraparound case (e.g. 22:00 -> 06:00).
export function isWithinQuietHours(
  now: Date,
  quietHoursStart: string | null,
  quietHoursEnd: string | null,
  quietHoursTimezone: string | null,
): boolean {
  if (!quietHoursStart || !quietHoursEnd || !quietHoursTimezone) return false;

  const { hour, minute } = toWallClockComponents(now, quietHoursTimezone);
  const nowMinutes = hour * 60 + minute;
  const startMinutes = parseTimeToMinutes(quietHoursStart);
  const endMinutes = parseTimeToMinutes(quietHoursEnd);

  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

/**
 * The instant a device's quiet hours next end, or null when there is nothing to
 * wait for.
 *
 * ===========================================================================
 * WHY THIS EXISTS: ADR-053 AMENDMENT E, AND A DEFECT THAT IS LIVE TODAY.
 * ===========================================================================
 *
 * `isWithinQuietHours` above is used by `notifications.dispatch` to SUPPRESS a
 * confirmation or digest, and the comment on it records the Phase 3 design
 * faithfully: "a suppressed notification is simply never sent to that device".
 *
 * That is survivable for a capture confirmation, which is tied to one capture
 * the user just made and will see in the Inbox anyway. It is not survivable for
 * a RECURRING digest. The digest cron fires at a fixed wall-clock hour; if that
 * hour falls inside a device's quiet hours, the notification is dropped -- with
 * no `notification_dispatch_log` row, no log line, and a job that completes
 * successfully so pg-boss never retries it. The user is not told once; they are
 * never told, every day, silently, forever.
 *
 * ADR-053 amendment E names this exactly and requires that quiet hours DELAY the
 * notification rather than suppressing it.
 *
 * This function is the delay. A producer asks when the quiet window ends and
 * enqueues with pg-boss's `startAfter`, so the job simply arrives later and the
 * router's own check -- unchanged -- passes when it does. Two alternatives were
 * rejected: exempting digests from the quiet-hours test would defeat the point
 * of quiet hours (a 07:00 digest would wake someone at 03:00 in their own zone),
 * and adding a "deferred" column would be a schema change to solve a scheduling
 * problem the queue already solves.
 *
 * Returns null -- meaning "send now" -- when any of the three fields is unset,
 * or when the device is not currently in quiet hours. Note the window's END IS
 * EXCLUSIVE in `isWithinQuietHours` (`nowMinutes < endMinutes`), so a job that
 * lands exactly on the returned instant is outside the window and passes; that
 * is what makes this instant the correct one to wait for rather than one minute
 * past it.
 */
export function nextQuietHoursEnd(
  now: Date,
  quietHoursStart: string | null,
  quietHoursEnd: string | null,
  quietHoursTimezone: string | null,
): Date | null {
  if (!isWithinQuietHours(now, quietHoursStart, quietHoursEnd, quietHoursTimezone)) return null;
  // isWithinQuietHours returned true, so all three are set.
  const timezone = quietHoursTimezone as string;
  const endMinutes = parseTimeToMinutes(quietHoursEnd as string);

  const local = toWallClockComponents(now, timezone);
  const nowMinutes = local.hour * 60 + local.minute;

  // Resolve the END wall clock on the device's own current local date, then roll
  // forward a day if that instant has already passed. Rolling by CALENDAR DATE
  // rather than by adding 24h is what keeps this correct across a DST
  // transition: a "06:00 local" boundary stays 06:00 local on the following day
  // even when that day is 23 or 25 hours long.
  const endToday = resolveWallClockToInstant(
    {
      year: local.year,
      month: local.month,
      day: local.day,
      hour: Math.floor(endMinutes / 60),
      minute: endMinutes % 60,
      second: 0,
    },
    timezone,
  );
  if (nowMinutes < endMinutes) return endToday;

  // An overnight window (22:00 -> 06:00) observed before midnight: the end is
  // tomorrow's 06:00, not today's, which already passed sixteen hours ago.
  //
  // ADVANCED BY CALENDAR DATE, NEVER BY ADDING 24 HOURS OF ELAPSED TIME. The
  // first version of this did the latter and a DST test caught it immediately:
  // from 23:00 on the day before a spring-forward, adding 24h lands at 00:00 the
  // day AFTER the intended one, because the intervening local day is only 23
  // hours long. It skips a date. `Date.UTC` is used purely as calendar
  // arithmetic over the already-resolved local components -- it handles month
  // and year rollover -- and the result is resolved back through the zone, so
  // no UTC instant is ever mistaken for a local one.
  const nextDay = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  return resolveWallClockToInstant(
    {
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
      hour: Math.floor(endMinutes / 60),
      minute: endMinutes % 60,
      second: 0,
    },
    timezone,
  );
}
