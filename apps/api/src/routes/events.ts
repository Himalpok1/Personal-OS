import {
  expandDueDateWindow,
  expandRecurrenceInRange,
  parseFlexibleDatetime,
  RecurrenceExpansionLimitError,
  resolveInstantToLocalUntil,
  toWallClockComponents,
  wallClockToNaiveDate,
  type DueDateRecurrenceRule,
} from "@personal-os/core";
import {
  calendarConnectionCalendars,
  calendarConnections,
  eventExternalLinks,
  events,
  occurrences,
} from "@personal-os/db";
import {
  EventCancelOccurrenceSchema,
  EventCreateSchema,
  EventDetachSchema,
  EventListQuerySchema,
  EventRangeItemSchema,
  EventRangeQuerySchema,
  EventSchema,
  EventUpdateSchema,
  LinkEventToCalendarRequestSchema,
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
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CALENDAR_PUSH_EVENT_QUEUE } from "../queue-names.js";

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
    recurrence_until: row.recurrenceUntil ? row.recurrenceUntil.toISOString() : null,
    recurrence_count: row.recurrenceCount,
    recurrence_exdates: row.recurrenceExdates,
    parent_event_id: row.parentEventId,
    original_start_at: row.originalStartAt ? row.originalStartAt.toISOString() : null,
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

