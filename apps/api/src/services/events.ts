import {
  buildEventRecurrenceRule,
  expandDueDateWindow,
  wallClockToNaiveDate,
  type DueDateRecurrenceRule,
} from "@personal-os/core";
import { errorToken } from "@personal-os/core/logging/logger";
import {
  calendarConnectionCalendars,
  calendarConnections,
  eventExternalLinks,
  events,
  occurrences,
  type Db,
} from "@personal-os/db";
import type { EventCalendarTarget } from "@personal-os/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { CALENDAR_PUSH_EVENT_QUEUE } from "../queue-names.js";
import {
  isWriteEligibleCalendar,
  type WritableCalendarResolution,
} from "../routes/calendar-targets.js";

// Event write services (Checkpoint 10.8, ADR-078 §2). Extracted VERBATIM from
// routes/events.ts so an approved action (actions/handlers.ts) and the
// owner's direct route call the identical code: the framework adds a
// permission gate, an approval and an audit row, never a second
// implementation of a write. Every function here takes the caller's
// transaction; nothing here opens one, and nothing here leaves the process
// except `enqueuePushIfLinked`, which the caller invokes only after its
// transaction has COMMITTED.

export type EventRow = typeof events.$inferSelect;
export type LinkRow = typeof eventExternalLinks.$inferSelect;
export type EventTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const DUE_DATE_WINDOW_DAYS = 90;

export async function loadEventLink(db: Db | EventTx, eventId: string): Promise<LinkRow | null> {
  const [link] = await db
    .select()
    .from(eventExternalLinks)
    .where(eq(eventExternalLinks.eventId, eventId));
  return link ?? null;
}

