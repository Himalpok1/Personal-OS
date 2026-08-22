// Pure, React-free display/date helpers for the Agenda screen -- kept
// testable with plain vitest and no React Native mocking, same taste as
// notifications/reconcile.ts and components/calendar/grid-math.ts.

/** Parse a "YYYY-MM-DD" date string into local wall-clock Date components
 * (midnight local time) -- mirrors (tabs)/index.tsx's parseLocalDate so a
 * weekday/date computation never drifts through a UTC conversion. */
export function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, day ?? 1);
}

function formatLocalDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Add (or subtract, for a negative count) whole calendar days to a
 * "YYYY-MM-DD" date string using local wall-clock date arithmetic --
 * correct across month-end and year-end rollovers by construction, since
 * it never touches an instant/offset, only calendar-date fields. */
export function addLocalCalendarDays(date: string, days: number): string {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

/** The server caps an Agenda request's span at 90 days inclusive
 * (packages/schema/src/agenda.ts). Default to today .. today+89, a 90-day
 * calendar-date span, safely within that cap. */
export function defaultAgendaRange(todayLocalDate: string): { from: string; to: string } {
  return { from: todayLocalDate, to: addLocalCalendarDays(todayLocalDate, 89) };
}

/** TODAY / TOMORROW / a short weekday+date label for any other day --
 * correct across a month boundary (e.g. Aug 31 -> Sep 1) and a year
 * boundary (Dec 31 -> Jan 1), since both TODAY/TOMORROW comparison and the
 * fallback label go through the same local-date parsing above. */
export function formatAgendaDayLabel(date: string, todayLocalDate: string): string {
  if (date === todayLocalDate) return "Today";
  if (date === addLocalCalendarDays(todayLocalDate, 1)) return "Tomorrow";
  return parseLocalDate(date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Days with zero items are omitted entirely from the Agenda list, mirroring
 * UpcomingSection's "return null rather than render an empty block"
 * precedent in (tabs)/index.tsx. */
export function filterNonEmptyDays<T extends { items: readonly unknown[] }>(
  days: readonly T[],
): T[] {
  return days.filter((day) => day.items.length > 0);
}

function getOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const wallAsUtcMs = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return (wallAsUtcMs - instant.getTime()) / 60_000;
}

/**
 * Advance an offset-bearing ISO instant by exactly one calendar day *in the
 * task's own IANA timezone*, preserving its wall-clock time-of-day --
 * mirrors docs/ARCHITECTURE.md's "wall-clock time is the invariant" rule
 * for the +1 day reschedule affordance, so a reminder at 9am stays at 9am
 * across a DST transition instead of drifting by an hour.
 *
 * Deliberately dependency-free (no date-fns-tz in this app): computes the
 * wall-clock components via Intl.DateTimeFormat (Hermes-safe, same pattern
 * as @personal-os/core/timezone's isValidTimezone fix), advances the pure
 * calendar-date part by one day, then re-resolves to a UTC instant using
 * the target day's own offset -- a one-pass guess-and-correct, safe here
 * since IANA offsets never shift by anywhere near a full day.
 */
export function addOneDayPreservingWallClock(iso: string, timeZone: string): string {
  const instant = new Date(iso);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour);
  const minute = Number(map.minute);
  const second = Number(map.second);

  // Pure calendar-date increment (UTC-day arithmetic on the date fields
  // only -- correct across month/year boundaries by construction).
  const nextDateUtc = new Date(Date.UTC(year, month - 1, day + 1));
  const nextYear = nextDateUtc.getUTCFullYear();
  const nextMonth = nextDateUtc.getUTCMonth() + 1;
  const nextDay = nextDateUtc.getUTCDate();

  const naiveGuessMs = Date.UTC(nextYear, nextMonth - 1, nextDay, hour, minute, second);
  const offsetMinutes = getOffsetMinutes(new Date(naiveGuessMs), timeZone);
  const correctedMs = naiveGuessMs - offsetMinutes * 60_000;
  return new Date(correctedMs).toISOString();
}
