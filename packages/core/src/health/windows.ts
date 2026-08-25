import { addCalendarDays } from "../actionability.js";

// Sync-window arithmetic for the Google Health integration (ADR-046, ADR-048).
//
// WHY THIS FILE EXISTS AT ALL, AND WHY IT WIDENS:
//
// ADR-048 stores no IANA timezone for health data, because the API hands us the
// civil date directly. That is correct for STORAGE -- but the sync *window*
// still needs a clock: "the last 3 days" means turning the server's now() into
// a civil date, and the server runs UTC while the device's civil date can be
// +/- one day from that.
//
// Rather than guess a zone we deliberately do not store, every window is
// computed in UTC and then WIDENED ONE CALENDAR DAY AT EACH END. Every UTC
// offset on Earth lies strictly within -12:00..+14:00, so a one-day widening
// provably contains any real local day. The cost is a little redundant
// fetching; the benefit is that no real local day can fall outside the window.
//
// The corollary is enforced by densifiableRange() below: the two boundary days
// are IN FLIGHT, not verified-absent, and must never be densified. Without that
// rule a user at +05:45 would have their current local day marked "no data" for
// nearly six hours every day, and a user at -07:00 would have a *future* civil
// date marked verified-absent for seven.

/** A half-open civil-date window: [startDate, endDate), both "YYYY-MM-DD". */
export interface CivilWindow {
  startDate: string;
  endDate: string;
}

/** Trailing days covered by the fast cadence, before widening. */
export const HOT_WINDOW_DAYS = 3;
/** Trailing days covered by the nightly authoritative cadence, before widening. */
export const WARM_WINDOW_DAYS = 35;

function utcDateOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** The largest lag behind UTC of any real civil offset (-12:00), in ms. */
const MAX_LAG_BEHIND_UTC_MS = 12 * 60 * 60 * 1000;

/**
 * Builds a widened trailing window covering the `days` most recent UTC calendar
 * days, plus one extra calendar day at each end. Half-open, so the exclusive
 * end is `today + 2` in order to *include* `today + 1` as a covered day.
 */
export function trailingWindow(days: number, now: Date): CivilWindow {
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(`trailingWindow days must be a non-negative integer, got ${days}`);
  }
  const today = utcDateOf(now);
  return {
    startDate: addCalendarDays(today, -days),
    endDate: addCalendarDays(today, 2),
  };
}

/** The fast-cadence window (hourly, per the 6.3 cron). Never densifies, never tombstones. */
export function hotWindow(now: Date): CivilWindow {
  return trailingWindow(HOT_WINDOW_DAYS, now);
}

/** The nightly authoritative window. May densify and tombstone. */
export function warmWindow(now: Date): CivilWindow {
  return trailingWindow(WARM_WINDOW_DAYS, now);
}

/**
 * The most recent civil date that has finished in EVERY timezone on Earth, as
 * an exclusive upper bound.
 *
 * A civil date D is over for offset O once `now >= (D+1) 00:00 - O`. The worst
 * case is the maximum lag behind UTC (-12:00), so subtracting 12 hours from
 * `now` and taking the UTC date yields an exclusive bound that is safe for
 * every offset without needing to know the user's actual zone -- which ADR-048
 * deliberately does not store.
 */
export function lastGloballyCompleteDateExclusive(now: Date): string {
  return utcDateOf(new Date(now.getTime() - MAX_LAG_BEHIND_UTC_MS));
}

/**
 * The sub-range of a window that may be densified -- i.e. where an absent day
 * may be durably recorded as "verified absent" rather than "never verified".
 *
 * Two independent clamps apply, and only one of them touches an edge:
 *
 *   1. NOTHING STILL IN FLIGHT. A civil date is only knowably empty once it has
 *      finished everywhere; until then an absence is unknowable, not verified.
 *      The end is therefore clamped to lastGloballyCompleteDateExclusive(now).
 *      Without this a user at -07:00 would have their current local day stamped
 *      "no data" for seven hours daily, and one at +05:45 would have a *future*
 *      civil date stamped verified-absent.
 *
 *   2. NOTHING BEFORE `firstDataDate`. A backfill reaching years back must not
 *      manufacture verified-absent history for the period before the user owned
 *      the device -- those days were never observable, and claiming otherwise
 *      poisons every average computed over the range. When firstDataDate is
 *      null (this stream has never returned anything) NOTHING is densifiable.
 *
 * Note the START edge is deliberately NOT clamped. Civil-date filtering is
 * exact, so the first day of a fetched window is fully covered -- and because
 * backfill chunks abut, skipping each chunk's first day would punch a
 * systematic hole at every chunk seam.
 *
 * Returns an empty window (startDate === endDate) when nothing qualifies.
 */
export function densifiableRange(
  window: CivilWindow,
  firstDataDate: string | null,
  now: Date,
): CivilWindow {
  if (firstDataDate === null) {
    return { startDate: window.startDate, endDate: window.startDate };
  }
  const inFlightBound = lastGloballyCompleteDateExclusive(now);
  const end = window.endDate < inFlightBound ? window.endDate : inFlightBound;
  const start = window.startDate > firstDataDate ? window.startDate : firstDataDate;
  if (end <= start) return { startDate: start, endDate: start };
  return { startDate: start, endDate: end };
}

/**
 * Splits [from, to) into consecutive half-open chunks of at most
 * `maxRangeDays`, walking BACKWARDS from the end.
 *
 * Backwards because that is the direction backfill travels: from the oldest
 * verified date toward the target, so each completed chunk extends verified
 * history contiguously and the persisted cursor is always a real boundary.
 * Chunks abut exactly -- no overlap, no gap.
 */
export function chunkRange(maxRangeDays: number, from: string, to: string): CivilWindow[] {
  if (!Number.isInteger(maxRangeDays) || maxRangeDays < 1) {
    throw new Error(`maxRangeDays must be a positive integer, got ${maxRangeDays}`);
  }
  const chunks: CivilWindow[] = [];
  let end = to;
  while (end > from) {
    const candidate = addCalendarDays(end, -maxRangeDays);
    const start = candidate > from ? candidate : from;
    chunks.push({ startDate: start, endDate: end });
    end = start;
  }
  return chunks;
}
