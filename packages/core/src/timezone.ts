import { fromZonedTime } from "date-fns-tz";

// Deliberately not Intl.supportedValuesOf("timeZone") -- that's an ES2022
// addition Hermes (React Native's JS engine on Android/iOS) does not
// implement, even though Node and every browser do. This package is shared
// by the backend (Node) and, since Phase 3's native build, apps/mobile
// running on-device -- calling an unsupported Intl method there throws
// "undefined is not a function" and silently blanks every screen that
// imports this package transitively (discovered via the Checkpoint 3
// hardware spike, the first time this codebase ever ran on Hermes rather
// than Node or a browser). Intl.DateTimeFormat's `timeZone` option, in
// contrast, is a long-standing ES2015-era Intl feature and throws a
// RangeError for an invalid IANA zone -- a portable validity check that
// works identically across Node, browsers, and Hermes.
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface WallClockComponents {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function formatWallClockIso(components: WallClockComponents): string {
  const { year, month, day, hour, minute, second } = components;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

// Resolves a wall-clock local date/time in an IANA zone to the correct UTC
// instant -- the DST-safety primitive the recurrence modules build on (see
// docs/ARCHITECTURE.md: "the wall-clock time is the invariant, not the
// instant"). Verified against date-fns-tz's documented, system-timezone-
// independent behavior in due-date-window.test.ts: an ambiguous DST
// fall-back time resolves to the earlier (pre-transition) instant; a
// nonexistent DST spring-forward time resolves using the post-transition
// offset applied to the literal components, without shifting the clock
// forward. Both are deterministic, not platform-dependent.
export function resolveWallClockToInstant(components: WallClockComponents, timezone: string): Date {
  return fromZonedTime(formatWallClockIso(components), timezone);
}

// A "floating" Date representation of wall-clock components -- carries the
// value in its UTC getters, not real UTC. This is deliberately what RRule
// expects internally (see recurrence/due-date-window.ts), and it's also
// exactly what node-postgres/Drizzle serialize into a `timestamp` (no time
// zone) column: verified empirically that a Date's *UTC* getters, not the
// process's system time zone, determine what gets written to `timestamp
// without time zone` columns like tasks.due_local / occurrences.occurs_local.
// Never pass this Date to anything that reads local (non-UTC) getters.
export function wallClockToNaiveDate(components: WallClockComponents): Date {
  return new Date(
    Date.UTC(
      components.year,
      components.month - 1,
      components.day,
      components.hour,
      components.minute,
      components.second,
    ),
  );
}

const OFFSET_SUFFIX = /(Z|[+-]\d{2}:\d{2})$/;
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;

// LLM tool-call output isn't guaranteed to include a UTC offset just
// because the schema asks for one -- a model resolving "tomorrow at 3pm"
// may return "2026-08-17T15:00:00" with no offset at all. Parsing that
// directly via `new Date(...)` would silently use the *server process's*
// system time zone (typically UTC in a container), misinterpreting a
// Chicago afternoon as a UTC one -- hours off, wrong day at the edges.
// This resolves offset-bearing strings normally (unambiguous) and falls
// back to interpreting offset-less strings as wall-clock time in the
// caller-supplied timezone (the capture's own timezone), using the same
// DST-safe primitive as everything else.
export function parseFlexibleDatetime(value: string, fallbackTimezone: string): Date {
  if (OFFSET_SUFFIX.test(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`invalid datetime "${value}"`);
    }
    return parsed;
  }
  const match = NAIVE_DATETIME.exec(value);
  if (!match) {
    throw new Error(`invalid datetime "${value}"`);
  }
  const [, year, month, day, hour, minute, second] = match;
  return resolveWallClockToInstant(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    },
    fallbackTimezone,
  );
}

// The inverse: what wall-clock date/time this UTC instant displays as in
// the given zone. Implemented directly against Intl (not date-fns-tz)
// specifically to avoid any dependency on that library's Date-object getter
// conventions -- this function only ever deals in explicit numeric
// components.
export function toWallClockComponents(instant: Date, timezone: string): WallClockComponents {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (value === undefined) throw new Error(`Intl did not return a "${type}" part`);
    return Number(value);
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Some engines/locales report midnight as "24" under hour12: false.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

// Serializes an instant as ISO-8601 carrying the OFFSET that the given zone
// was actually at for that instant -- e.g.
// "2026-09-04T15:30:00-05:00" for America/Chicago.
//
// Added by Checkpoint 8.4 for the mobile date/time pickers. A picker yields
// an instant, but the contracts it feeds (TaskCreateSchema.due_at,
// TaskUpdateSchema.remind_at) accept an offset-less datetime and would then
// resolve it against the capture's timezone -- so emitting a bare local
// string makes the value silently ambiguous. Emitting UTC instead would be
// unambiguous but throws away the wall clock the user actually chose, which
// docs/ARCHITECTURE.md names as the invariant.
//
// The offset is DERIVED from the zone's own rendering of the instant rather
// than read from any Date getter, so it is correct across DST without the
// host's own timezone entering into it at all.
export function formatInstantWithOffset(instant: Date, timezone: string): string {
  const components = toWallClockComponents(instant, timezone);
  const asUtcMillis = Date.UTC(
    components.year,
    components.month - 1,
    components.day,
    components.hour,
    components.minute,
    components.second,
  );
  // Whole minutes: every IANA offset in use is a whole number of minutes.
  const offsetMinutes = Math.round((asUtcMillis - instant.getTime()) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
  return `${formatWallClockIso(components)}${offset}`;
}
