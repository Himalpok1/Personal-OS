import {
  expandRecurrenceInRange,
  toWallClockComponents,
  RecurrenceExpansionLimitError,
  type DueDateRecurrenceRule,
} from "@personal-os/core";
import { events, occurrences, type Db } from "@personal-os/db";
import { EventRangeItemSchema, type EventRangeItem } from "@personal-os/schema";
import { and, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

const MAX_EXPANDED_OCCURRENCES_PER_REQUEST = 10_000;

// UTC calendar date of a real instant, as a plain YYYY-MM-DD string --
// the documented, deliberate simplification for deriving date-only bounds
// from from/to when they don't land exactly on a day boundary. Never
// converts an all-day event's own start_date/end_date through this (or any)
// instant -- only used to bound the *query*.
function toUtcCalendarDate(instant: Date): string {
  const iso = instant.toISOString();
  return iso.slice(0, 10);
}

// Recomputed fresh from the real anchor instant + zone on every call rather
// than trusting a possibly-stale start_local column, same reasoning as
// apps/worker's expand-due-date-window.ts buildRule -- kept as a local copy
// rather than shared, since it's a five-line adapter from a `events`
// row to the recurrence package's input shape, not new domain logic.
function buildRecurrenceRule(row: typeof events.$inferSelect): DueDateRecurrenceRule | null {
  if (!row.rrule || !row.recurrenceTimezone || !row.startsAt) return null;
  return {
    rrule: row.rrule,
    recurrenceTimezone: row.recurrenceTimezone,
    dtstart: toWallClockComponents(row.startsAt, row.recurrenceTimezone),
    recurrenceUntil: row.recurrenceUntil ?? undefined,
    recurrenceCount: row.recurrenceCount ?? undefined,
    recurrenceExdates: row.recurrenceExdates ?? undefined,
  };
}

export interface AssembleEventRangeParams {
  from: Date;
  to: Date;
  includeArchived: boolean;
}

export type EventRangeAssembly =
  | { readonly ok: true; readonly items: EventRangeItem[] }
  | {
      readonly ok: false;
      readonly eventId: string;
      readonly limit: number;
    };

// The three-source event range assembly, extracted verbatim from GET
// /events/range so aggregate read models (/today) reuse -- not reimplement --
// the exact recurrence/expansion semantics. Behavior is identical to the
// route's original inline body; the resource-limit failure is returned as a
// discriminated result instead of a Fastify reply so non-HTTP callers can
// decide how to surface it.
//
// Three sources, merged and sorted by effective start ascending:
//
//  1. Non-recurring timed events (rrule is null, starts_at is set).
//     Half-open overlap: starts_at < to AND effective_ends_at > from, so
//     an event ending exactly at `from` or starting exactly at `to` is
//     excluded. This also transparently covers detached/overridden single
//     instances of a recurring series (parent_event_id set) -- those are
//     just ordinary `events` rows with no special-casing needed here.
//
//  2. Non-recurring all-day events (rrule is null, start_date is set).
//     Compared as calendar dates, never through a UTC instant -- doing the
//     latter would shift an all-day event by a day for a non-UTC client.
//     Known simplification, deliberately not resolved beyond this: when
//     `from`/`to` don't land on a day boundary, the bounding dates are
//     derived as the *UTC* calendar date of the instant (see
//     toUtcCalendarDate above), not any per-request timezone.
//
//  3. Recurring events (rrule is not null). Pre-filtered in SQL
//     (dtstart <= to, recurrence_until unset or >= from) to avoid
//     expanding rules that plainly can't overlap, then expanded in
//     application code via expandRecurrenceInRange -- which has no
//     now-floor, unlike expandDueDateWindow. Callers bound the requested
//     span (the HTTP contract limits it to 366 days), and expansion
//     additionally stops at 10,000 candidates cumulatively across the
//     request. Exceeding that resource bound fails the whole request
//     explicitly rather than returning a silently incomplete calendar.
//     `from` is padded backward by the event's own duration before
//     expansion so an occurrence that starts before `from` but ends
//     inside [from, to) isn't missed; the real overlap test is then
//     re-applied per occurrence in real-instant terms, since
//     expandRecurrenceInRange's own bound is inclusive at `to` (which
//     would otherwise admit an occurrence starting exactly at `to`).
//     Each computed occurrence is matched against any real `occurrences`
//     row for that (parent, occurs_at) pair: a `skipped` row excludes the
//     occurrence entirely; any other row's real status is carried through;
//     no row at all reports the implicit default, "scheduled" -- exactly
//     what a pre-generated row would default to, without ever writing one.
//     The match is done as a single application-level merge against one
//     extra `occurrences` SELECT scoped to the candidate parent ids,
//     rather than a literal SQL JOIN against an ad hoc set of computed
//     dates -- same semantics (and still a single extra read-only query),
//     avoids an unnest/VALUES-join for a personal, single-user dataset.
export async function assembleEventRange(
  db: Db,
  params: AssembleEventRangeParams,
): Promise<EventRangeAssembly> {
  const { from, to } = params;
  const archivedFilter = params.includeArchived ? undefined : isNull(events.archivedAt);

  const timedRows = await db
    .select()
    .from(events)
    .where(
      and(
        isNull(events.rrule),
        isNotNull(events.startsAt),
        archivedFilter,
        // An event with starts_at but no ends_at is treated as a
        // zero-duration point event (effective end = start) via coalesce,
        // rather than being silently excluded from every range query.
        sql`${events.startsAt} < ${to} and coalesce(${events.endsAt}, ${events.startsAt}) > ${from}`,
      ),
    );

  const fromDate = toUtcCalendarDate(from);
  const toDate = toUtcCalendarDate(to);
  const allDayRows = await db
    .select()
    .from(events)
    .where(
      and(
        isNull(events.rrule),
        isNotNull(events.startDate),
        archivedFilter,
        sql`${events.startDate} <= ${toDate} and coalesce(${events.endDate}, ${events.startDate}) >= ${fromDate}`,
      ),
    );

  const recurringRows = await db
    .select()
    .from(events)
    .where(
      and(
        isNotNull(events.rrule),
        archivedFilter,
        lte(events.startsAt, to),
        or(isNull(events.recurrenceUntil), gte(events.recurrenceUntil, from)),
      ),
    );

  const recurringEventIds = recurringRows.map((row) => row.id);
  const realOccurrenceRows = recurringEventIds.length
    ? await db
        .select()
        .from(occurrences)
        .where(
          and(
            eq(occurrences.parentType, "event"),
            inArray(occurrences.parentId, recurringEventIds),
          ),
        )
    : [];
  const realOccurrenceByKey = new Map(
    realOccurrenceRows.map((row) => [`${row.parentId}|${row.occursAt.getTime()}`, row]),
  );

  function sortKey(item: EventRangeItem): number {
    if (item.is_recurring_instance && item.occurs_at) return Date.parse(item.occurs_at);
    if (item.starts_at) return Date.parse(item.starts_at);
    if (item.start_date) return Date.parse(`${item.start_date}T00:00:00.000Z`);
    return 0;
  }

  const items: EventRangeItem[] = [];
  const expansionBudget = {
    limit: MAX_EXPANDED_OCCURRENCES_PER_REQUEST,
    remaining: MAX_EXPANDED_OCCURRENCES_PER_REQUEST,
  };

  for (const row of timedRows) {
    items.push({
      id: row.id,
      title: row.title,
      description: row.description,
      location: row.location,
      all_day: false,
      starts_at: row.startsAt ? row.startsAt.toISOString() : null,
      ends_at: row.endsAt ? row.endsAt.toISOString() : null,
      start_date: null,
      end_date: null,
      is_recurring_instance: false,
      occurs_at: null,
      occurs_ends_at: null,
      parent_event_id: row.parentEventId ?? null,
      original_start_at: row.originalStartAt ? row.originalStartAt.toISOString() : null,
      status: null,
    });
  }

  for (const row of allDayRows) {
    items.push({
      id: row.id,
      title: row.title,
      description: row.description,
      location: row.location,
      all_day: true,
      starts_at: null,
      ends_at: null,
      start_date: row.startDate,
      end_date: row.endDate,
      is_recurring_instance: false,
      occurs_at: null,
      occurs_ends_at: null,
      parent_event_id: row.parentEventId ?? null,
      original_start_at: row.originalStartAt ? row.originalStartAt.toISOString() : null,
      status: null,
    });
  }

  for (const row of recurringRows) {
    const rule = buildRecurrenceRule(row);
    if (!rule) continue; // defensive -- mirrors expand-due-date-window's own guard

    const durationMs =
      row.startsAt && row.endsAt ? row.endsAt.getTime() - row.startsAt.getTime() : 0;
    const paddedFrom = new Date(from.getTime() - durationMs);

    let expanded;
    try {
      expanded = expandRecurrenceInRange(rule, paddedFrom, to, expansionBudget);
    } catch (error) {
      if (error instanceof RecurrenceExpansionLimitError) {
        return { ok: false, eventId: row.id, limit: MAX_EXPANDED_OCCURRENCES_PER_REQUEST };
      }
      throw error;
    }
    for (const occurrence of expanded) {
      const occursAtMs = occurrence.occursAt.getTime();
      if (occursAtMs >= to.getTime()) continue;
      if (occursAtMs + durationMs <= from.getTime()) continue;

      const real = realOccurrenceByKey.get(`${row.id}|${occursAtMs}`);
      if (real?.status === "skipped") continue;

      items.push({
        id: row.id,
        title: row.title,
        description: row.description,
        location: row.location,
        all_day: row.allDay,
        starts_at: row.startsAt ? row.startsAt.toISOString() : null,
        ends_at: row.endsAt ? row.endsAt.toISOString() : null,
        start_date: row.startDate,
        end_date: row.endDate,
        is_recurring_instance: true,
        occurs_at: occurrence.occursAt.toISOString(),
        occurs_ends_at: row.endsAt ? new Date(occursAtMs + durationMs).toISOString() : null,
        parent_event_id: null,
        original_start_at: null,
        status: (real?.status ?? "scheduled") as EventRangeItem["status"],
      });
    }
  }

  items.sort((a, b) => sortKey(a) - sortKey(b));

  return { ok: true, items: items.map((item) => EventRangeItemSchema.parse(item)) };
}
