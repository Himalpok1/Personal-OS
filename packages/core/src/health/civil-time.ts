import { wallClockToNaiveDate, type WallClockComponents } from "../timezone.js";
import { addCalendarDays } from "../actionability.js";

// Civil-time helpers for the Google Health integration (ADR-048).
//
// The Health API is unusual and pleasant in this respect: it hands us the civil
// (local, offset-less) date directly, alongside the physical instant and the
// UTC offset, as three independent facts. So Personal OS never converts an
// instant into a date for health data, and therefore stores no IANA timezone at
// all. Everything here is parsing and shaping, never inference.

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The API's CivilDateTime: a date plus a time of day, deliberately offset-less. */
export interface GoogleCivilDateTime {
  date: { year: number; month: number; day: number };
  time?: { hours?: number; minutes?: number; seconds?: number; nanos?: number } | undefined;
}

/**
 * Parses a protobuf Duration string ("0s", "-18000s", "3.5s") into whole
 * seconds.
 *
 * Seconds, never hours: Kathmandu is +05:45 and Chatham is +12:45, so an
 * hour-granular offset is simply wrong for real users. Fractional seconds are
 * truncated toward zero -- no real UTC offset has a fractional part, and
 * silently rounding one would hide a malformed payload.
 */
export function parseGoogleDuration(value: string): number {
  const match = /^(-?\d+)(?:\.(\d+))?s$/.exec(value.trim());
  if (!match) {
    throw new Error(`invalid Google Duration "${value}", expected e.g. "0s" or "-18000s"`);
  }
  return Number(match[1]);
}

/** Formats a CivilDateTime's date part as "YYYY-MM-DD". */
export function civilDateToLocalDate(civil: GoogleCivilDateTime): string {
  const { year, month, day } = civil.date;
  return (
    `${String(year).padStart(4, "0")}-` +
    `${String(month).padStart(2, "0")}-` +
    `${String(day).padStart(2, "0")}`
  );
}

/**
 * Converts a CivilDateTime into the Date that must be written to a
 * `timestamp without time zone` column (health_sessions.civil_start_local,
 * health_observations.civil_local).
 *
 * Delegates to wallClockToNaiveDate, the same helper tasks.due_local and
 * occurrences.occurs_local already go through -- a naive column stores the
 * Date's *UTC* getters, so building this by hand is the classic way to be off
 * by the process timezone.
 */
export function civilDateTimeToNaiveDate(civil: GoogleCivilDateTime): Date {
  const components: WallClockComponents = {
    year: civil.date.year,
    month: civil.date.month,
    day: civil.date.day,
    hour: civil.time?.hours ?? 0,
    minute: civil.time?.minutes ?? 0,
    second: civil.time?.seconds ?? 0,
  };
  return wallClockToNaiveDate(components);
}

/**
 * Every civil date in the half-open range [from, to), as "YYYY-MM-DD".
 *
 * This is what densification iterates: the API omits days with no recorded
 * data, so the full expected range has to be synthesized locally to tell
 * "verified absent" from "never verified".
 */
export function civilDateRange(from: string, to: string): string[] {
  if (!LOCAL_DATE.test(from)) throw new Error(`invalid from date "${from}"`);
  if (!LOCAL_DATE.test(to)) throw new Error(`invalid to date "${to}"`);
  const dates: string[] = [];
  let cursor = from;
  // Bounded defensively: a caller passing to < from gets an empty array rather
  // than an infinite loop.
  while (cursor < to) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return dates;
}
