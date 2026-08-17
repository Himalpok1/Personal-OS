import { toWallClockComponents } from "./timezone.js";

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
