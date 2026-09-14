import {
  allDayInstanceDates,
  buildEventRecurrenceRule,
  expandDueDateWindow,
  expandRecurrenceInRange,
  parseFlexibleDatetime,
  resolveInstantToLocalUntil,
  TaskDueDateRuleError,
  toWallClockComponents,
  validateEventRecurrenceRule,
  wallClockToNaiveDate,
} from "@personal-os/core";
import { errorToken } from "@personal-os/core/logging/logger";
import { truncateProviderString } from "@personal-os/core/mail/provider-strings";
import { eventExternalLinks, events, occurrences } from "@personal-os/db";
import {
  ENTITY_TITLE_MAX_CHARS,
  EVENT_DESCRIPTION_MAX_CHARS,
  EVENT_LOCATION_MAX_CHARS,
  EventCalendarTargetSchema,
  EventCancelOccurrenceSchema,
  EventCreateSchema,
  EventDetachSchema,
  EventListQuerySchema,
  EventRangeQuerySchema,
  EventSchema,
  EventUpdateSchema,
  LinkEventToCalendarRequestSchema,
  sanitizeCalendarSyncErrorCode,
  type Event,
  type EventSyncState,
} from "@personal-os/schema";
import { and, asc, count, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { assembleEventRange } from "../read-models/event-range.js";
import { CALENDAR_PUSH_EVENT_QUEUE } from "../queue-names.js";
import { resolveWritableCalendar } from "./calendar-targets.js";
import { recurrenceChanged } from "./task-recurrence-diff.js";

type EventRow = typeof events.$inferSelect;
type LinkRow = typeof eventExternalLinks.$inferSelect;
type Db = FastifyInstance["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const DUE_DATE_WINDOW_DAYS = 90;

// The outbound-link projection (Checkpoint 9.5). Strictly the calendar
// identity the client already knows from /calendar-connections plus the
// sync state -- never the remote event id, ical uid or etag, and the stored
// error only through the closed-vocabulary sanitizer (a row written with
// provider prose collapses to `provider_error`).
function toSyncState(link: LinkRow | null | undefined): EventSyncState | null {
  if (!link) return null;
  const status = link.syncStatus;
  if (
    status !== "synced" &&
    status !== "pending_push" &&
    status !== "conflict" &&
    status !== "error"
  ) {
    throw new Error(`event_external_links ${link.id} has an unexpected sync_status`);
  }
  return {
    status,
    connection_id: link.connectionId,
    google_calendar_id: link.googleCalendarId ?? null,
    caldav_calendar_url: link.caldavCalendarUrl ?? null,
    last_error: sanitizeCalendarSyncErrorCode(link.lastSyncError),
  };
}

function toEventResponse(row: EventRow, link: LinkRow | null | undefined): Event {
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
    origin: row.origin,
    sync: toSyncState(link),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

async function loadLink(db: Db, eventId: string): Promise<LinkRow | null> {
  const [link] = await db
    .select()
    .from(eventExternalLinks)
    .where(eq(eventExternalLinks.eventId, eventId));
  return link ?? null;
}

// One query for a whole page of events, never one per row.
async function loadLinksByEventId(db: Db, eventIds: string[]): Promise<Map<string, LinkRow>> {
  const byEventId = new Map<string, LinkRow>();
  if (eventIds.length === 0) return byEventId;
  const links = await db
    .select()
    .from(eventExternalLinks)
    .where(inArray(eventExternalLinks.eventId, eventIds));
  for (const link of links) byEventId.set(link.eventId, link);
  return byEventId;
}

async function respondWithEvent(app: FastifyInstance, row: EventRow): Promise<Event> {
  return toEventResponse(row, await loadLink(app.db, row.id));
}

async function findEvent(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(events).where(eq(events.id, id));
  return row ?? null;
}

// Ownership gate (Checkpoint 9.5). An event that originated in a connected
// calendar and was synced inward is read-only through the ordinary edit and
// cancel surface -- and so is a detached child of such a series, whose own
// row carries `origin` from the detach that created it but whose identity
// belongs to the external parent.
async function isExternallyOwned(app: FastifyInstance, row: EventRow): Promise<boolean> {
  if (row.origin === "external") return true;
  if (row.parentEventId === null) return false;
  const parent = await findEvent(app, row.parentEventId);
  return parent?.origin === "external";
}

// The 400 body for a rule the write-time validator rejects (same discipline
// as tasks.ts's rruleValidationIssue): the message is a closed token, never
// the validator's own text, because every message packages/core throws
// quotes the rule verbatim and the rule is request text.
function rruleValidationIssue(err: unknown): { code: "custom"; path: ["rrule"]; message: string } {
  const message = err instanceof TaskDueDateRuleError ? err.code : "invalid_rrule";
  return { code: "custom", path: ["rrule"], message };
}

// A blank rule is no rule (Checkpoint 9.5 review). EventCreateSchema's
// `rrule: z.string()` has no .min(1), and a row persisted with rrule = ""
// is invisible everywhere: `rrule IS NULL` excludes it from the one-off
// sources of every read model while `rrule IS NOT NULL` admits it to the
// recurring source, where buildEventRecurrenceRule returns null and the row
// is skipped. Normalised BEFORE validation and storage so "" and whitespace
// mean exactly what a null means -- PATCH already treated "" as a clear.
function normalizeRruleInput(rrule: string | null | undefined): string | null {
  if (rrule === null || rrule === undefined) return null;
  const trimmed = rrule.trim();
  return trimmed === "" ? null : rrule;
}

// Checkpoint 9.5 review: a timed `recurrence_until` is stored at whole-second
// precision. The Phase 4 editor sends 23:59:59.999; the Google push emits
// UNTIL as whole seconds and the inbound sync returns .000, after which a
// title-only PATCH would see a "changed" until and regenerate the occurrence
// window for nothing. Flooring at write (and in the PATCH comparison) makes
// the stored value the value that round-trips.
function floorToSecond(instant: Date | null): Date | null {
  if (!instant) return null;
  return new Date(Math.floor(instant.getTime() / 1000) * 1000);
}

function pgErrorField(err: unknown, field: "code" | "constraint"): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const direct = (err as Record<string, unknown>)[field];
  if (typeof direct === "string") return direct;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) {
    const causeValue = (cause as Record<string, unknown>)[field];
    if (typeof causeValue === "string") return causeValue;
  }
  return undefined;
}

// True only for a unique violation on the client_uuid partial index -- any
// other 23505 (or any other error) is somebody else's problem and rethrows.
function isClientUuidConflict(err: unknown): boolean {
  return (
    pgErrorField(err, "code") === "23505" &&
    pgErrorField(err, "constraint") === "events_client_uuid_idx"
  );
}

// Durable intent (Checkpoint 9.5): every local mutation of a linked event
// records `pending_push` on its link INSIDE the mutation's own transaction,
// so a push that never gets enqueued (queue down, process dies between
// commit and send) is still visible to the worker's re-drive sweep. Returns
// whether a link exists so the caller can skip the post-commit enqueue
// without a second lookup.
async function markLinkPendingPush(tx: Tx, eventId: string, now: Date): Promise<boolean> {
  const updated = await tx
    .update(eventExternalLinks)
    .set({ syncStatus: "pending_push", updatedAt: now })
    .where(eq(eventExternalLinks.eventId, eventId))
    .returning({ id: eventExternalLinks.id });
  return updated.length > 0;
}

// Call after the owning transaction has COMMITTED (never from inside it --
// pg-boss sends are not transactional, so a mid-transaction enqueue could
// push a mutation that then rolls back). A failed send is a warn, never an
// error: the link row already carries the pending_push intent durably and
// the worker's sweep re-drives it, so the local write must not be reported
// as failed for a push that will still happen. `singletonKey` alone --
// `singletonSeconds` was dropped in 9.5 because pg-boss keeps a COMPLETED
// job in its time slot and silently swallowed the next send.
async function enqueuePushIfLinked(
  app: FastifyInstance,
  eventId: string,
  linked?: boolean,
): Promise<void> {
  if (linked === undefined) {
    linked = (await loadLink(app.db, eventId)) !== null;
  }
  if (!linked) return;
  if (!app.bossReady) {
    app.log.warn(
      { eventId },
      "events: job queue unavailable; calendar push not enqueued (link left pending_push)",
    );
    return;
  }
  try {
    await app.boss.send(CALENDAR_PUSH_EVENT_QUEUE, { eventId }, { singletonKey: eventId });
  } catch (err: unknown) {
    app.log.warn(
      { eventId, error: errorToken(err) },
      "events: calendar push could not be enqueued (link left pending_push)",
    );
  }
}

async function insertOccurrenceWindow(
  tx: Tx,
  eventId: string,
  rule: NonNullable<ReturnType<typeof buildEventRecurrenceRule>>,
  effectiveNow: Date,
): Promise<void> {
  const generated = expandDueDateWindow(rule, DUE_DATE_WINDOW_DAYS, effectiveNow);
  for (const occurrence of generated) {
    await tx
      .insert(occurrences)
      .values({
        parentType: "event",
        parentId: eventId,
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

function isValidOccurrence(parent: EventRow, targetInstant: Date): boolean {
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

const NOT_OWNED = { error: "event_not_owned" } as const;

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
    const links = await loadLinksByEventId(
      app.db,
      rows.map((row) => row.id),
    );

    return {
      items: rows.map((row) => toEventResponse(row, links.get(row.id))),
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
    return respondWithEvent(app, row);
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

    const rrule = normalizeRruleInput(body.rrule);
    const recurrenceTimezone = rrule ? (body.recurrence_timezone ?? body.timezone) : null;
    const recurrenceUntil = floorToSecond(
      rrule && body.recurrence_until
        ? parseFlexibleDatetime(body.recurrence_until, recurrenceTimezone ?? body.timezone)
        : null,
    );
    const recurrenceCount = rrule ? (body.recurrence_count ?? null) : null;
    const recurrenceExdates = rrule ? (body.recurrence_exdates ?? null) : null;

    // Checkpoint 9.5: the rule is validated at write time with the same
    // grammar tasks use (syntax, FREQ no finer than DAILY, no embedded
    // UNTIL/COUNT) so a bad rule is a 400 here rather than a throw inside
    // the transaction below.
    if (rrule) {
      try {
        validateEventRecurrenceRule(rrule, recurrenceTimezone ?? body.timezone, {
          recurrenceUntil,
          recurrenceCount,
          recurrenceExdates,
        });
      } catch (err: unknown) {
        return reply
          .code(400)
          .send({ error: "validation_failed", issues: [rruleValidationIssue(err)] });
      }
    }

    // Optional outbound calendar: eligibility is checked BEFORE anything is
    // written so an ineligible target never leaves an orphan event behind.
    let calendarTarget: Awaited<ReturnType<typeof resolveWritableCalendar>> | null = null;
    if (body.calendar) {
      const resolved = await resolveWritableCalendar(app.db, body.calendar);
      if (!resolved.ok) {
        return reply.code(400).send({
          error: "validation_failed",
          issues: [{ code: "custom", path: ["calendar"], message: resolved.reason }],
        });
      }
      calendarTarget = resolved;
    }

    const creationRule = buildEventRecurrenceRule({
      rrule,
      recurrenceTimezone,
      allDay: body.all_day ?? false,
      startsAt: startsAt ?? null,
      startDate: body.start_date ?? null,
      recurrenceUntil,
      recurrenceCount,
      recurrenceExdates,
    });

    let created: { row: EventRow; link: LinkRow | null };
    try {
      created = await app.db.transaction(async (tx) => {
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
            rrule,
            recurrenceTimezone,
            recurrenceUntil,
            recurrenceCount,
            recurrenceExdates,
            // Authored here -- editable and cancellable through Personal OS.
            origin: "local",
            clientUuid: body.client_uuid ?? null,
          })
          .returning();
        if (!inserted) throw new Error("insert into events returned no row");

        if (creationRule) {
          await insertOccurrenceWindow(tx, inserted.id, creationRule, effectiveNow);
        }

        let link: LinkRow | null = null;
        if (calendarTarget) {
          // The link row is the durable intent to push; it commits with the
          // event so the sweep can re-drive it even if the enqueue below
          // never happens.
          const [insertedLink] = await tx
            .insert(eventExternalLinks)
            .values({
              eventId: inserted.id,
              connectionId: calendarTarget.connectionId,
              googleCalendarId: calendarTarget.googleCalendarId,
              caldavCalendarUrl: calendarTarget.caldavCalendarUrl,
              syncStatus: "pending_push",
            })
            .returning();
          if (!insertedLink) throw new Error("insert into event_external_links returned no row");
          link = insertedLink;
        }

        return { row: inserted, link };
      });
    } catch (err: unknown) {
      // Idempotency (Checkpoint 9.5): a retry carrying the client_uuid of an
      // event that already committed gets that event back -- 200, same body
      // shape as the 201 -- never a second row. Mirrors POST /capture.
      if (body.client_uuid && isClientUuidConflict(err)) {
        const [existing] = await app.db
          .select()
          .from(events)
          .where(eq(events.clientUuid, body.client_uuid));
        if (!existing) {
          throw new Error("client_uuid conflicted on insert but no existing event was found", {
            cause: err,
          });
        }
        return reply.code(200).send(await respondWithEvent(app, existing));
      }
      throw err;
    }

    await enqueuePushIfLinked(app, created.row.id, created.link !== null);
    return reply.code(201).send(toEventResponse(created.row, created.link));
  });

  app.patch<{ Params: { id: string } }>("/events/:id", async (request, reply) => {
    // `calendar` is create-only in 9.5 (no re-link / unlink path exists, and
    // an unlink would need a remote delete). The strict schema would reject
    // it as an unrecognised key with Zod's own wording; this makes the
    // refusal a deterministic token the client can act on.
    if (
      typeof request.body === "object" &&
      request.body !== null &&
      Object.prototype.hasOwnProperty.call(request.body, "calendar")
    ) {
      return reply.code(400).send({
        error: "validation_failed",
        issues: [{ code: "custom", path: ["calendar"], message: "calendar_immutable" }],
      });
    }
    const body = EventUpdateSchema.parse(request.body);
    const existing = await findEvent(app, request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (await isExternallyOwned(app, existing)) return reply.code(409).send(NOT_OWNED);

    if (existing.parentEventId !== null && normalizeRruleInput(body.rrule) !== null) {
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

    // This re-parse exists for EventCreateSchema's date superRefine (all-day
    // vs timed consistency, end after start) over the MERGED row. Its text
    // bounds have already done their job on the body (EventUpdateSchema,
    // Checkpoint 9.6): a title the caller SET over the bound was refused
    // above. A title the caller did NOT touch may legitimately exceed the
    // bound -- rows written before 9.6 and calendar-synced rows were never
    // bounded -- and re-validating it here would make every PATCH to such a
    // row a 400 for a field the request never mentioned. So the untouched
    // stored title is fed in cut to the bound: this value is validation
    // input only and is never written.
    EventCreateSchema.parse({
      title: body.title ?? truncateProviderString(existing.title, ENTITY_TITLE_MAX_CHARS),
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

    // The effective recurrence state after this PATCH -- pure, computed
    // before the transaction so the rule can be validated (400) up front.
    // A body carrying null OR a blank string clears recurrence; an absent
    // key keeps the stored rule.
    const newRrule =
      body.rrule !== undefined
        ? normalizeRruleInput(body.rrule)
        : normalizeRruleInput(existing.rrule);
    const hasRecurrence = newRrule !== null;

    let newRecurrenceTimezone: string | null = null;
    let newRecurrenceUntil: Date | null = null;
    let newRecurrenceCount: number | null = null;
    let newRecurrenceExdates: string[] | null = null;

    if (hasRecurrence && newRrule) {
      newRecurrenceTimezone =
        body.recurrence_timezone !== undefined
          ? body.recurrence_timezone
          : (existing.recurrenceTimezone ?? existing.timezone);
      const targetTz = newRecurrenceTimezone ?? existing.timezone;
      newRecurrenceUntil = floorToSecond(
        body.recurrence_until !== undefined
          ? body.recurrence_until
            ? parseFlexibleDatetime(body.recurrence_until, targetTz)
            : null
          : existing.recurrenceUntil,
      );
      newRecurrenceCount =
        body.recurrence_count !== undefined ? body.recurrence_count : existing.recurrenceCount;
      newRecurrenceExdates =
        body.recurrence_exdates !== undefined
          ? body.recurrence_exdates
          : existing.recurrenceExdates;

      // Checkpoint 9.5: the EFFECTIVE rule is validated the same way POST
      // validates it (the body may change only the rrule, only
      // recurrence_until, or only the timezone, and any of those can make
      // the combination invalid).
      try {
        validateEventRecurrenceRule(newRrule, targetTz, {
          recurrenceUntil: newRecurrenceUntil,
          recurrenceCount: newRecurrenceCount,
          recurrenceExdates: newRecurrenceExdates,
        });
      } catch (err: unknown) {
        return reply
          .code(400)
          .send({ error: "validation_failed", issues: [rruleValidationIssue(err)] });
      }
    }

    const hadRecurrence = Boolean(existing.rrule);
    const patchRule = hasRecurrence
      ? buildEventRecurrenceRule({
          rrule: newRrule,
          recurrenceTimezone: newRecurrenceTimezone,
          allDay,
          startsAt: startsAt ?? null,
          startDate: startDate ?? null,
          recurrenceUntil: newRecurrenceUntil,
          recurrenceCount: newRecurrenceCount,
          recurrenceExdates: newRecurrenceExdates,
        })
      : null;
    // Checkpoint 9.5: a PATCH that leaves the effective series unchanged (a
    // title edit, a client re-sending the rule it loaded) must not churn
    // occurrence ids -- the same skip tasks.ts gained in 9.4. The DTSTART
    // instant stands in for the task anchor: the timed start, or the noon
    // anchor buildEventRecurrenceRule derives for an all-day series.
    let regenerateWindow = true;
    if (hadRecurrence && hasRecurrence && patchRule) {
      const existingTz = existing.recurrenceTimezone ?? existing.timezone;
      const existingRule = buildEventRecurrenceRule({
        rrule: existing.rrule,
        recurrenceTimezone: existingTz,
        allDay: existing.allDay,
        startsAt: existing.startsAt,
        startDate: existing.startDate,
        recurrenceUntil: existing.recurrenceUntil,
        recurrenceCount: existing.recurrenceCount,
        recurrenceExdates: existing.recurrenceExdates,
      });
      if (existingRule) {
        regenerateWindow = recurrenceChanged(
          {
            rrule: existing.rrule,
            recurrenceTimezone: existingTz,
            recurrenceAnchor: null,
            // Floored on both sides: a pre-9.5 row stored with milliseconds
            // must not read as a changed until against its own floored value.
            recurrenceUntil: floorToSecond(existing.recurrenceUntil),
            recurrenceCount: existing.recurrenceCount,
            recurrenceExdates: existing.recurrenceExdates,
            dueAt: wallClockToNaiveDate(existingRule.dtstart),
          },
          {
            rrule: newRrule,
            recurrenceTimezone: newRecurrenceTimezone,
            recurrenceAnchor: null,
            recurrenceUntil: newRecurrenceUntil,
            recurrenceCount: newRecurrenceCount,
            recurrenceExdates: newRecurrenceExdates,
            dueAt: wallClockToNaiveDate(patchRule.dtstart),
          },
        );
      }
    }

    const { row, linked } = await app.db.transaction(async (tx) => {
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
      } else if (hasRecurrence && regenerateWindow) {
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

        if (patchRule) {
          await insertOccurrenceWindow(tx, existing.id, patchRule, effectiveNow);
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

      const linked = updated ? await markLinkPendingPush(tx, existing.id, effectiveNow) : false;
      return { row: updated, linked };
    });

    if (!row) return reply.code(404).send({ error: "not_found" });
    await enqueuePushIfLinked(app, row.id, linked);
    return respondWithEvent(app, row);
  });

  // "Edit this occurrence" -- detaches ONE instance of a local series into
  // its own row and records the instant as an EXDATE on the parent.
  //
  // Refused on a LINKED local series (Checkpoint 9.5 review,
  // `linked_series_detach_unsupported`). Since 9.5 the push job sends the
  // master's recurrence, EXDATEs included, so the detach would remove the
  // instance from Google -- while the detached child has no link of its own
  // and is never pushed. The occurrence would silently vanish from the
  // remote calendar. Linking the child is not a proven path either: Google's
  // `events.insert` does not create an exception from `recurringEventId` /
  // `originalStartTime` (exceptions are patched through the instance id),
  // so it is not attempted here. `cancel-occurrence` stays allowed -- an
  // EXDATE on the master is exactly how Google represents a cancelled
  // instance. The refusal comes before any write.
  app.post<{ Params: { id: string } }>("/events/:id/detach", async (request, reply) => {
    const body = EventDetachSchema.parse(request.body);
    const parent = await findEvent(app, request.params.id);
    if (!parent || parent.archivedAt) return reply.code(404).send({ error: "not_found" });
    if (await isExternallyOwned(app, parent)) return reply.code(409).send(NOT_OWNED);

    if (!parent.rrule) {
      return reply.code(409).send({
        error: "not_recurring",
        message: "only recurring events can be detached",
      });
    }
    if ((await loadLink(app.db, parent.id)) !== null) {
      return reply.code(409).send({ error: "linked_series_detach_unsupported" });
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
      return reply.code(200).send(await respondWithEvent(app, existingDetached));
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
    // Text the caller supplied was bounded by EventDetachSchema (400 over the
    // bound). Text COPIED from the parent is not user-typed in this request,
    // and a parent written before Checkpoint 9.6 may exceed the bound, so the
    // copy is truncated at write (surrogate-safe) rather than making a
    // legacy series impossible to detach. The parent row itself is untouched.
    const title = body.title ?? truncateProviderString(parent.title, ENTITY_TITLE_MAX_CHARS) ?? "";
    const description =
      body.description !== undefined
        ? body.description
        : truncateProviderString(parent.description, EVENT_DESCRIPTION_MAX_CHARS);
    const location =
      body.location !== undefined
        ? body.location
        : truncateProviderString(parent.location, EVENT_LOCATION_MAX_CHARS);
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
      const now = new Date();
      const parentTz = parent.recurrenceTimezone ?? parent.timezone;
      const exdateStr = resolveInstantToLocalUntil(originalStartAt, parentTz);
      const currentExdates = parent.recurrenceExdates ?? [];
      if (!currentExdates.includes(exdateStr)) {
        await tx
          .update(events)
          .set({
            recurrenceExdates: [...currentExdates, exdateStr],
            updatedAt: now,
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
          // A detached child of a LOCAL series (the ownership gate above
          // guarantees the parent is local) is itself local.
          origin: "local",
        })
        .returning();

      if (!inserted) throw new Error("insert into events returned no row");
      return inserted;
    });

    // No push: the guard above guarantees the parent is unlinked, and the
    // child has no link of its own.
    return reply.code(201).send(toEventResponse(row, null));
  });

  app.post<{ Params: { id: string } }>("/events/:id/cancel-occurrence", async (request, reply) => {
    const body = EventCancelOccurrenceSchema.parse(request.body);
    const parent = await findEvent(app, request.params.id);
    if (!parent || parent.archivedAt) return reply.code(404).send({ error: "not_found" });
    if (await isExternallyOwned(app, parent)) return reply.code(409).send(NOT_OWNED);

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

    const { row: updatedParent, linked } = await app.db.transaction(async (tx) => {
      const now = new Date();
      const parentTz = parent.recurrenceTimezone ?? parent.timezone;
      const exdateStr = resolveInstantToLocalUntil(originalStartAt, parentTz);
      const currentExdates = parent.recurrenceExdates ?? [];
      let updatedRow = parent;
      if (!currentExdates.includes(exdateStr)) {
        const [row] = await tx
          .update(events)
          .set({
            recurrenceExdates: [...currentExdates, exdateStr],
            updatedAt: now,
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

      const linked = await markLinkPendingPush(tx, parent.id, now);
      return { row: updatedRow, linked };
    });

    await enqueuePushIfLinked(app, parent.id, linked);
    return reply.code(200).send(await respondWithEvent(app, updatedParent));
  });

  // Soft-delete: sets archived_at, touches nothing else -- occurrences and
  // item_tags lineage stay exactly as they were. Idempotent -- re-archiving
  // an already-archived event returns the same row without re-stamping it
  // (and without a second push). Cascades to active detached children. For
  // a linked local event the link flips to pending_push in the same
  // transaction and the push job deletes the remote copy.
  app.post<{ Params: { id: string } }>("/events/:id/archive", async (request, reply) => {
    const existing = await findEvent(app, request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (await isExternallyOwned(app, existing)) return reply.code(409).send(NOT_OWNED);
    if (existing.archivedAt) return respondWithEvent(app, existing);

    const now = new Date();
    const { row, linked } = await app.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(events)
        .set({ archivedAt: now, updatedAt: now })
        .where(and(eq(events.id, existing.id), isNull(events.archivedAt)))
        .returning();
      if (!updated) return { row: null, linked: false };

      await tx
        .update(events)
        .set({ archivedAt: now, updatedAt: now })
        .where(and(eq(events.parentEventId, existing.id), isNull(events.archivedAt)));

      const linked = await markLinkPendingPush(tx, existing.id, now);
      return { row: updated, linked };
    });

    if (!row) {
      // Lost a race with a concurrent archive: the row is archived either
      // way, so answer with whatever is there now rather than a 404.
      const current = await findEvent(app, existing.id);
      if (!current) return reply.code(404).send({ error: "not_found" });
      return respondWithEvent(app, current);
    }
    await enqueuePushIfLinked(app, row.id, linked);
    return respondWithEvent(app, row);
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
    // A selector naming both or neither calendar id is a 400 with the same
    // path POST /events uses for its `calendar` field, so the two entry
    // points to an outbound link share one refusal vocabulary.
    const selectorParse = EventCalendarTargetSchema.safeParse(body);
    if (!selectorParse.success) {
      return reply.code(400).send({
        error: "validation_failed",
        issues: [{ code: "custom", path: ["calendar"], message: "calendar_not_found" }],
      });
    }

    const [row] = await app.db.select().from(events).where(eq(events.id, request.params.id));
    if (!row || row.archivedAt) return reply.code(404).send({ error: "not_found" });
    // An event that came FROM a calendar is never pushed TO one.
    if (await isExternallyOwned(app, row)) return reply.code(409).send(NOT_OWNED);

    const [existingLink] = await app.db
      .select()
      .from(eventExternalLinks)
      .where(eq(eventExternalLinks.eventId, row.id));
    if (existingLink) {
      return reply.code(409).send({ error: "already_linked" });
    }

    // Second-round review: the detach guard must hold in BOTH directions. A
    // series that already has detached children, or a detached child itself,
    // cannot be linked: the push would send the master with its EXDATEs while
    // the moved occurrences have no link and are never pushed, so they would
    // silently vanish from the remote calendar (the same hazard
    // `/detach` on a linked series refuses).
    if (row.parentEventId !== null) {
      return reply.code(409).send({ error: "linked_series_detach_unsupported" });
    }
    const [detachedChild] = await app.db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.parentEventId, row.id), isNull(events.archivedAt)))
      .limit(1);
    if (detachedChild) {
      return reply.code(409).send({ error: "linked_series_detach_unsupported" });
    }

    // Checkpoint 9.5 review: the SAME write-eligibility rule POST /events
    // applies (sync-enabled, connection active, Google role owner/writer or
    // CalDAV). Before this the check was sync_enabled alone, so a reader,
    // freeBusyReader or role-less Google calendar could become a push target
    // and every push would 403 until the link was dead-lettered.
    const resolved = await resolveWritableCalendar(app.db, selectorParse.data);
    if (!resolved.ok) {
      return reply.code(400).send({
        error: "validation_failed",
        issues: [{ code: "custom", path: ["calendar"], message: resolved.reason }],
      });
    }

    const [link] = await app.db
      .insert(eventExternalLinks)
      .values({
        eventId: row.id,
        connectionId: resolved.connectionId,
        googleCalendarId: resolved.googleCalendarId,
        caldavCalendarUrl: resolved.caldavCalendarUrl,
        syncStatus: "pending_push",
      })
      .returning();
    if (!link) return reply.code(500).send({ error: "internal_error" });

    await enqueuePushIfLinked(app, row.id, true);

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
