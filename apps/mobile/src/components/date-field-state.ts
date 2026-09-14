import { formatLocalDate, formatShortDate, parseLocalDate } from "@/utils/local-date";

/**
 * Pure logic behind DateField (Checkpoint 9.5), the date-ONLY sibling of
 * DateTimeField for all-day event start/end dates. Split out for the same
 * reason as components/datetime-field-state.ts: the component imports
 * @expo/ui/jetpack-compose, which is Android-only.
 *
 * Values are bare `YYYY-MM-DD` calendar dates, never instants -- the shape
 * `events.start_date`/`end_date` store and the rule utils/local-date.ts
 * exists to enforce. A picked Date from the Material dialog is UTC MIDNIGHT
 * of the chosen day (see serializePickedDate), so the day is read from its
 * UTC components; a real local INSTANT (a stored starts_at, "now") must
 * never be sliced that way -- utils/all-day-seed.ts.
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
 * The date a picker should open on: the current value, else today.
 */
export function pickerInitialDate(value: string | null | undefined, now = new Date()): Date {
  const date = isLocalDate(value) ? parseLocalDate(value) : new Date(now);
  // UTC midnight of the local calendar day: the dialog reads its initial
  // millis as a UTC date, the same convention its result uses.
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/**
 * Serializes a picked Date as a calendar date. The Material date dialog
 * reports `selectedDateMillis` -- UTC MIDNIGHT of the chosen day, not a
 * local instant (verified in @expo/ui's DatePickerView.kt) -- so the day is
 * read from the UTC components. Reading it on the device's local calendar
 * gave the PREVIOUS day in every zone west of UTC (the off-by-one found on
 * the Rabbit R1 at the 9.5 acceptance).
 */
export function serializePickedDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
