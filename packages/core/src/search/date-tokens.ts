// The CLOSED DATE GRAMMAR a search query may carry (Checkpoint 9.6, ADR-065).
//
// A search for "dentist september" should find the September appointment, and
// "rent 2026-10-01" the task due that day. This module recognises the handful
// of date-shaped words the tokenizer offers it and turns each into an
// INCLUSIVE window of local calendar dates. It knows nothing about instants,
// timezones or SQL: `from`/`to` are `YYYY-MM-DD` strings, and turning them
// into `timestamptz` bounds is apps/api's job (`localDayWindowForDate` in
// ../actionability.ts, which lives in the Node barrel this file must not
// import -- `./search/*` is reached by the Expo bundle).
//
// ===========================================================================
// WHY THE ARITHMETIC IS ON THE DATE STRING, NOT ON A Date
// ===========================================================================
//
// "tomorrow" is `today + 1` on the calendar the user is looking at. Adding
// 24 hours to an instant is not that: across a DST change it is 23 or 25
// wall-clock hours, and across midnight in the wrong zone it is the wrong
// day. So every computation here is Y/M/D integer arithmetic. `Date.UTC` is
// used in exactly one place, as a proleptic-Gregorian day counter (it has no
// DST and no offset), never as a clock -- the same discipline ADR-048
// records for health civil dates.
//
// ===========================================================================
// THE GRAMMAR
// ===========================================================================
//
//   today | tomorrow | yesterday            kind "day"       needs `today`
//   YYYY-MM-DD                              kind "iso_date"  must be a real date
//   YYYY-MM                                 kind "iso_month"
//   <month name | 3-letter abbrev | sept>   kind "month"     year = `today`'s
//   <month ...> <YYYY>                      kind "month"     consumes the next word
//   YYYY (19xx | 20xx)                      kind "year"
//
// Every year, including the ISO forms, is bounded to 1900-2099. The contract
// states the bound for bare years; applying it to the ISO forms too keeps the
// window arithmetic inside one century pair and makes "0001-01-01" a plain
// word rather than a window nobody has data in. Word matching is on the
// NFKC-lowercased word, so a full-width "２０２６" is a year.
//
// "may" IS a month here. It is also a modal verb, and the contract lists
// month names without exception; the matching ladder makes that cheap, since a
// date token also matches as TEXT and is dropped on the second rung when the
// window finds nothing.

export type DateWindowKind = "day" | "month" | "year" | "iso_date" | "iso_month";

/** An inclusive window of LOCAL calendar dates, plus the token it came from. */
export interface DateWindowSpec {
  /** The recognised word(s), NFKC-lowercased, space-joined when a year was consumed. */
  token: string;
  kind: DateWindowKind;
  /** First local date in the window, `YYYY-MM-DD`. */
  from: string;
  /** Last local date in the window, `YYYY-MM-DD`, inclusive. */
  to: string;
}

export interface ParsedDateToken extends DateWindowSpec {
  /** True when the following word (a 4-digit year) was folded into this token. */
  consumedNext: boolean;
}

/** Inclusive year bounds for every form that carries a year. */
export const DATE_TOKEN_MIN_YEAR = 1900;
export const DATE_TOKEN_MAX_YEAR = 2099;

const MONTH_WORDS: Readonly<Record<string, number>> = Object.freeze({
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
});

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const BARE_YEAR = /^(19|20)\d{2}$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in `month` (1-12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function formatLocalDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * Parses a `YYYY-MM-DD` string into its parts, or null when it is not a REAL
 * date in the supported year range. "2026-02-30" is null, not March 2nd:
 * a search window must never quietly land on a day the user did not name.
 */
export function parseLocalDate(value: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < DATE_TOKEN_MIN_YEAR || year > DATE_TOKEN_MAX_YEAR) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/**
 * `localDate + days` by calendar arithmetic. `Date.UTC` is the day counter --
 * it is proleptic Gregorian with no DST and no offset, so reading the parts
 * back with the UTC getters is exact. It is never treated as an instant.
 */
export function addDays(localDate: string, days: number): string {
  const parts = parseLocalDate(localDate);
  if (parts === null) {
    throw new Error("addDays requires a valid YYYY-MM-DD local date");
  }
  const counter = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatLocalDate(counter.getUTCFullYear(), counter.getUTCMonth() + 1, counter.getUTCDate());
}

function normalizeWord(word: string): string {
  return word.normalize("NFKC").toLowerCase();
}

function monthWindow(token: string, year: number, month: number): DateWindowSpec {
  return {
    token,
    kind: "month",
    from: formatLocalDate(year, month, 1),
    to: formatLocalDate(year, month, daysInMonth(year, month)),
  };
}

function yearInRange(year: number): boolean {
  return year >= DATE_TOKEN_MIN_YEAR && year <= DATE_TOKEN_MAX_YEAR;
}

/**
 * Recognises one word (and possibly the word after it) as a date token.
 *
 * @param word      the candidate word; normalised here, so callers may pass it raw
 * @param nextWord  the following word, or null at the end of the query; only
 *                  consulted for "<month> <year>"
 * @param today     the user's CURRENT LOCAL DATE, `YYYY-MM-DD`; needed for the
 *                  relative words and for a month with no year. An invalid
 *                  `today` disables those forms rather than throwing -- the
 *                  ISO and bare-year forms need no clock and still parse.
 */
export function parseDateToken(
  word: string,
  nextWord: string | null,
  today: string,
): ParsedDateToken | null {
  const normalized = normalizeWord(word);
  const todayParts = parseLocalDate(today);

  if (normalized === "today" || normalized === "tomorrow" || normalized === "yesterday") {
    if (todayParts === null) return null;
    const offset = normalized === "tomorrow" ? 1 : normalized === "yesterday" ? -1 : 0;
    const date = addDays(today, offset);
    return { token: normalized, kind: "day", from: date, to: date, consumedNext: false };
  }

  const isoDate = parseLocalDate(normalized);
  if (isoDate !== null) {
    const date = formatLocalDate(isoDate.year, isoDate.month, isoDate.day);
    return { token: normalized, kind: "iso_date", from: date, to: date, consumedNext: false };
  }

  const isoMonth = ISO_MONTH.exec(normalized);
  if (isoMonth !== null) {
    const year = Number(isoMonth[1]);
    const month = Number(isoMonth[2]);
    if (!yearInRange(year) || month < 1 || month > 12) return null;
    return { ...monthWindow(normalized, year, month), kind: "iso_month", consumedNext: false };
  }

  const month = MONTH_WORDS[normalized];
  if (month !== undefined) {
    const next = nextWord === null ? null : normalizeWord(nextWord);
    if (next !== null && BARE_YEAR.test(next)) {
      const year = Number(next);
      return { ...monthWindow(`${normalized} ${next}`, year, month), consumedNext: true };
    }
    if (todayParts === null) return null;
    return { ...monthWindow(normalized, todayParts.year, month), consumedNext: false };
  }

  if (BARE_YEAR.test(normalized)) {
    const year = Number(normalized);
    return {
      token: normalized,
      kind: "year",
      from: formatLocalDate(year, 1, 1),
      to: formatLocalDate(year, 12, 31),
      consumedNext: false,
    };
  }

  return null;
}
