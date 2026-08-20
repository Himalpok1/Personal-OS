import {
  expandRecurrenceInRange,
  parseFlexibleDatetime,
  RecurrenceExpansionLimitError,
  toWallClockComponents,
  type DueDateRecurrenceRule,
} from "@personal-os/core";
import { events, occurrences } from "@personal-os/db";
import {
  EventCreateSchema,
  EventListQuerySchema,
  EventRangeItemSchema,
  EventRangeQuerySchema,
  EventSchema,
  EventUpdateSchema,
  type EventRangeItem,
} from "@personal-os/schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { FastifyInstance } from "fastify";

const MAX_EXPANDED_OCCURRENCES_PER_REQUEST = 10_000;

function toEventResponse(row: typeof events.$inferSelect) {
  return EventSchema.parse({
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    starts_at: row.startsAt ? row.startsAt.toISOString() : null,
    ends_at: row.endsAt ? row.endsAt.toISOString() : null,
    timezone: row.timezone,
    all_day: row.allDay,
    start_date: row.startDate,
    end_date: row.endDate,
    rrule: row.rrule,
    recurrence_timezone: row.recurrenceTimezone,
    project_id: row.projectId,
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

async function findEvent(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(events).where(eq(events.id, id));
  return row ?? null;
}

// Recomputed fresh from the real anchor instant + zone on every call rather
// than trusting a possibly-stale start_local column, same reasoning as
// apps/worker's expand-due-date-window.ts buildRule -- kept as a local copy
// here rather than shared, since it's a five-line adapter from a `events`
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

// UTC calendar date of a real instant, as a plain YYYY-MM-DD string --
// GET /events/range's documented, deliberate simplification for deriving
// date-only bounds from from/to when they don't land exactly on a day
// boundary. Never converts an all-day event's own start_date/end_date
// through this (or any) instant -- only used to bound the *query*.
function toUtcCalendarDate(instant: Date): string {
  const iso = instant.toISOString();
  return iso.slice(0, 10);
}

function sortKey(item: EventRangeItem): number {
  if (item.is_recurring_instance && item.occurs_at) return Date.parse(item.occurs_at);
  if (item.starts_at) return Date.parse(item.starts_at);
  if (item.start_date) return Date.parse(`${item.start_date}T00:00:00.000Z`);
  return 0;
}

export default function eventsRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string> }>("/events", async (request) => {
    const query = EventListQuerySchema.parse(request.query);
    const where = and(
      query.project_id ? eq(events.projectId, query.project_id) : undefined,
      query.include_archived ? undefined : isNull(events.archivedAt),
    );

    const [rows, totalRows] = await Promise.all([
      app.db
        .select()
        .from(events)
        .where(where)
        // Same approximation tasks.ts uses for due_at: starts_at ascending,
        // then most-recently-created first for undated events.
        .orderBy(asc(events.startsAt), desc(events.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      app.db.select({ total: count() }).from(events).where(where),
    ]);
    const total = totalRows[0]?.total ?? 0;

    return {
      items: rows.map(toEventResponse),
      limit: query.limit,
      offset: query.offset,
      total,
    };
  });

  // GET /events/range -- the calendar-view read contract. Computed entirely
  // at request time, never writes to the database, and is correct
  // regardless of whether the nightly expand-due-date-window cron has ever
  // run for a given recurring event (past ranges, far-future ranges, and
  // freshly-created/edited series all work identically). See
  // packages/schema/src/events.ts's EventRangeItemSchema doc comment for the
  // exact response shape and its `id`/`starts_at`-vs-`occurs_at` contract.
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
  //     now-floor, unlike expandDueDateWindow. The query contract limits
  //     the requested span to 366 days, and expansion additionally stops
  //     at 10,000 candidates cumulatively across the request. Exceeding that resource bound
  //     fails the whole request explicitly rather than returning a silently
  //     incomplete calendar.
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
  app.get<{ Querystring: Record<string, string> }>("/events/range", async (request, reply) => {
    const query = EventRangeQuerySchema.parse(request.query);
    const from = new Date(query.from);
    const to = new Date(query.to);
    const archivedFilter = query.include_archived ? undefined : isNull(events.archivedAt);

    const timedRows = await app.db
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
    const allDayRows = await app.db
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

    const recurringRows = await app.db
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
      ? await app.db
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
          return reply.code(400).send({
            error: "recurrence_expansion_limit_exceeded",
            event_id: row.id,
            limit: MAX_EXPANDED_OCCURRENCES_PER_REQUEST,
          });
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
          status: (real?.status ?? "scheduled") as EventRangeItem["status"],
        });
      }
    }

    items.sort((a, b) => sortKey(a) - sortKey(b));

    return items.map((item) => EventRangeItemSchema.parse(item));
  });

  // Returns the row even if archived -- a direct link to an archived event
  // isn't a 404, it just won't appear in the default list view.
  app.get<{ Params: { id: string } }>("/events/:id", async (request, reply) => {
    const row = await findEvent(app, request.params.id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toEventResponse(row);
  });

  // rrule/recurrence_*/archived_at are rejected by EventCreateSchema's
  // .strict() before this ever runs -- recurrence stays capture(AI)-only,
  // same precedent as tasks.
  app.post("/events", async (request, reply) => {
    const body = EventCreateSchema.parse(request.body);
    const startsAt = body.starts_at
      ? parseFlexibleDatetime(body.starts_at, body.timezone)
      : undefined;
    const endsAt = body.ends_at ? parseFlexibleDatetime(body.ends_at, body.timezone) : undefined;
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      return reply.code(400).send({
        error: "validation_failed",
        issues: [{ path: ["ends_at"], message: "must be later than starts_at" }],
      });
    }
    const [row] = await app.db
      .insert(events)
      .values({
        title: body.title,
        description: body.description,
        location: body.location,
        startsAt,
        endsAt,
        timezone: body.timezone,
        allDay: body.all_day,
        startDate: body.start_date,
        endDate: body.end_date,
        projectId: body.project_id,
      })
      .returning();
    if (!row) throw new Error("insert into events returned no row");
    return reply.code(201).send(toEventResponse(row));
  });

  app.patch<{ Params: { id: string } }>("/events/:id", async (request, reply) => {
    const body = EventUpdateSchema.parse(request.body);
    const existing = await findEvent(app, request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const startsAt =
      body.starts_at !== undefined
        ? body.starts_at
          ? parseFlexibleDatetime(body.starts_at, existing.timezone)
          : null
        : existing.startsAt;
    const endsAt =
      body.ends_at !== undefined
        ? body.ends_at
          ? parseFlexibleDatetime(body.ends_at, existing.timezone)
          : null
        : existing.endsAt;
    const allDay = body.all_day ?? existing.allDay;
    const startDate = body.start_date !== undefined ? body.start_date : existing.startDate;
    const endDate = body.end_date !== undefined ? body.end_date : existing.endDate;

    EventCreateSchema.parse({
      title: body.title ?? existing.title,
      timezone: existing.timezone,
      all_day: allDay,
      ...(startsAt && { starts_at: startsAt.toISOString() }),
      ...(endsAt && { ends_at: endsAt.toISOString() }),
      ...(startDate && { start_date: startDate }),
      ...(endDate && { end_date: endDate }),
    });
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      return reply.code(400).send({
        error: "validation_failed",
        issues: [{ path: ["ends_at"], message: "must be later than starts_at" }],
      });
    }

    const [row] = await app.db
      .update(events)
      .set({
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.location !== undefined && { location: body.location }),
        // Resolved against the event's own stored timezone, not a
        // client-supplied one -- same reasoning as tasks.ts's due_at PATCH.
        ...(body.starts_at !== undefined && {
          startsAt,
        }),
        ...(body.ends_at !== undefined && {
          endsAt,
        }),
        ...(body.all_day !== undefined && { allDay: body.all_day }),
        ...(body.start_date !== undefined && { startDate: body.start_date }),
        ...(body.end_date !== undefined && { endDate: body.end_date }),
        ...(body.project_id !== undefined && { projectId: body.project_id }),
        updatedAt: new Date(),
      })
      .where(eq(events.id, request.params.id))
      .returning();
    if (!row) throw new Error("update on events returned no row for an id that was just found");
    return toEventResponse(row);
  });

  // Soft-delete: sets archived_at, touches nothing else -- occurrences and
  // item_tags lineage stay exactly as they were. Idempotent -- re-archiving
  // an already-archived event is a no-op.
  app.post<{ Params: { id: string } }>("/events/:id/archive", async (request, reply) => {
    const [row] = await app.db
      .update(events)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(events.id, request.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toEventResponse(row);
  });
}
