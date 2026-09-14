import { ApiClientError } from "@personal-os/api-client";
import type {
  CalendarTarget,
  EventCalendarTarget,
  EventCreate,
  EventSyncState,
} from "@personal-os/schema";
import {
  resolveInstantToLocalUntil,
  type SerializedRecurrenceRule,
} from "@personal-os/core/recurrence/editor";
import { formatInstantWithOffset } from "@personal-os/core/timezone";
import { isLocalDate } from "@/components/date-field-state";
import { formatFieldLabel } from "@/components/datetime-field-state";
import { addLocalDays, formatShortDate, parseLocalDate } from "@/utils/local-date";
import { describeValidationError } from "@/utils/validation-error";

/**
 * Pure logic behind the event screens (Checkpoint 9.5) -- the start/end
 * coupling, the create body, the calendar/sync copy and the error
 * classification -- split from the JSX on the components/*-state.ts
 * convention so it is unit-testable without a render harness. Nothing here
 * interprets content: every string an owner or a calendar authored passes
 * through untouched into a `<Text>`, and no route or URL is ever derived
 * from one.
 */

export const ONE_HOUR_MS = 60 * 60 * 1000;

export interface TimedRange {
  /** ISO instant with offset (as DateTimeField emits), or null. */
  startsAt: string | null;
  endsAt: string | null;
}

export interface AllDayRange {
  /** Bare `YYYY-MM-DD`, or null. */
  startDate: string | null;
  endDate: string | null;
}