// Durable intent (Checkpoint 9.5): every local mutation of a linked event
// records `pending_push` on its link INSIDE the mutation's own transaction,
// so a push that never gets enqueued (queue down, process dies between
// commit and send) is still visible to the worker's re-drive sweep. Returns
// whether a link exists so the caller can skip the post-commit enqueue
// without a second lookup.
export async function markLinkPendingPush(
  tx: EventTx,
  eventId: string,
  now: Date,
): Promise<boolean> {
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
export async function enqueuePushIfLinked(
  app: FastifyInstance,
  eventId: string,
  linked?: boolean,
): Promise<void> {
  if (linked === undefined) {
    linked = (await loadEventLink(app.db, eventId)) !== null;
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

export async function insertOccurrenceWindow(
  tx: EventTx,
  eventId: string,
  rule: DueDateRecurrenceRule,
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

/**
 * `resolveWritableCalendar` (routes/calendar-targets.ts), callable inside a
 * transaction. That function is typed on the pool-backed `Db` (drizzle's
 * `NodePgDatabase & { $client }`), which a `PgTransaction` is not assignable
 * to, so an action's `execute` -- which must re-resolve the target UNDER its
 * transaction (ADR-078 §4) -- cannot call it. This is a line-for-line mirror
 * of its lookup with the same first-failing-condition token order; the
 * eligibility rule itself is not duplicated (`isWriteEligibleCalendar` is
 * the one shared predicate). actions/handlers.test.ts pins the two
 * resolvers equal on every reason token. Widening the original's parameter
 * to `Db | Tx` would let this copy be deleted.
 */
export async function resolveWritableCalendarInTx(
  db: Db | EventTx,
  selector: EventCalendarTarget,
): Promise<WritableCalendarResolution> {
  const [connection] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, selector.connection_id));
  if (!connection) return { ok: false, reason: "calendar_not_found" };

  const isCaldav = selector.caldav_calendar_url !== undefined;
  if ((connection.provider === "caldav") !== isCaldav) {
    return { ok: false, reason: "calendar_not_found" };
  }

  const [calendar] = await db
    .select()
    .from(calendarConnectionCalendars)
    .where(
      isCaldav
        ? and(
            eq(calendarConnectionCalendars.connectionId, connection.id),
            eq(calendarConnectionCalendars.caldavCalendarUrl, selector.caldav_calendar_url!),
          )
        : and(
            eq(calendarConnectionCalendars.connectionId, connection.id),
            eq(calendarConnectionCalendars.googleCalendarId, selector.google_calendar_id!),
          ),
    );
  if (!calendar) return { ok: false, reason: "calendar_not_found" };
  if (connection.status !== "active") return { ok: false, reason: "connection_not_active" };
  if (!isWriteEligibleCalendar(calendar, connection)) {
    return { ok: false, reason: "calendar_not_writable" };
  }

  return {
    ok: true,
    connectionId: connection.id,
    googleCalendarId: calendar.googleCalendarId ?? null,
    caldavCalendarUrl: calendar.caldavCalendarUrl ?? null,
  };
}

/** A write-eligible calendar, as `resolveWritableCalendar` resolves it (`ok: true`). */
export interface CalendarLinkTarget {
  connectionId: string;
  googleCalendarId: string | null;
  caldavCalendarUrl: string | null;
}

/**
 * The values `POST /events` inserts, already parsed and validated by the
 * caller: instants resolved through parseFlexibleDatetime, the rule
 * normalised and validated, `recurrenceUntil` floored to the second. The
 * caller resolves `calendarTarget` BEFORE opening its transaction so an
 * ineligible target never leaves an orphan event behind.
 */
export interface CreateLocalEventParams {
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  timezone: string;
  allDay?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  projectId?: string | null;
  rrule: string | null;
  recurrenceTimezone: string | null;
  recurrenceUntil: Date | null;
  recurrenceCount: number | null;
  recurrenceExdates: string[] | null;
  clientUuid: string | null;
  calendarTarget: CalendarLinkTarget | null;
}

/**
 * The transaction body of `POST /events`: inserts the event with
 * `origin: 'local'`, materialises the occurrence window when the row carries
 * a rule, and inserts the `event_external_links` row (`pending_push`) when a
 * calendar target was resolved. The link row is the durable intent to push;
 * it commits with the event so the sweep can re-drive it even if the
 * post-commit enqueue never happens. Rethrows a client_uuid unique violation
 * unchanged -- the route maps it to its idempotent 200.
 */
export async function createLocalEvent(
  tx: EventTx,
  params: CreateLocalEventParams,
  effectiveNow: Date,
): Promise<{ row: EventRow; link: LinkRow | null }> {
  const [inserted] = await tx
    .insert(events)
    .values({
      title: params.title,
      description: params.description,
      location: params.location,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      timezone: params.timezone,
      allDay: params.allDay,
      startDate: params.startDate,
      endDate: params.endDate,
      projectId: params.projectId,
      rrule: params.rrule,
      recurrenceTimezone: params.recurrenceTimezone,
      recurrenceUntil: params.recurrenceUntil,
      recurrenceCount: params.recurrenceCount,
      recurrenceExdates: params.recurrenceExdates,
      // Authored here -- editable and cancellable through Personal OS.
      origin: "local",
      clientUuid: params.clientUuid,
    })
    .returning();
  if (!inserted) throw new Error("insert into events returned no row");

  const creationRule = buildEventRecurrenceRule({
    rrule: params.rrule,
    recurrenceTimezone: params.recurrenceTimezone,
    allDay: params.allDay ?? false,
    startsAt: params.startsAt ?? null,
    startDate: params.startDate ?? null,
    recurrenceUntil: params.recurrenceUntil,
    recurrenceCount: params.recurrenceCount,
    recurrenceExdates: params.recurrenceExdates,
  });
  if (creationRule) {
    await insertOccurrenceWindow(tx, inserted.id, creationRule, effectiveNow);
  }

  let link: LinkRow | null = null;
  if (params.calendarTarget) {
    const [insertedLink] = await tx
      .insert(eventExternalLinks)
      .values({
        eventId: inserted.id,
        connectionId: params.calendarTarget.connectionId,
        googleCalendarId: params.calendarTarget.googleCalendarId,
        caldavCalendarUrl: params.calendarTarget.caldavCalendarUrl,
        syncStatus: "pending_push",
      })
      .returning();
    if (!insertedLink) throw new Error("insert into event_external_links returned no row");
    link = insertedLink;
  }

  return { row: inserted, link };
}

/**
 * The transaction body of `POST /events/:id/archive`: a conditional
 * soft-delete (`archived_at IS NULL` guards the stamp, so a concurrent
 * archive yields `row: null` and the caller answers with whatever is there
 * now), a cascade to the event's active detached children, and the link's
 * `pending_push` flip so the push job deletes the remote copy. The caller
 * has already refused an externally-owned event (`409 event_not_owned`) and
 * short-circuited an already-archived one; this function does neither.
 */
export async function archiveLocalEvent(
  tx: EventTx,
  eventId: string,
  now: Date,
): Promise<{ row: EventRow | null; linked: boolean }> {
  const [updated] = await tx
    .update(events)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(events.id, eventId), isNull(events.archivedAt)))
    .returning();
  if (!updated) return { row: null, linked: false };

  await tx
    .update(events)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(events.parentEventId, eventId), isNull(events.archivedAt)));

  const linked = await markLinkPendingPush(tx, eventId, now);
  return { row: updated, linked };
}
