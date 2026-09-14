import { formatLocalDate, formatShortDate, parseLocalDate } from "@/utils/local-date";

/**
 * Pure logic behind DateField (Checkpoint 9.5), the date-ONLY sibling of
 * DateTimeField for all-day event start/end dates. Split out for the same
 * reason as components/datetime-field-state.ts: the component imports
 * @expo/ui/jetpack-compose, which is Android-only.
 *
 * Values are bare `YYYY-MM-DD` calendar dates, never instants -- the shape
 * `events.start_date`/`end_date` store and the rule utils/local-date.ts
 * exists to enforce. A picked Date is read on the DEVICE's local calendar
 * (formatLocalDate), because the picker dialog itself builds its result on
 * the device clock; the one thing this module must never do is
 * `.toISOString().slice(0, 10)` (the UTC date, off by one in any
 * negative-offset zone after ~19:00 local -- utils/all-day-seed.ts).
 */

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a stored string is a well-formed, real calendar date. */
export function isLocalDate(value: string | null | undefined): value is string {
  if (!value || !LOCAL_DATE.test(value)) return false;
  const parsed = parseLocalDate(value);
  // `new Date(2026, 1, 31)` rolls to March 3 rather than failing; the
  // round-trip catches that as well as NaN.
  return !Number.isNaN(parsed.getTime()) && formatLocalDate(parsed) === value;
}

/** Human label for a stored value, or null when absent or unreadable. */
export function formatDateFieldLabel(value: string | null | undefined): string | null {
  return isLocalDate(value) ? formatShortDate(value) : null;
}

/**
 * The date a picker should open on: the current value, else today. Returned
 * at LOCAL NOON rather than local midnight: the dialog takes an ISO instant,
 * and a local-midnight instant serialised in a negative-offset zone reads as
 * the previous UTC day, which is where the Material date picker would then
 * open. Noon is on the same calendar day at every offset on Earth.
 */
export function pickerInitialDate(value: string | null | undefined, now = new Date()): Date {
  const date = isLocalDate(value) ? parseLocalDate(value) : new Date(now);
  date.setHours(12, 0, 0, 0);
  return date;
}

/** Serializes a picked Date as the device-local calendar date. */
export function serializePickedDate(date: Date): string {
  return formatLocalDate(date);
}