function parseInstant(value: string | null): Date | null {
  if (!value) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** The end a timed event gets when only its start is known: start + 1 h. */
export function defaultEndFor(startsAt: string, timezone: string): string | null {
  const start = parseInstant(startsAt);
  if (!start) return null;
  return formatInstantWithOffset(new Date(start.getTime() + ONE_HOUR_MS), timezone);
}

/**
 * Moving the start keeps the DURATION: an owner dragging a 14:00–15:30
 * meeting to 16:00 means 16:00–17:30, never 16:00–15:30. With no usable end
 * yet, the end becomes start + 1 h. Clearing the start clears the end too --
 * a timed event's end alone means nothing.
 */
export function applyStartsAtChange(
  range: TimedRange,
  nextStartsAt: string | null,
  timezone: string,
): TimedRange {
  if (!nextStartsAt) return { startsAt: null, endsAt: null };
  const next = parseInstant(nextStartsAt);
  if (!next) return { startsAt: nextStartsAt, endsAt: range.endsAt };
  const previousStart = parseInstant(range.startsAt);
  const previousEnd = parseInstant(range.endsAt);
  const duration =
    previousStart && previousEnd && previousEnd.getTime() > previousStart.getTime()
      ? previousEnd.getTime() - previousStart.getTime()
      : ONE_HOUR_MS;
  return {
    startsAt: nextStartsAt,
    endsAt: formatInstantWithOffset(new Date(next.getTime() + duration), timezone),
  };
}

/** Moving the all-day start never leaves the end before it. */
export function applyStartDateChange(
  range: AllDayRange,
  nextStartDate: string | null,
): AllDayRange {
  if (!nextStartDate) return { startDate: null, endDate: range.endDate };
  const endDate = range.endDate && range.endDate >= nextStartDate ? range.endDate : nextStartDate;
  return { startDate: nextStartDate, endDate };
}

/**
 * Client-side refusals, as tokens the screen turns into copy. Mirrors the
 * server's own checks (`ends_at > starts_at`, `end_date >= start_date`) so
 * a refusal is shown before a request rather than as a generic failure.
 */
export type EventRangeError =
  | "start_required"
  | "end_required"
  | "end_before_start"
  | "start_date_required"
  | "end_date_before_start";

export function timedRangeError(range: TimedRange): EventRangeError | null {
  const start = parseInstant(range.startsAt);
  const end = parseInstant(range.endsAt);
  if (!start) return "start_required";
  if (!end) return "end_required";
  if (end.getTime() <= start.getTime()) return "end_before_start";
  return null;
}

export function allDayRangeError(range: AllDayRange): EventRangeError | null {
  if (!isLocalDate(range.startDate)) return "start_date_required";
  if (range.endDate && (!isLocalDate(range.endDate) || range.endDate < range.startDate)) {
    return "end_date_before_start";
  }
  return null;
}

export const RANGE_ERROR_COPY: Record<EventRangeError, string> = {
  start_required: "Pick a start time.",
  end_required: "Pick an end time.",
  end_before_start: "The end must be after the start.",
  start_date_required: "Pick a start date.",
  end_date_before_start: "The end date can't be before the start date.",
};

export interface EventFormValues {
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  timed: TimedRange;
  allDayRange: AllDayRange;
  projectId: string | undefined;
  calendar: CalendarTarget | null;
}

/** The POST /events `calendar` selector for a picked target. */
export function toCalendarBody(target: CalendarTarget): EventCalendarTarget {
  return target.google_calendar_id
    ? { connection_id: target.connection_id, google_calendar_id: target.google_calendar_id }
    : {
        connection_id: target.connection_id,
        caldav_calendar_url: target.caldav_calendar_url ?? "",
      };
}

/**
 * The create body. `clientUuid` is generated ONCE per composer mount by the
 * screen and passed in on every attempt, so a retry after an ambiguous
 * response returns the same row (POST /events dedupes on it) rather than a
 * second event -- the capture composer's rule, applied here.
 */
export function buildEventCreateBody(
  form: EventFormValues,
  opts: { clientUuid: string; timezone: string; recurrence: SerializedRecurrenceRule | null },
): EventCreate {
  const recurrenceFields: Partial<EventCreate> = opts.recurrence?.rrule
    ? {
        rrule: opts.recurrence.rrule,
        recurrence_timezone: opts.recurrence.recurrence_timezone ?? opts.timezone,
        recurrence_until: opts.recurrence.recurrence_until
          ? opts.recurrence.recurrence_until.toISOString()
          : undefined,
        recurrence_count: opts.recurrence.recurrence_count ?? undefined,
      }
    : {};
  return {
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    location: form.location.trim() || undefined,
    timezone: opts.timezone,
    project_id: form.projectId,
    all_day: form.allDay,
    client_uuid: opts.clientUuid,
    ...(form.allDay
      ? {
          start_date: form.allDayRange.startDate ?? undefined,
          end_date: form.allDayRange.endDate ?? form.allDayRange.startDate ?? undefined,
        }
      : {
          starts_at: form.timed.startsAt ?? undefined,
          ends_at: form.timed.endsAt ?? undefined,
        }),
    ...recurrenceFields,
    ...(form.calendar ? { calendar: toCalendarBody(form.calendar) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Calendar and sync copy
// ---------------------------------------------------------------------------

/** The target a linked event's `sync` points at, if it is in the writable list. */
export function findCalendarTarget(
  targets: readonly CalendarTarget[],
  sync: EventSyncState | null,
): CalendarTarget | null {
  if (!sync) return null;
  return (
    targets.find(
      (target) =>
        target.connection_id === sync.connection_id &&
        (sync.google_calendar_id
          ? target.google_calendar_id === sync.google_calendar_id
          : sync.caldav_calendar_url
            ? target.caldav_calendar_url === sync.caldav_calendar_url
            : false),
    ) ?? null
  );
}

/** "Synced to <summary>" / "Not synced to a calendar", for a LOCAL event. */
export function calendarLabel(
  sync: EventSyncState | null,
  targets: readonly CalendarTarget[],
): string {
  if (!sync) return "Not synced to a calendar";
  const target = findCalendarTarget(targets, sync);
  return target ? `Synced to ${target.summary}` : "Synced to a connected calendar";
}

/** "From <summary> · read-only", for an EXTERNAL event. */
export function externalCalendarLabel(
  sync: EventSyncState | null,
  targets: readonly CalendarTarget[],
): string {
  const target = findCalendarTarget(targets, sync);
  return target ? `From ${target.summary} · read-only` : "From connected calendar · read-only";
}

export const EVENT_NOT_OWNED_MESSAGE =
  "This event belongs to a connected calendar and can't be changed here.";

// last_error is a closed enum (packages/schema/src/calendar-sync-errors.ts);
// each member is turned into a whole line here, never echoed. Unlisted
// members -- including any a later checkpoint adds -- fall back to the
// generic line, which promises NOTHING: the push job retries transient
// failures on its own schedule, but the client cannot know whether a given
// code is still being retried, so no line says "will retry".
const SYNC_ERROR_LINES: Readonly<Record<string, string>> = {
  auth_expired: "Calendar sync failed: reconnect the calendar",
  auth_failed: "Calendar sync failed: reconnect the calendar",
  missing_scope: "Calendar sync failed: calendar not writable",
  calendar_not_writable: "Calendar sync failed: calendar not writable",
  not_found: "Calendar event no longer exists",
  invalid_request: "Calendar rejected this event — edit it to retry",
  connection_inactive: "Calendar disconnected — reconnect it in Settings",
  retries_exhausted: "Calendar sync failed — edit it to retry",
};

export const SYNC_ERROR_FALLBACK_LINE = "Calendar sync failed";

/**
 * A conflict parks the link: inbound sync applies NOTHING remote and the
 * owner's latest edit has not been pushed either, so the line tells them
 * what to do (a save re-marks the link pending_push) rather than claiming a
 * winner.
 */
export const SYNC_CONFLICT_LINE =
  "Calendar conflict — your latest edit hasn't been synced. Save it again to retry.";

/** One line under the calendar label, or null when there is nothing to say. */
export function syncStatusLine(sync: EventSyncState | null): string | null {
  if (!sync) return null;
  switch (sync.status) {
    case "synced":
      return null;
    case "pending_push":
      return "Syncing to calendar…";
    case "conflict":
      return SYNC_CONFLICT_LINE;
    case "error":
      return (
        (sync.last_error ? SYNC_ERROR_LINES[sync.last_error] : undefined) ??
        SYNC_ERROR_FALLBACK_LINE
      );
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type EventMutationFailure =
  "not_owned" | "linked_detach" | "validation" | "not_found" | "unknown";

/**
 * POST /events/:id/detach refuses a LOCAL series that is linked to a
 * calendar: the detached child could not be pushed, so a single occurrence
 * of a synced series cannot be edited yet (only cancelled, or the whole
 * series edited). The modal hides the option; this covers a stale screen.
 */
export const LINKED_SERIES_DETACH_MESSAGE =
  "Single occurrences of a synced series can't be edited yet — edit the whole series or cancel this occurrence.";

/** Which inline line a failed save/delete/link/detach/cancel gets. */
export function classifyEventMutationError(error: unknown): EventMutationFailure {
  if (!(error instanceof ApiClientError))
    return describeValidationError(error) ? "validation" : "unknown";
  if (error.status === 409 && error.code === "event_not_owned") return "not_owned";
  if (error.status === 409 && error.code === "linked_series_detach_unsupported") {
    return "linked_detach";
  }
  if (error.status === 404) return "not_found";
  if (error.code === "validation_failed") return "validation";
  return "unknown";
}

/**
 * The class plus, for a `validation` failure, the field-level line
 * (Checkpoint 9.6): "title must be at most 512 characters" from a server 400
 * or from the api-client's own pre-request parse -- which throws a raw
 * ZodError, so it is classified `validation` here even though it is not an
 * ApiClientError. Null when the failure carries no field to name, in which
 * case the copy falls back to the dates-or-repeat-rule line below.
 */
export interface EventMutationErrorInfo {
  failure: EventMutationFailure;
  validation_message: string | null;
}

export function describeEventMutationError(error: unknown): EventMutationErrorInfo {
  const failure = classifyEventMutationError(error);
  return {
    failure,
    validation_message: failure === "validation" ? describeValidationError(error) : null,
  };
}

export function eventMutationErrorCopy(
  failure: EventMutationFailure,
  verb: string,
  validationMessage: string | null = null,
): string {
  switch (failure) {
    case "not_owned":
      return EVENT_NOT_OWNED_MESSAGE;
    case "linked_detach":
      return LINKED_SERIES_DETACH_MESSAGE;
    case "not_found":
      return "This event no longer exists.";
    case "validation":
      // A bound refusal names the field; a bare "<field> isn't valid" for a
      // date or recurrence field is less useful than the line that says which
      // KIND of thing to fix, so only a too-long line replaces it.
      return validationMessage !== null && validationMessage.includes("must be at most")
        ? `Couldn't ${verb}: ${validationMessage}.`
        : `Couldn't ${verb}: something about the dates or repeat rule isn't valid.`;
    case "unknown":
      return `Couldn't ${verb}. Please try again.`;
  }
}

/** The whole line for a failed mutation -- classification, field line and verb in one call. */
export function eventMutationErrorLine(error: unknown, verb: string): string {
  const info = describeEventMutationError(error);
  return eventMutationErrorCopy(info.failure, verb, info.validation_message);
}

// ---------------------------------------------------------------------------
// client_uuid idempotency across a failed attempt
// ---------------------------------------------------------------------------

/**
 * POST /events dedupes on `client_uuid` and returns the ORIGINAL row (200)
 * on a repeat. That is exactly right for a retry of the same intent -- a
 * timeout whose request actually committed -- and exactly wrong once the
 * owner has edited the form after the failure: the server would hand back
 * the row as first submitted and `router.back()` would drop the edits.
 *
 * So the uuid is minted once per composer session and survives an
 * unchanged retry, and is REPLACED on the first field change that follows
 * a failed attempt (a new intent). Editing before any attempt keeps it:
 * nothing has been sent, so there is nothing to be idempotent against.
 */
export interface ClientUuidState {
  clientUuid: string;
  /** True from a failed attempt until the next field change. */
  attemptFailed: boolean;
}

export function initialClientUuidState(mint: () => string): ClientUuidState {
  return { clientUuid: mint(), attemptFailed: false };
}

/** The create request with the current uuid failed as far as the client saw. */
export function markAttemptFailed(state: ClientUuidState): ClientUuidState {
  return state.attemptFailed ? state : { ...state, attemptFailed: true };
}

/** Any field changed; a new uuid only if the current one has been sent and failed. */
export function nextClientUuidAfterEdit(
  state: ClientUuidState,
  mint: () => string,
): ClientUuidState {
  if (!state.attemptFailed) return state;
  return { clientUuid: mint(), attemptFailed: false };
}

// ---------------------------------------------------------------------------
// Read-only "when" line
// ---------------------------------------------------------------------------

export interface EventWhenInput {
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone?: string;
  recurrence_timezone?: string | null;
}

/**
 * The calendar dates of ONE all-day instance of a recurring series. `GET
 * /events/:id` returns the series TEMPLATE's `start_date`/`end_date` (the
 * first instance, years back for a birthday); the instance a Today/Agenda
 * card opened is identified by `occursAt`, the ADR-042 local-noon anchor in
 * the recurrence zone, so its date is that instant's LOCAL date -- never the
 * UTC slice -- and the template's day-span is carried over unchanged.
 */
function allDayInstanceDates(
  event: EventWhenInput,
  occursAt: string,
): { startDate: string; endDate: string } | null {
  const tz = event.recurrence_timezone ?? event.timezone;
  if (!tz) return null;
  const instant = new Date(occursAt);
  if (Number.isNaN(instant.getTime())) return null;
  const startDate = resolveInstantToLocalUntil(instant, tz);
  if (!isLocalDate(startDate)) return null;
  let spanDays = 0;
  if (isLocalDate(event.start_date) && isLocalDate(event.end_date)) {
    const a = parseLocalDate(event.start_date);
    const b = parseLocalDate(event.end_date);
    if (a && b) spanDays = Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
  }
  return { startDate, endDate: spanDays === 0 ? startDate : addLocalDays(startDate, spanDays) };
}

/**
 * The date/time line on the read-only view. all_day is decided FIRST and
 * formats calendar dates only (utils/event-time-label.ts's rule); a timed
 * event shows its local start and end. `occursAt` positions a recurring
 * timed instance (its `starts_at` is the series template, ADR-042).
 */
export function eventWhenLabel(event: EventWhenInput, occursAt?: string | null): string {
  if (event.all_day) {
    const instance = occursAt ? allDayInstanceDates(event, occursAt) : null;
    const startDate = instance?.startDate ?? event.start_date;
    const endDate = instance?.endDate ?? event.end_date;
    if (!isLocalDate(startDate)) return "All day";
    const start = formatShortDate(startDate);
    if (isLocalDate(endDate) && endDate !== startDate) {
      return `${start} – ${formatShortDate(endDate)} · all day`;
    }
    return `${start} · all day`;
  }
  const startIso = occursAt ?? event.starts_at;
  const start = formatFieldLabel(startIso);
  if (!start) return "Time not set";
  const startInstant = parseInstant(startIso);
  const templateStart = parseInstant(event.starts_at);
  const templateEnd = parseInstant(event.ends_at);
  const durationMs =
    templateStart && templateEnd && templateEnd.getTime() > templateStart.getTime()
      ? templateEnd.getTime() - templateStart.getTime()
      : null;
  if (!startInstant || durationMs === null) return start;
  const end = new Date(startInstant.getTime() + durationMs);
  return `${start} – ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
