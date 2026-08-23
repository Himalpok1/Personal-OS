// Lives in src/utils, NOT next to the screen that uses it: everything under
// src/app is Expo Router's ROUTES directory, so any file placed there becomes
// a route and is pulled into the app bundle. A colocated `new.test.ts` here
// therefore both registered a bogus `/events/new.test` route AND dragged
// vitest -> vite (a Node-only package) into the web bundle, breaking
// `expo export --platform web` outright. Keeping the pure helper and its test
// outside src/app avoids that whole class of problem.

import { formatLocalDate } from "./local-date";

/**
 * Seed the all-day start/end date fields from the pre-fill params.
 *
 * `startsAt`/`endsAt` are full ISO instants (see `NewEventParams` above),
 * produced from a LOCAL wall-clock slot by the week-grid tap handler
 * (`(tabs)/calendar.tsx`'s `date.toISOString()`). Slicing that string's
 * first 10 characters -- the previous approach -- reads its UTC calendar
 * date, not the device's local one: a 19:00 America/Chicago slot serializes
 * to an instant whose UTC date is the FOLLOWING day, and a 06:00
 * Pacific/Auckland slot (UTC+13) serializes to an instant whose UTC date is
 * the PRECEDING day. `formatLocalDate` re-derives the calendar date the
 * device would actually show for that instant, matching the day the user
 * tapped. `date` (used by the month-grid day-tap path, already a bare
 * "YYYY-MM-DD") needs no conversion and keeps precedence over
 * startsAt/endsAt, exactly as before.
 */
export function deriveAllDaySeedDates(params: {
  date?: string;
  startsAt?: string;
  endsAt?: string;
}): { startDate: string; endDate: string } {
  const startDate = params.date ?? (params.startsAt ? formatLocalDate(new Date(params.startsAt)) : "");
  const endDate =
    params.date ??
    (params.endsAt
      ? formatLocalDate(new Date(params.endsAt))
      : params.startsAt
        ? formatLocalDate(new Date(params.startsAt))
        : "");
  return { startDate, endDate };
}
