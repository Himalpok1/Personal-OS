import { formatInstantWithOffset } from "@personal-os/core/timezone";

/**
 * Pure logic behind DateTimeField, split out because the component itself
 * imports @expo/ui/jetpack-compose, which is Android-only and cannot be
 * loaded under the mobile vitest transform. Same split as
 * components/mail/connection-state.ts and components/inbox/confirm-state.ts.
 */

/** The device's own IANA zone, resolved once per call site. */
export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Merges the calendar date from one picker with the wall-clock time from the
 * other. The two @expo/ui dialogs each return a full Date, but only half of
 * each is meaningful -- the date dialog's time is arbitrary and the time
 * dialog's date is today.
 *
 * Seconds and milliseconds are zeroed: a picker offers neither, so carrying
 * whatever the dialog happened to construct would store a precision the user
 * never chose.
 */
export function combineDateAndTime(datePart: Date, timePart: Date): Date {
  // The Material date dialog reports `selectedDateMillis`, which is UTC
  // MIDNIGHT of the chosen calendar day (verified in @expo/ui's
  // DatePickerView.kt), not a local instant. Reading it with local getters
  // in any zone west of UTC yields the PREVIOUS day (Sep 18 00:00Z is Sep 17
  // 19:00 in Chicago) -- the off-by-one found on the Rabbit R1 at the 9.5
  // acceptance. The calendar day therefore comes from the UTC components;
  // the wall-clock time from the time dialog is local.
  return new Date(
    datePart.getUTCFullYear(),
    datePart.getUTCMonth(),
    datePart.getUTCDate(),
    timePart.getHours(),
    timePart.getMinutes(),
    0,
    0,
  );
}

/**
 * The instant to open the Material DATE dialog on so it highlights the
 * local calendar day of `instant`: the dialog reads its initial millis as a
 * UTC date, so a local evening instant west of UTC would otherwise open on
 * the next day.
 */
export function datePickerInitialInstant(instant: Date): Date {
  return new Date(Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate()));
}

/** Serializes a picked instant for the API, carrying the zone's real offset. */
export function serializePickedInstant(instant: Date, timezone = deviceTimezone()): string {
  return formatInstantWithOffset(instant, timezone);
}

/**
 * Human label for a stored value.
 *
 * Returns null for absent OR unparseable input rather than throwing or
 * rendering "Invalid Date": these fields have been free-text ISO inputs since
 * Phase 2, so existing rows can hold anything at all.
 */
export function formatFieldLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return instant.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The instant a picker should open on: the current value, else now. */
export function pickerInitialInstant(value: string | null | undefined, now = new Date()): Date {
  if (!value) return now;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? now : instant;
}

/** Whether a chosen reminder instant is in the past. Informational, never blocking. */
export function isPastInstant(value: string | null | undefined, now = new Date()): boolean {
  if (!value) return false;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return false;
  return instant.getTime() < now.getTime();
}
