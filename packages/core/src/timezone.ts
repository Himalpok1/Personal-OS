import { fromZonedTime } from "date-fns-tz";

const supportedTimeZones = new Set(Intl.supportedValuesOf("timeZone"));

export function isValidTimezone(tz: string): boolean {
  return supportedTimeZones.has(tz);
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
