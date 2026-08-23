// Date-only (`YYYY-MM-DD`) values -- project target_date, review period_start,
// all-day event start_date/end_date, Today's local_date -- are calendar dates,
// not instants. They must never round-trip through a UTC instant.
//
// `new Date("2026-08-23")` parses as UTC midnight, so in any negative-offset
// zone it formats as the PREVIOUS day; the mirror-image error hits
// `.toISOString().slice(0, 10)` on a local wall-clock instant. Checkpoint 5.5
// fixed this class of bug at the Postgres driver boundary
// (packages/db/src/client.ts); this module is the client-side half.
//
// Extracted in Checkpoint 5.6 from five near-identical copies that had drifted
// across (tabs)/index.tsx, (tabs)/projects.tsx, projects/[id].tsx,
// reviews/daily.tsx and reviews/weekly.tsx -- none of which had any test.

/** Parse `YYYY-MM-DD` into a Date at LOCAL midnight, never UTC midnight. */
export function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, day ?? 1);
}

/** Format a Date's LOCAL calendar date back to `YYYY-MM-DD`. */
export function formatLocalDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today's LOCAL calendar date as `YYYY-MM-DD`. */
export function todayLocalDate(now: Date = new Date()): string {
  return formatLocalDate(now);
}

/**
 * Add whole calendar days to a `YYYY-MM-DD` value, staying in local wall-clock
 * space. DST-safe: Date's own month/day arithmetic handles a 23- or 25-hour day
 * because we never touch the underlying instant directly.
 */
export function addLocalDays(date: string, days: number): string {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

/** Long-form local date, e.g. "Sunday, August 23". */
export function formatHeaderDate(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Short-form local date, e.g. "Aug 23, 2026". Used for target/period dates. */
export function formatShortDate(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
