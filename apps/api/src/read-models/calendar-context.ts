// Checkpoint 10.9 (ADR-081) -- the `get_calendar_context` read tool's range
// collector.
//
// One inclusive LOCAL-date window `[from, to]` in the caller's `tz`, resolved
// to instants through the same `localDayWindowForDate` the Today read model
// uses, then handed to the extracted three-source assembly
// (`assembleEventRange`) so a recurring instance's instant, an all-day
// instance's dates and a skipped occurrence's absence are computed by
// exactly the code GET /events/range and /today already run -- never a
// second recurrence implementation.
//
// Two things this collector adds on top of the assembly, both mirroring
// read-models/today.ts rather than widening the frozen `EventRangeItemSchema`:
//
//   * `origin` (ADR-064) is NOT carried by the range item shape, so it is
//     sourced by one extra id-scoped SELECT against `events` -- the identical
//     meta query today.ts runs for project/rrule/origin. A recurring
//     instance shares its series row's id and so inherits the series'
//     origin; a detached child carries its own. A row whose meta is missing
//     reads as `external`, the safe (read-only) direction.
//   * The all-day date test is re-applied against the LOCAL date strings.
//     The assembly bounds its all-day SQL by the UTC calendar date of the
//     instants it is given (its documented simplification), and a local
//     midnight east of UTC falls on the previous UTC date -- so an all-day
//     event the day before `from` could otherwise be admitted for an
//     Auckland caller. Timed rows need no such pass: their overlap test is
//     already exact in instants.
//
// `description` is deliberately absent from `CalendarRangeRow`: the
// assembly returns it, this file drops it in the projection, and the
// intelligence builder therefore never even sees the field (an external
// calendar's description is attacker-authored text in the ADR-054 sense).
// This file reaches neither the tasks nor the notes table (Guard 2). Read-only.
import { localDayWindowForDate } from "@personal-os/core";
import { events, type Db } from "@personal-os/db";
import type { EventOrigin, EventRangeItem } from "@personal-os/schema";
import { inArray } from "drizzle-orm";
import { assembleEventRange } from "./event-range.js";

export interface CalendarRangeInput {
  tz: string;
  /** Inclusive local calendar dates, `YYYY-MM-DD`, `from <= to`. */
  from: string;
  to: string;
}

export interface CalendarRangeRow {
  id: string;
  title: string;
  location: string | null;
  all_day: boolean;
  /** Timed events: the SERIES template instants for a recurring instance -- read `occurs_at`. */
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  is_recurring_instance: boolean;
  /** A recurring instance's own instant (and end), computed by the assembly. */
  occurs_at: string | null;
  occurs_ends_at: string | null;
  parent_event_id: string | null;
  origin: EventOrigin;
  status: EventRangeItem["status"];
}

export interface CalendarRangeCollection {
  /** Every row in the window, in the assembly's own order (all-day first per day, then by instant). */
  rows: CalendarRangeRow[];
  /** The instant bounds the local window resolved to, for callers that log or test them. */
  window: { startUtc: Date; endUtcExclusive: Date };
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isWithinLocalDates(item: EventRangeItem, from: string, to: string): boolean {
  if (!item.all_day) return true;
  const start = item.start_date;
  if (start === null) return true; // defensive: the assembly never emits an all-day row without one
  const end = item.end_date ?? start;
  return start <= to && end >= from;
}

/**
 * Collects every unarchived event instance overlapping the inclusive local
 * window `[from, to]` in `tz`, each carrying its `origin`. `options.now` is
 * accepted for signature parity with the other read models (one
 * `effectiveNow` per request); the window itself is fixed by the dates, so
 * nothing here is categorised against the clock.
 *
 * Throws a plain `RangeError` when the assembly reports its recurrence
 * expansion budget exhausted -- the same "fail loudly, never a silently
 * incomplete calendar" rule GET /events/range and /today apply.
 */
export async function collectCalendarRange(
  db: Db,
  input: CalendarRangeInput,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature parity with the other read models (one effectiveNow per request)
  options?: { now?: Date },
): Promise<CalendarRangeCollection> {
  if (!LOCAL_DATE.test(input.from) || !LOCAL_DATE.test(input.to)) {
    throw new RangeError("calendar range dates must be YYYY-MM-DD");
  }
  if (input.from > input.to) {
    throw new RangeError("calendar range `from` must not be after `to`");
  }

  const startUtc = localDayWindowForDate(input.tz, input.from).startUtc;
  const endUtcExclusive = localDayWindowForDate(input.tz, input.to).endUtcExclusive;

  const assembled = await assembleEventRange(db, {
    from: startUtc,
    to: endUtcExclusive,
    includeArchived: false,
  });
  if (!assembled.ok) {
    throw new RangeError(
      `event recurrence expansion limit (${assembled.limit}) exceeded while collecting the calendar range`,
    );
  }

  const inWindow = assembled.items.filter((item) => isWithinLocalDates(item, input.from, input.to));

  // Ownership, from the same id-scoped meta query today.ts runs. Absent ->
  // external: an agent may never be told a row is editable on a guess.
  const originById = new Map<string, EventOrigin>();
  const candidateIds = [...new Set(inWindow.map((item) => item.id))];
  if (candidateIds.length > 0) {
    const metaRows = await db
      .select({ id: events.id, origin: events.origin })
      .from(events)
      .where(inArray(events.id, candidateIds));
    for (const row of metaRows) {
      // CHECKed to local|external by the events_origin constraint (0019).
      originById.set(row.id, row.origin === "local" ? "local" : "external");
    }
  }

  const rows: CalendarRangeRow[] = inWindow.map((item) => ({
    id: item.id,
    title: item.title,
    location: item.location,
    all_day: item.all_day,
    starts_at: item.starts_at,
    ends_at: item.ends_at,
    start_date: item.start_date,
    end_date: item.end_date,
    is_recurring_instance: item.is_recurring_instance,
    occurs_at: item.occurs_at,
    occurs_ends_at: item.occurs_ends_at,
    parent_event_id: item.parent_event_id ?? null,
    origin: originById.get(item.id) ?? "external",
    status: item.status,
  }));

  return { rows, window: { startUtc, endUtcExclusive } };
}