function isValidOccurrence(parent: typeof events.$inferSelect, targetInstant: Date): boolean {
  if (!parent.rrule || !parent.startsAt) return false;
  const targetTz = parent.recurrenceTimezone ?? parent.timezone;
  const ruleWithoutExdates: DueDateRecurrenceRule = {
    rrule: parent.rrule,
    recurrenceTimezone: targetTz,
    dtstart: toWallClockComponents(parent.startsAt, targetTz),
    recurrenceUntil: parent.recurrenceUntil ?? undefined,
    recurrenceCount: parent.recurrenceCount ?? undefined,
  };
  const from = new Date(targetInstant.getTime() - 1000);
  const to = new Date(targetInstant.getTime() + 1000);
  const candidateOccurrences = expandRecurrenceInRange(ruleWithoutExdates, from, to);
  return candidateOccurrences.some((o) => o.occursAt.getTime() === targetInstant.getTime());
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
          parent_event_id: null,
          original_start_at: null,
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

  app.post("/events", async (request, reply) => {
    const body = EventCreateSchema.parse(request.body);
    const effectiveNow = new Date();

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

    const recurrenceTimezone = body.rrule ? (body.recurrence_timezone ?? body.timezone) : null;
    const recurrenceUntil =
      body.rrule && body.recurrence_until
        ? parseFlexibleDatetime(body.recurrence_until, recurrenceTimezone ?? body.timezone)
        : null;
    const recurrenceCount = body.rrule ? (body.recurrence_count ?? null) : null;
    const recurrenceExdates = body.rrule ? (body.recurrence_exdates ?? null) : null;

    const row = await app.db.transaction(async (tx) => {
      const [inserted] = await tx
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
          rrule: body.rrule ?? null,
          recurrenceTimezone,
          recurrenceUntil,
          recurrenceCount,
          recurrenceExdates,
        })
        .returning();
      if (!inserted) throw new Error("insert into events returned no row");

      if (body.rrule && startsAt) {
        const rule: DueDateRecurrenceRule = {
          rrule: body.rrule,
          recurrenceTimezone: recurrenceTimezone!,
          dtstart: toWallClockComponents(startsAt, recurrenceTimezone!),
          recurrenceUntil: recurrenceUntil ?? undefined,
          recurrenceCount: recurrenceCount ?? undefined,
          recurrenceExdates: recurrenceExdates ?? undefined,
        };
        const generated = expandDueDateWindow(rule, 90, effectiveNow);
        for (const occurrence of generated) {
          await tx
            .insert(occurrences)
            .values({
              parentType: "event",
              parentId: inserted.id,
              occursAt: occurrence.occursAt,
              occursLocal: wallClockToNaiveDate(occurrence.occursLocal),
              status: "scheduled",
              lazyGenerated: false,
            })
            .onConflictDoNothing({
              target: [occurrences.parentType, occurrences.parentId, occurrences.occursAt],
            });
        }
      }

      return inserted;
    });

    return reply.code(201).send(toEventResponse(row));
  });

  app.patch<{ Params: { id: string } }>("/events/:id", async (request, reply) => {
    const body = EventUpdateSchema.parse(request.body);
    const existing = await findEvent(app, request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });

    if (existing.parentEventId !== null && body.rrule !== undefined && body.rrule !== null) {
      return reply.code(400).send({
        error: "validation_failed",
        issues: [
          { path: ["rrule"], message: "detached event exceptions cannot have recurrence rules" },
        ],
      });
    }

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

    const effectiveNow = new Date();

    const row = await app.db.transaction(async (tx) => {
      const rruleExplicitlyNull = body.rrule === null;
      const newRrule = body.rrule !== undefined ? body.rrule : existing.rrule;
      const hasRecurrence = Boolean(newRrule) && !rruleExplicitlyNull;

      let newRecurrenceTimezone: string | null = null;
      let newRecurrenceUntil: Date | null = null;
      let newRecurrenceCount: number | null = null;
      let newRecurrenceExdates: string[] | null = null;

      if (hasRecurrence) {
        newRecurrenceTimezone =
          body.recurrence_timezone !== undefined
            ? body.recurrence_timezone
            : (existing.recurrenceTimezone ?? existing.timezone);
        const targetTz = newRecurrenceTimezone ?? existing.timezone;
        newRecurrenceUntil =
          body.recurrence_until !== undefined
            ? body.recurrence_until
              ? parseFlexibleDatetime(body.recurrence_until, targetTz)
              : null
            : existing.recurrenceUntil;
        newRecurrenceCount =
          body.recurrence_count !== undefined ? body.recurrence_count : existing.recurrenceCount;
        newRecurrenceExdates =
          body.recurrence_exdates !== undefined
            ? body.recurrence_exdates
            : existing.recurrenceExdates;
      }

      const hadRecurrence = Boolean(existing.rrule);

      if (hadRecurrence && !hasRecurrence) {
        // Rule E: Clearing recurrence (rrule = null): delete ALL scheduled occurrences
        // Preserve done and skipped.
        await tx
          .delete(occurrences)
          .where(
            and(
              eq(occurrences.parentType, "event"),
              eq(occurrences.parentId, existing.id),
              eq(occurrences.status, "scheduled"),
            ),
          );
      } else if (hasRecurrence) {
        // Rule B: Event -> Event Edit:
        // Preserve historical scheduled (occurs_at < effectiveNow) and skipped / status rows.
        // Delete future scheduled occurrences (status = 'scheduled' AND occurs_at >= effectiveNow).
        await tx
          .delete(occurrences)
          .where(
            and(
              eq(occurrences.parentType, "event"),
              eq(occurrences.parentId, existing.id),
              eq(occurrences.status, "scheduled"),
              gte(occurrences.occursAt, effectiveNow),
            ),
          );

        if (startsAt) {
          const rule: DueDateRecurrenceRule = {
            rrule: newRrule!,
            recurrenceTimezone: newRecurrenceTimezone!,
            dtstart: toWallClockComponents(startsAt, newRecurrenceTimezone!),
            recurrenceUntil: newRecurrenceUntil ?? undefined,
            recurrenceCount: newRecurrenceCount ?? undefined,
            recurrenceExdates: newRecurrenceExdates ?? undefined,
          };
          const generated = expandDueDateWindow(rule, 90, effectiveNow);
          for (const occurrence of generated) {
            await tx
              .insert(occurrences)
              .values({
                parentType: "event",
                parentId: existing.id,
                occursAt: occurrence.occursAt,
                occursLocal: wallClockToNaiveDate(occurrence.occursLocal),
                status: "scheduled",
                lazyGenerated: false,
              })
              .onConflictDoNothing({
                target: [occurrences.parentType, occurrences.parentId, occurrences.occursAt],
              });
          }
        }
      }

      const [updated] = await tx
        .update(events)
        .set({
          title: body.title !== undefined ? body.title : existing.title,
          description: body.description !== undefined ? body.description : existing.description,
          location: body.location !== undefined ? body.location : existing.location,
          startsAt,
          endsAt,
          allDay,
          startDate,
          endDate,
          projectId: body.project_id !== undefined ? body.project_id : existing.projectId,
          rrule: hasRecurrence ? newRrule : null,
          recurrenceTimezone: hasRecurrence ? newRecurrenceTimezone : null,
          recurrenceUntil: hasRecurrence ? newRecurrenceUntil : null,
          recurrenceCount: hasRecurrence ? newRecurrenceCount : null,
          recurrenceExdates: hasRecurrence ? newRecurrenceExdates : null,
          updatedAt: effectiveNow,
        })
        .where(eq(events.id, request.params.id))
        .returning();

      return updated;
    });

    if (!row) return reply.code(404).send({ error: "not_found" });
    return toEventResponse(row);
  });

  app.post<{ Params: { id: string } }>("/events/:id/detach", async (request, reply) => {
    const body = EventDetachSchema.parse(request.body);
    const parent = await findEvent(app, request.params.id);
    if (!parent || parent.archivedAt) return reply.code(404).send({ error: "not_found" });

    if (!parent.rrule) {
      return reply.code(409).send({
        error: "not_recurring",
        message: "only recurring events can be detached",
      });
    }

    const originalStartAt = new Date(body.original_start_at);
    if (!isValidOccurrence(parent, originalStartAt)) {
      return reply.code(400).send({
        error: "validation_failed",
        issues: [
          {
            path: ["original_start_at"],
            message: "not a valid occurrence instant for this event",
          },
        ],
      });
    }

    // Idempotent: return existing active detached event if already present
    const [existingDetached] = await app.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.parentEventId, parent.id),
          eq(events.originalStartAt, originalStartAt),
          isNull(events.archivedAt),
        ),
      );

    if (existingDetached) {
      return reply.code(200).send(toEventResponse(existingDetached));
    }

    const targetTz = body.timezone ?? parent.timezone;
    const allDay = body.all_day ?? parent.allDay;
    const title = body.title ?? parent.title;
    const description = body.description !== undefined ? body.description : parent.description;
    const location = body.location !== undefined ? body.location : parent.location;
    const projectId = body.project_id !== undefined ? body.project_id : parent.projectId;

    let startDate: string | null = null;
    let endDate: string | null = null;
    let startsAt: Date | null = null;
    let endsAt: Date | null = null;

    if (allDay) {
      startDate =
        body.start_date ??
        parent.startDate ??
        resolveInstantToLocalUntil(originalStartAt, targetTz);
      endDate = body.end_date !== undefined ? body.end_date : (parent.endDate ?? startDate);
      if (startDate && endDate && endDate < startDate) {
        return reply.code(400).send({
          error: "validation_failed",
          issues: [{ path: ["end_date"], message: "must be on or after start_date" }],
        });
      }
    } else {
      const parentDuration =
        parent.endsAt && parent.startsAt ? parent.endsAt.getTime() - parent.startsAt.getTime() : 0;
      startsAt = body.starts_at ? parseFlexibleDatetime(body.starts_at, targetTz) : originalStartAt;
      endsAt = body.ends_at
        ? parseFlexibleDatetime(body.ends_at, targetTz)
        : body.starts_at
          ? new Date(startsAt.getTime() + parentDuration)
          : parent.endsAt
            ? new Date(originalStartAt.getTime() + parentDuration)
            : null;

      if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
        return reply.code(400).send({
          error: "validation_failed",
          issues: [{ path: ["ends_at"], message: "must be later than starts_at" }],
        });
      }
    }

    const row = await app.db.transaction(async (tx) => {
      const parentTz = parent.recurrenceTimezone ?? parent.timezone;
      const exdateStr = resolveInstantToLocalUntil(originalStartAt, parentTz);
      const currentExdates = parent.recurrenceExdates ?? [];
      if (!currentExdates.includes(exdateStr)) {
        await tx
          .update(events)
          .set({
            recurrenceExdates: [...currentExdates, exdateStr],
            updatedAt: new Date(),
          })
          .where(eq(events.id, parent.id));
      }

      await tx
        .delete(occurrences)
        .where(
          and(
            eq(occurrences.parentType, "event"),
            eq(occurrences.parentId, parent.id),
            eq(occurrences.occursAt, originalStartAt),
          ),
        );

      const [inserted] = await tx
        .insert(events)
        .values({
          title,
          description,
          location,
          timezone: targetTz,
          allDay,
          startDate,
          endDate,
          startsAt,
          endsAt,
          projectId,
          parentEventId: parent.id,
          originalStartAt,
          rrule: null,
          recurrenceTimezone: null,
          recurrenceUntil: null,
          recurrenceCount: null,
          recurrenceExdates: null,
        })
        .returning();

      if (!inserted) throw new Error("insert into events returned no row");
      return inserted;
    });

    return reply.code(201).send(toEventResponse(row));
  });

  app.post<{ Params: { id: string } }>("/events/:id/cancel-occurrence", async (request, reply) => {
    const body = EventCancelOccurrenceSchema.parse(request.body);
    const parent = await findEvent(app, request.params.id);
    if (!parent || parent.archivedAt) return reply.code(404).send({ error: "not_found" });

    if (!parent.rrule) {
      return reply.code(409).send({
        error: "not_recurring",
        message: "only recurring events can have occurrences canceled",
      });
    }

    const originalStartAt = new Date(body.original_start_at);
    if (!isValidOccurrence(parent, originalStartAt)) {
      return reply.code(400).send({
        error: "validation_failed",
        issues: [
          {
            path: ["original_start_at"],
            message: "not a valid occurrence instant for this event",
          },
        ],
      });
    }

    const [existingDetached] = await app.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.parentEventId, parent.id),
          eq(events.originalStartAt, originalStartAt),
          isNull(events.archivedAt),
        ),
      );

    if (existingDetached) {
      return reply.code(409).send({
        error: "already_detached",
        message: "occurrence is already detached; archive or update the detached event instead",
      });
    }

    const updatedParent = await app.db.transaction(async (tx) => {
      const parentTz = parent.recurrenceTimezone ?? parent.timezone;
      const exdateStr = resolveInstantToLocalUntil(originalStartAt, parentTz);
      const currentExdates = parent.recurrenceExdates ?? [];
      let updatedRow = parent;
      if (!currentExdates.includes(exdateStr)) {
        const [row] = await tx
          .update(events)
          .set({
            recurrenceExdates: [...currentExdates, exdateStr],
            updatedAt: new Date(),
          })
          .where(eq(events.id, parent.id))
          .returning();
        if (row) updatedRow = row;
      }

      await tx
        .delete(occurrences)
        .where(
          and(
            eq(occurrences.parentType, "event"),
            eq(occurrences.parentId, parent.id),
            eq(occurrences.occursAt, originalStartAt),
          ),
        );

      return updatedRow;
    });

    return reply.code(200).send(toEventResponse(updatedParent));
  });

  // Soft-delete: sets archived_at, touches nothing else -- occurrences and
  // item_tags lineage stay exactly as they were. Idempotent -- re-archiving
  // an already-archived event is a no-op. Cascades to active detached children.
  app.post<{ Params: { id: string } }>("/events/:id/archive", async (request, reply) => {
    const now = new Date();
    const row = await app.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(events)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(events.id, request.params.id))
        .returning();
      if (!updated) return null;

      await tx
        .update(events)
        .set({ archivedAt: now, updatedAt: now })
        .where(and(eq(events.parentEventId, request.params.id), isNull(events.archivedAt)));

      return updated;
    });

    if (!row) return reply.code(404).send({ error: "not_found" });
    return toEventResponse(row);
  });

  // Explicit outbound linking (Decision 9): the only way a Personal OS
  // event starts syncing to Google -- no project_id-based inference exists.
  // Creates a pending_push event_external_links row with no googleEventId
  // yet (the row exists locally before the event exists on Google's side)
  // and enqueues the first push; calendar.google.push-event fills in
  // googleEventId once Google's insertEvent response comes back.
  const handleLinkCalendar = async (
    request: FastifyRequest<{ Params: { id: string }; Body: unknown }>,
    reply: FastifyReply,
  ) => {
    const parseResult = LinkEventToCalendarRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: "validation_failed",
        issues: parseResult.error.issues,
      });
    }
    const body = parseResult.data;
    const isCaldav = Boolean(body.caldav_calendar_url);

    const [row] = await app.db.select().from(events).where(eq(events.id, request.params.id));
    if (!row || row.archivedAt) return reply.code(404).send({ error: "not_found" });

    const [existingLink] = await app.db
      .select()
      .from(eventExternalLinks)
      .where(eq(eventExternalLinks.eventId, row.id));
    if (existingLink) {
      return reply.code(409).send({ error: "already_linked" });
    }

    const [connection] = await app.db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.id, body.connection_id));
    if (!connection || connection.status !== "active") {
      return reply.code(400).send({
        error: "validation_failed",
        issues: [{ path: ["connection_id"], message: "connection is not active" }],
      });
    }

    const calendarWhere = isCaldav
      ? and(
          eq(calendarConnectionCalendars.connectionId, body.connection_id),
          eq(calendarConnectionCalendars.caldavCalendarUrl, body.caldav_calendar_url!),
        )
      : and(
          eq(calendarConnectionCalendars.connectionId, body.connection_id),
          eq(calendarConnectionCalendars.googleCalendarId, body.google_calendar_id!),
        );

    const [calendarRow] = await app.db
      .select()
      .from(calendarConnectionCalendars)
      .where(calendarWhere);
    if (!calendarRow || !calendarRow.syncEnabled) {
      return reply.code(400).send({
        error: "validation_failed",
        issues: [
          {
            path: [isCaldav ? "caldav_calendar_url" : "google_calendar_id"],
            message: "calendar is not sync-enabled",
          },
        ],
      });
    }

    const [link] = await app.db
      .insert(eventExternalLinks)
      .values({
        eventId: row.id,
        connectionId: body.connection_id,
        googleCalendarId: isCaldav ? null : body.google_calendar_id,
        caldavCalendarUrl: isCaldav ? body.caldav_calendar_url : null,
        syncStatus: "pending_push",
      })
      .returning();
    if (!link) return reply.code(500).send({ error: "internal_error" });

    await app.boss.send(CALENDAR_PUSH_EVENT_QUEUE, { eventId: row.id });

    return reply.code(201).send({
      event_id: row.id,
      connection_id: link.connectionId,
      google_calendar_id: link.googleCalendarId,
      caldav_calendar_url: link.caldavCalendarUrl,
      sync_status: link.syncStatus,
    });
  };

  app.post<{ Params: { id: string } }>("/events/:id/link-google-calendar", handleLinkCalendar);

  app.post<{ Params: { id: string } }>("/events/:id/link-calendar", handleLinkCalendar);
}
