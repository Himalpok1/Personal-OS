import {
  allDayInstanceDates,
  buildEventRecurrenceRule,
  expandDueDateWindow,
  expandRecurrenceInRange,
  parseFlexibleDatetime,
  resolveInstantToLocalUntil,
  toWallClockComponents,
  wallClockToNaiveDate,
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
  EventRangeQuerySchema,
  EventSchema,
  EventUpdateSchema,
  LinkEventToCalendarRequestSchema,
} from "@personal-os/schema";
import { and, asc, count, desc, eq, gte, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { assembleEventRange } from "../read-models/event-range.js";
import { CALENDAR_PUSH_EVENT_QUEUE } from "../queue-names.js";

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

// Checkpoint 4.7 fix: a local mutation of an already-linked event must reach
// its external calendar. Previously only the initial link-calendar call ever
// enqueued CALENDAR_PUSH_EVENT_QUEUE, so any subsequent edit/detach/cancel/
// archive of an already-synced event silently never propagated outbound.
// Call this after the owning DB transaction has committed (never from inside
// it -- pg-boss sends aren't transactional, so enqueueing mid-transaction
// could push a mutation that then rolls back). singletonKey collapses rapid
// repeat enqueues for the same event into one in-flight job, which matters
// most for CalDAV's conditional-PUT (If-Match) path -- two concurrent pushes
// for the same event would race on a stale etag and spuriously flip
// sync_status to "conflict".
async function enqueuePushIfLinked(app: FastifyInstance, eventId: string): Promise<void> {
  const [link] = await app.db
    .select({ id: eventExternalLinks.id })
    .from(eventExternalLinks)
    .where(eq(eventExternalLinks.eventId, eventId));
  if (!link) return;
  await app.boss.send(
    CALENDAR_PUSH_EVENT_QUEUE,
    { eventId },
    { singletonKey: eventId, singletonSeconds: 10 },
  );
}

function isValidOccurrence(parent: typeof events.$inferSelect, targetInstant: Date): boolean {
  // Deliberately omits recurrenceExdates -- this checks whether the target
  // instant is a structurally valid slot of the series' rule, not whether
  // it's currently excluded. Works for both timed (starts_at-anchored) and
  // canonical all-day (start_date-anchored, noon dtstart) series via the
  // same shared builder every other recurrence call site uses.
  const ruleWithoutExdates = buildEventRecurrenceRule({
    rrule: parent.rrule,
    recurrenceTimezone: parent.recurrenceTimezone ?? parent.timezone,
    allDay: parent.allDay,
    startsAt: parent.startsAt,
    startDate: parent.startDate,
    recurrenceUntil: parent.recurrenceUntil,
    recurrenceCount: parent.recurrenceCount,
  });
  if (!ruleWithoutExdates) return false;
  const from = new Date(targetInstant.getTime() - 1000);
  const to = new Date(targetInstant.getTime() + 1000);
  const candidateOccurrences = expandRecurrenceInRange(ruleWithoutExdates, from, to);
  return candidateOccurrences.some((o) => o.occursAt.getTime() === targetInstant.getTime());
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
  // The three-source assembly itself lives in
  // ../read-models/event-range.ts so aggregate read models (/today) reuse
  // the identical recurrence/expansion semantics instead of forking them.
  app.get<{ Querystring: Record<string, string> }>("/events/range", async (request, reply) => {
    const query = EventRangeQuerySchema.parse(request.query);
    const assembled = await assembleEventRange(app.db, {
      from: new Date(query.from),
      to: new Date(query.to),
      includeArchived: query.include_archived,
    });
    if (!assembled.ok) {
      return reply.code(400).send({
        error: "recurrence_expansion_limit_exceeded",
        event_id: assembled.eventId,
        limit: assembled.limit,
      });
    }
    return assembled.items;
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

      const creationRule = buildEventRecurrenceRule({
        rrule: body.rrule ?? null,
        recurrenceTimezone,
        allDay: body.all_day ?? false,
        startsAt: startsAt ?? null,
        startDate: body.start_date ?? null,
        recurrenceUntil,
        recurrenceCount,
        recurrenceExdates,
      });
      if (creationRule) {
        const generated = expandDueDateWindow(creationRule, 90, effectiveNow);
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

        const patchRule = buildEventRecurrenceRule({
          rrule: newRrule,
          recurrenceTimezone: newRecurrenceTimezone,
          allDay,
          startsAt: startsAt ?? null,
          startDate: startDate ?? null,
          recurrenceUntil: newRecurrenceUntil,
          recurrenceCount: newRecurrenceCount,
          recurrenceExdates: newRecurrenceExdates,
        });
        if (patchRule) {
          const generated = expandDueDateWindow(patchRule, 90, effectiveNow);
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
    await enqueuePushIfLinked(app, row.id);
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
    // The zone the occurrence instant was GENERATED in -- distinct from
    // targetTz, which is the detached child's own display timezone. These
    // are independently settable (recurrence_timezone can diverge from
    // timezone), and deriving the occurrence's calendar date in the wrong
    // one lands the child a day off from the EXDATE recorded against its
    // own parent. Matches the exdate derivation below and mobile's
    // computeOccurrenceTiming.
    const occurrenceTz = parent.recurrenceTimezone ?? parent.timezone;
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
      // The detached child represents ONE occurrence, so its dates come from
      // that occurrence's own instant -- never from the parent's dtstart
      // template. Falling back to parent.startDate (as this did before
      // Checkpoint 5.4) was harmless only while all-day series could not
      // recur at all: parent.startDate was always null for a timed parent
      // being detached into an all-day child, so the instant fallback was
      // the only reachable branch. Now that canonical all-day series expand
      // (ADR-042), a template fallback would stamp every detached instance
      // with the series' first date.
      startDate = body.start_date ?? resolveInstantToLocalUntil(originalStartAt, occurrenceTz);
      if (body.end_date !== undefined) {
        endDate = body.end_date;
      } else if (parent.startDate && parent.endDate) {
        // Preserve the series' original day-span on this instance.
        const { endDate: derivedEnd } = allDayInstanceDates(
          toWallClockComponents(originalStartAt, occurrenceTz),
          parent.startDate,
          parent.endDate,
        );
        endDate = derivedEnd;
      } else {
        endDate = startDate;
      }
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

    // The parent's recurrenceExdates changed, not the new detached child (which
    // has no external link of its own yet) -- push the parent's series.
    await enqueuePushIfLinked(app, parent.id);
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

    await enqueuePushIfLinked(app, parent.id);
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
    await enqueuePushIfLinked(app, row.id);
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
