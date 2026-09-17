// Free blocks -- the deterministic gaps left in the rest of today's working
// window once today's timed events are subtracted (Checkpoint 10.6,
// ADR-075). A daily briefing's "you have 14:00–16:30 free" line comes from
// here; nothing about it is inferred, scheduled or stored.
//
// Pure, total, no clock read (the caller passes its one `effectiveNow`), no
// database, no Node builtin; ships to the Expo bundle through
// `./focus-now/*`.
//
// ===========================================================================
// THE WINDOW IS WALL-CLOCK, IN THE CALLER'S ZONE, DST-SAFE
// ===========================================================================
//
//   window = [ max(effectiveNow, today@dayStartHour:00), today@dayEndHour:00 )
//
// "today" is the local day containing `effectiveNow` in `tz`
// (`localDayWindow`, the same primitive every Today read model buckets on),
// and both bounds are resolved from WALL-CLOCK components with
// `resolveWallClockToInstant` -- the invariant is 08:00 and 22:00 on the
// clock, never "effectiveNow + N hours", so on a 25-hour fall-back day and a
// 23-hour spring-forward day the window is still 08:00–22:00 (14h) and the
// transition hour lands where the clock says it does. `dayEndHour === 24`
// means the end of the local day (the next day's first instant). The
// defaults are overridable per call (`dayStartHour`/`dayEndHour`); since
// Checkpoint 10.7 (ADR-077 §5) the briefing passes a working-hours
// `preference` memory through them (`memoryWorkingHours`, packages/core/src/
// memory/match.ts) -- the same wall-clock rule applies to the owner's hours.
//
// ===========================================================================
// BUSY TIME IS TIMED EVENTS ONLY, CLAMPED AND MERGED
// ===========================================================================
//
//   - an all-day event does not block time (it is a date, not a span --
//     docs/ARCHITECTURE.md gotcha 2), and neither does a row missing either
//     instant or whose end is not after its start;
//   - every span is clamped to the window, so an event that started before
//     the window and is still running truncates the window's start, and one
//     that runs past the end truncates its end;
//   - overlapping and touching spans merge into one busy span;
//   - what remains are the gaps, emitted in start order when at least
//     `minMinutes` long (whole minutes, floored).
//
// An empty result means "no free block of that size", never an error; an
// `effectiveNow` at or past the window end yields [] the same way.
import { localDayWindow } from "../actionability.js";
import { resolveWallClockToInstant } from "../timezone.js";

/** The working window starts at this local hour. */
export const FREE_BLOCK_DAY_START_HOUR = 8;
/** ...and ends (exclusive) at this local hour. */
export const FREE_BLOCK_DAY_END_HOUR = 22;
/** A gap shorter than this many whole minutes is not a block. */
export const FREE_BLOCK_MIN_MINUTES = 60;

const MINUTE_MS = 60 * 1000;

/** The minimal event shape: an all-day flag and two nullable instants. */
export interface FreeBlockEventInput {
  startsAt: Date | null;
  endsAt: Date | null;
  allDay: boolean;
}

export interface FreeBlocksInput {
  events: readonly FreeBlockEventInput[];
  effectiveNow: Date;
  tz: string;
  /** Local hour (0–24) the working window opens; default `FREE_BLOCK_DAY_START_HOUR`. */
  dayStartHour?: number;
  /** Local hour (0–24, exclusive) the working window closes; default `FREE_BLOCK_DAY_END_HOUR`. */
  dayEndHour?: number;
  /** Minimum whole minutes for a gap to count; default `FREE_BLOCK_MIN_MINUTES`. */
  minMinutes?: number;
}

export interface FreeBlock {
  startUtc: Date;
  endUtc: Date;
  /** Whole minutes in the block, floored. */
  minutes: number;
}

interface Span {
  startMs: number;
  endMs: number;
}

/** `today@hour:00` in `tz`; hour 24 is the next local day's first instant. */
function localHourInstant(
  tz: string,
  today: ReturnType<typeof localDayWindow>,
  hour: number,
): Date {
  if (hour === 24) return today.endUtcExclusive;
  const [year, month, day] = today.localDate.split("-").map(Number) as [number, number, number];
  return resolveWallClockToInstant({ year, month, day, hour, minute: 0, second: 0 }, tz);
}

function isHour(hour: number): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= 24;
}

function assertHour(name: string, hour: number): void {
  if (!isHour(hour)) {
    throw new RangeError(`${name} must be an integer hour in 0..24, got ${hour}`);
  }
}

/**
 * Whether a pair of bounds is one `freeBlocks` accepts: integer hours in
 * 0..24 with the start strictly before the end. A caller holding bounds it
 * did not derive itself (the briefing, given a memory's hours) checks here
 * and falls back to the defaults rather than throwing on data.
 */
export function isValidFreeBlockWindow(dayStartHour: number, dayEndHour: number): boolean {
  return isHour(dayStartHour) && isHour(dayEndHour) && dayStartHour < dayEndHour;
}

/** Sorts spans by start and merges any that overlap or touch. */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, span.endMs);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * The free blocks left in today's working window (see the module comment),
 * sorted by start. Throws only for a programmer error in the hour bounds
 * (a non-integer, out-of-range, or inverted pair) -- never for data.
 */
export function freeBlocks(input: FreeBlocksInput): FreeBlock[] {
  const dayStartHour = input.dayStartHour ?? FREE_BLOCK_DAY_START_HOUR;
  const dayEndHour = input.dayEndHour ?? FREE_BLOCK_DAY_END_HOUR;
  const minMinutes = input.minMinutes ?? FREE_BLOCK_MIN_MINUTES;
  assertHour("dayStartHour", dayStartHour);
  assertHour("dayEndHour", dayEndHour);
  if (dayStartHour >= dayEndHour) {
    throw new RangeError(
      `dayStartHour (${dayStartHour}) must be before dayEndHour (${dayEndHour})`,
    );
  }

  const today = localDayWindow(input.tz, input.effectiveNow);
  const windowStartMs = Math.max(
    input.effectiveNow.getTime(),
    localHourInstant(input.tz, today, dayStartHour).getTime(),
  );
  const windowEndMs = localHourInstant(input.tz, today, dayEndHour).getTime();
  if (windowStartMs >= windowEndMs) return [];

  const busy: Span[] = [];
  for (const event of input.events) {
    if (event.allDay || event.startsAt === null || event.endsAt === null) continue;
    const startMs = Math.max(event.startsAt.getTime(), windowStartMs);
    const endMs = Math.min(event.endsAt.getTime(), windowEndMs);
    if (endMs <= startMs) continue;
    busy.push({ startMs, endMs });
  }

  const blocks: FreeBlock[] = [];
  const emit = (startMs: number, endMs: number): void => {
    const minutes = Math.floor((endMs - startMs) / MINUTE_MS);
    if (minutes >= minMinutes) {
      blocks.push({ startUtc: new Date(startMs), endUtc: new Date(endMs), minutes });
    }
  };

  let cursorMs = windowStartMs;
  for (const span of mergeSpans(busy)) {
    if (span.startMs > cursorMs) emit(cursorMs, span.startMs);
    cursorMs = Math.max(cursorMs, span.endMs);
  }
  if (cursorMs < windowEndMs) emit(cursorMs, windowEndMs);
  return blocks;
}
