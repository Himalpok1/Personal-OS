// Pure, synchronous Google Calendar <-> local-event translation logic. No
// DB, no HTTP -- everything here is a plain data transformation so it can be
// unit tested without any infrastructure, and so the worker-owning agent's
// job code can call it directly and stay in full control of how (and
// whether) each mutation is actually applied to the database.

import { resolveWallClockToInstant, toWallClockComponents } from "@personal-os/core/timezone";
import type { GoogleCalendarEvent, GoogleEventDateTime } from "./google-calendar-client.js";

// ---------------------------------------------------------------------------
// All-day date conversion
// ---------------------------------------------------------------------------

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(value: string): { year: number; month: number; day: number } {
  const match = DATE_ONLY.exec(value);
  if (!match) {
    throw new Error(`expected a "YYYY-MM-DD" date string, got "${value}"`);
  }
  const [, year, month, day] = match;
  return { year: Number(year), month: Number(month), day: Number(day) };
}

function formatDateOnly(year: number, month: number, day: number): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

// Pure calendar-date arithmetic -- Date.UTC is used strictly as a day-count
// calculator here (construct -> add/subtract a day -> immediately read the
// UTC getters back out), never as a real timezone-bearing instant. This is
// safe specifically because the value never crosses a timezone boundary: it
// goes in as Y/M/D integers and comes back out as Y/M/D integers.
function addCalendarDays(dateOnly: string, deltaDays: number): string {
  const { year, month, day } = parseDateOnly(dateOnly);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return formatDateOnly(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * Google's `end.date` on an all-day event is EXCLUSIVE (the day after the
 * event's real last day). This app's `end_date` is INCLUSIVE. Converts a
 * Google all-day start/end pair into this app's inclusive representation.
 */
export function googleAllDayToLocal(
  googleStartDate: string,
  googleEndDate: string,
): { startDate: string; endDate: string } {
  const endDate = addCalendarDays(googleEndDate, -1);
  // FLOOR AT THE START DATE (Checkpoint 8.6A).
  //
  // Google's `end.date` is exclusive, so a zero-length all-day event -- one
  // whose `end.date` EQUALS its `start.date`, which Google does emit and which
  // production already holds one of -- converts to an end one day BEFORE its
  // start. That is not merely an odd row: `classifyEventIntoWindows` matches an
  // all-day event with `start_date <= day <= (end_date ?? start_date)`, and when
  // end < start that range is EMPTY, so the event matches no window and is
  // INVISIBLE on Today and in every review context. It was recorded as
  // "harmless today"; it is not, and the failure is silent disappearance.
  //
  // A single-day event is the only honest reading of start == end, so clamp
  // rather than reject: refusing would drop a real event the provider accepted.
  return {
    startDate: googleStartDate,
    endDate: endDate < googleStartDate ? googleStartDate : endDate,
  };
}

/** The inverse of {@link googleAllDayToLocal}: local inclusive -> Google exclusive. */
export function localAllDayToGoogle(
  localStartDate: string,
  localEndDate: string,
): { googleStartDate: string; googleEndDate: string } {
  return {
    googleStartDate: localStartDate,
    googleEndDate: addCalendarDays(localEndDate, 1),
  };
}

// ---------------------------------------------------------------------------
// Recurrence (RRULE/EXDATE) translation
// ---------------------------------------------------------------------------

export interface GoogleRecurrenceTranslation {
  /** The RRULE string with UNTIL=/COUNT= stripped out -- this app's `rrule` column must not embed them. */
  rrule: string;
  recurrenceUntil?: Date;
  recurrenceCount?: number;
  recurrenceTimezone: string;
  /**
   * Google masters sometimes carry EXDATE lines directly inside the same
   * `recurrence` array rather than as separate API-level exception handling.
   * These are extracted here as raw instants; converting each to this app's
   * local-date exdate representation is {@link googleExdateInstantToLocalDate}'s
   * job, kept separate because it needs an explicit target timezone.
   */
  exdateInstants: Date[];
}

interface ParsedIcalDateTimeValue {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
  /** True if the value carried a trailing "Z" (an explicit UTC instant). */
  isUtc: boolean;
}

const ICAL_DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/;
const ICAL_DATETIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;

function parseIcalDateTimeValue(raw: string): ParsedIcalDateTimeValue {
  const dateOnlyMatch = ICAL_DATE_ONLY.exec(raw);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return { year: Number(year), month: Number(month), day: Number(day), isUtc: false };
  }
  const dateTimeMatch = ICAL_DATETIME.exec(raw);
  if (dateTimeMatch) {
    const [, year, month, day, hour, minute, second, zulu] = dateTimeMatch;
    return {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
      isUtc: zulu === "Z",
    };
  }
  throw new Error(`unrecognized RFC5545 date/date-time value: "${raw}"`);
}

function icalValueToInstant(value: ParsedIcalDateTimeValue, fallbackTimezone: string): Date {
  if (value.isUtc) {
    return new Date(
      Date.UTC(
        value.year,
        value.month - 1,
        value.day,
        value.hour ?? 0,
        value.minute ?? 0,
        value.second ?? 0,
      ),
    );
  }
  // Date-only (VALUE=DATE) or a floating/TZID-qualified date-time: resolve
  // as wall-clock time in the target timezone. Midnight is used for a
  // date-only value, matching how an all-day EXDATE marks a whole day.
  return resolveWallClockToInstant(
    {
      year: value.year,
      month: value.month,
      day: value.day,
      hour: value.hour ?? 0,
      minute: value.minute ?? 0,
      second: value.second ?? 0,
    },
    fallbackTimezone,
  );
}

// A single RFC5545 content line's PARAM=value pairs (e.g. `TZID=America/Chicago;VALUE=DATE`).
function parseIcalParams(paramsSegment: string): Map<string, string> {
  const params = new Map<string, string>();
  if (!paramsSegment) return params;
  for (const pair of paramsSegment.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    params.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return params;
}

/**
 * Splits one RFC5545 content line ("NAME;PARAMS:VALUES") into its name,
 * params, and raw (still comma-joined) value segment.
 */
function splitIcalLine(line: string): {
  name: string;
  params: Map<string, string>;
  rawValues: string;
} {
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(`malformed RFC5545 line, missing ":": "${line}"`);
  }
  const head = line.slice(0, colonIndex);
  const rawValues = line.slice(colonIndex + 1);
  const semiIndex = head.indexOf(";");
  const name = semiIndex === -1 ? head : head.slice(0, semiIndex);
  const params =
    semiIndex === -1 ? new Map<string, string>() : parseIcalParams(head.slice(semiIndex + 1));
  return { name, params, rawValues };
}

/**
 * Translates Google's `recurrence` array (RFC5545 lines, as returned on a
 * recurrence master event) into this app's recurrence columns. `UNTIL=`/
 * `COUNT=` are stripped out of the RRULE string into their own fields (a
 * locked requirement of the local schema); every other RRULE part is kept
 * verbatim, unvalidated against any restricted grammar -- an externally
 * imported rule that uses constructs this app's own recurrence editor UI
 * doesn't support is fine to store and expand via a full RFC5545 library.
 * Any `EXDATE:` lines mixed into the same array are extracted separately.
 */
export function googleRecurrenceToLocal(
  recurrenceLines: string[],
  dtstartTimezone: string,
): GoogleRecurrenceTranslation {
  let rruleParts: string[] | undefined;
  let recurrenceUntil: Date | undefined;
  let recurrenceCount: number | undefined;
  const exdateInstants: Date[] = [];

  for (const line of recurrenceLines) {
    const { name, params, rawValues } = splitIcalLine(line);

    if (name === "RRULE") {
      const parts = rawValues.split(";").filter((part) => part.length > 0);
      const kept: string[] = [];
      for (const part of parts) {
        const eq = part.indexOf("=");
        const key = eq === -1 ? part : part.slice(0, eq);
        const value = eq === -1 ? "" : part.slice(eq + 1);
        if (key === "UNTIL") {
          recurrenceUntil = icalValueToInstant(parseIcalDateTimeValue(value), dtstartTimezone);
          continue;
        }
        if (key === "COUNT") {
          recurrenceCount = Number(value);
          continue;
        }
        kept.push(part);
      }
      rruleParts = kept;
      continue;
    }

    if (name === "EXDATE") {
      const isDateOnly = params.get("VALUE") === "DATE";
      const tzid = params.get("TZID");
      for (const rawValue of rawValues.split(",").filter((v) => v.length > 0)) {
        const parsed = parseIcalDateTimeValue(rawValue);
        if (isDateOnly || parsed.hour === undefined) {
          // Date-only value -- resolve at local midnight in TZID (or the
          // master's own timezone if no TZID param is present).
          exdateInstants.push(icalValueToInstant(parsed, tzid ?? dtstartTimezone));
        } else if (parsed.isUtc) {
          exdateInstants.push(icalValueToInstant(parsed, dtstartTimezone));
        } else {
          exdateInstants.push(icalValueToInstant(parsed, tzid ?? dtstartTimezone));
        }
      }
      continue;
    }

    // Any other RFC5545 line type mixed into `recurrence` (e.g. RDATE) is
    // intentionally left untouched by this translation layer -- out of
    // scope for the locked Checkpoint 4.5 B2 grammar.
  }

  if (!rruleParts) {
    throw new Error("recurrenceLines did not contain an RRULE line");
  }

  return {
    rrule: `RRULE:${rruleParts.join(";")}`,
    recurrenceUntil,
    recurrenceCount,
    recurrenceTimezone: dtstartTimezone,
    exdateInstants,
  };
}

/**
 * Converts a single exdate instant to this app's `YYYY-MM-DD` local-date
 * exdate representation in the given IANA timezone.
 */
export function googleExdateInstantToLocalDate(instant: Date, timezone: string): string {
  const { year, month, day } = toWallClockComponents(instant, timezone);
  return formatDateOnly(year, month, day);
}

/**
 * Pure guard: does `candidateDate` already appear among `existingLocalDates`?
 * Trivial array-membership check, exported as a named function so the
 * DB-layer agent's same-day-collision-guard logic has a clear, tested
 * building block to call before layering its own rule-expansion-based check
 * on top (this package has no way to expand an RRULE against the DB's
 * existing occurrences, which is out of scope here).
 */
export function wouldCollideOnSameLocalDate(
  existingLocalDates: string[],
  candidateDate: string,
): boolean {
  return existingLocalDates.includes(candidateDate);
}

// ---------------------------------------------------------------------------
// Event classification
// ---------------------------------------------------------------------------

export type GoogleEventClassification =
  "master" | "detached_instance" | "cancelled_instance" | "one_off";

/**
 * Classifies a Google event per the locked grammar:
 * - `master`: has `recurrence`, no `recurringEventId`.
 * - `one_off`: has neither.
 * - `detached_instance` / `cancelled_instance`: has `recurringEventId` +
 *   `originalStartTime`, distinguished by `status === "cancelled"`.
 */
export function classifyGoogleEvent(event: GoogleCalendarEvent): GoogleEventClassification {
  const isInstance = event.recurringEventId !== undefined && event.originalStartTime !== undefined;
  if (isInstance) {
    return event.status === "cancelled" ? "cancelled_instance" : "detached_instance";
  }
  if (event.recurrence !== undefined) {
    return "master";
  }
  return "one_off";
}

// ---------------------------------------------------------------------------
// Local mutation intent
// ---------------------------------------------------------------------------

/** Fields describing the local event row to upsert, independent of which LocalMutationIntent variant carries them. */
export interface LocalEventFields {
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  /** Set when `allDay` is false. */
  startsAt?: Date;
  /** Set when `allDay` is false. */
  endsAt?: Date;
  /** Set when `allDay` is false -- the IANA zone the timed instants were resolved from. */
  timezone?: string;
  /** Set when `allDay` is true -- inclusive, per this app's convention. */
  startDate?: string;
  /** Set when `allDay` is true -- inclusive, per this app's convention. */
  endDate?: string;
  /** Present only when this event is a recurrence master. */
  rrule?: string;
  recurrenceUntil?: Date;
  recurrenceCount?: number;
  recurrenceTimezone?: string;
  /** `YYYY-MM-DD` local dates, present only alongside `rrule`. */
  recurrenceExdates?: string[];
  googleEventId: string;
  googleEtag: string;
  googleUpdated: Date;
  googleICalUid: string;
}

/**
 * Describes the local database mutation a Google event implies, without
 * performing it -- the worker-owning agent's job code consumes this
 * discriminated union to actually touch `events`/`occurrences`.
 */
export type LocalMutationIntent =
  | { kind: "upsert_standalone_or_master"; sourceGoogleEventId: string; fields: LocalEventFields }
  | {
      kind: "detach_instance";
      sourceGoogleEventId: string;
      parentGoogleEventId: string;
      originalStartInstant: Date;
      fields: LocalEventFields;
    }
  | { kind: "cancel_instance"; parentGoogleEventId: string; originalStartInstant: Date };

/** Context a caller supplies for translation decisions this package can't infer from the Google event alone. */
export interface CalendarSyncConnectionContext {
  /** Fallback IANA timezone for a timed event whose `start.timeZone` Google omitted. */
  defaultTimezone: string;
}

function googleEventDateTimeToInstant(dt: GoogleEventDateTime): Date {
  if (dt.dateTime) {
    const instant = new Date(dt.dateTime);
    if (Number.isNaN(instant.getTime())) {
      throw new Error(`invalid dateTime "${dt.dateTime}"`);
    }
    return instant;
  }
  if (dt.date) {
    const { year, month, day } = parseDateOnly(dt.date);
    return new Date(Date.UTC(year, month - 1, day));
  }
  throw new Error("GoogleEventDateTime has neither dateTime nor date");
}

function translateFields(
  event: GoogleCalendarEvent,
  ctx: CalendarSyncConnectionContext,
): LocalEventFields {
  const base: Omit<LocalEventFields, "allDay"> = {
    title: event.summary ?? "",
    description: event.description ?? null,
    location: event.location ?? null,
    googleEventId: event.id,
    googleEtag: event.etag,
    googleUpdated: new Date(event.updated),
    googleICalUid: event.iCalUID,
  };

  const isAllDay = event.start?.date !== undefined;

  if (isAllDay) {
    if (!event.start?.date || !event.end?.date) {
      throw new Error(`all-day event "${event.id}" is missing start.date/end.date`);
    }
    const { startDate, endDate } = googleAllDayToLocal(event.start.date, event.end.date);
    return { ...base, allDay: true, startDate, endDate };
  }

  if (!event.start?.dateTime || !event.end?.dateTime) {
    throw new Error(`timed event "${event.id}" is missing start.dateTime/end.dateTime`);
  }
  const timezone = event.start.timeZone ?? ctx.defaultTimezone;
  return {
    ...base,
    allDay: false,
    startsAt: googleEventDateTimeToInstant(event.start),
    endsAt: googleEventDateTimeToInstant(event.end),
    timezone,
  };
}

/**
 * Translates one Google event (already classified via
 * {@link classifyGoogleEvent}) into the local mutation it implies.
 */
export function mapGoogleEventToLocalUpsert(
  event: GoogleCalendarEvent,
  classification: GoogleEventClassification,
  connectionContext: CalendarSyncConnectionContext,
): LocalMutationIntent {
  if (classification === "cancelled_instance") {
    if (!event.recurringEventId || !event.originalStartTime) {
      throw new Error(
        `cancelled_instance event "${event.id}" is missing recurringEventId/originalStartTime`,
      );
    }
    return {
      kind: "cancel_instance",
      parentGoogleEventId: event.recurringEventId,
      originalStartInstant: googleEventDateTimeToInstant(event.originalStartTime),
    };
  }

  const fields = translateFields(event, connectionContext);

  if (classification === "detached_instance") {
    if (!event.recurringEventId || !event.originalStartTime) {
      throw new Error(
        `detached_instance event "${event.id}" is missing recurringEventId/originalStartTime`,
      );
    }
    return {
      kind: "detach_instance",
      sourceGoogleEventId: event.id,
      parentGoogleEventId: event.recurringEventId,
      originalStartInstant: googleEventDateTimeToInstant(event.originalStartTime),
      fields,
    };
  }

  if (classification === "master") {
    if (!event.recurrence) {
      throw new Error(`master event "${event.id}" is missing recurrence`);
    }
    const timezone = fields.timezone ?? connectionContext.defaultTimezone;
    const translation = googleRecurrenceToLocal(event.recurrence, timezone);
    const recurrenceExdates = translation.exdateInstants.map((instant) =>
      googleExdateInstantToLocalDate(instant, timezone),
    );
    return {
      kind: "upsert_standalone_or_master",
      sourceGoogleEventId: event.id,
      fields: {
        ...fields,
        rrule: translation.rrule,
        recurrenceUntil: translation.recurrenceUntil,
        recurrenceCount: translation.recurrenceCount,
        recurrenceTimezone: translation.recurrenceTimezone,
        recurrenceExdates,
      },
    };
  }

  // one_off
  return { kind: "upsert_standalone_or_master", sourceGoogleEventId: event.id, fields };
}
