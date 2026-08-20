import { decryptSecret, encryptSecret, type EncryptedSecret } from "@personal-os/ai-providers";
import {
  classifyGoogleEvent,
  GoogleOAuthError,
  GoogleSyncTokenExpiredError,
  mapGoogleEventToLocalUpsert,
  refreshAccessToken,
  type GoogleCalendarClient,
  type GoogleCalendarEvent,
  type LocalEventFields,
  type LocalMutationIntent,
} from "@personal-os/calendar-providers";
import { resolveInstantToLocalUntil } from "@personal-os/core";
import {
  calendarConnectionCalendars,
  calendarConnections,
  calendarEventInstances,
  eventExternalLinks,
  events,
  occurrences,
  type Db,
} from "@personal-os/db";
import { and, eq } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { env } from "../env.js";

export interface CalendarSyncCalendarJobData {
  connectionId: string;
  calendarConnectionCalendarId: string;
}

// A local access token is considered expired (and refreshed inline, per the
// B3 brief's explicit "your call, but document the decision") once fewer
// than this many seconds remain -- avoids a token expiring mid-request
// against Google, and matches the same kind of small safety margin
// resolve-model.ts style resolvers elsewhere in this codebase don't need
// (those are per-call HTTP tokens, not long-lived OAuth grants) but an OAuth
// access token genuinely does.
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;

type EventInsert = typeof events.$inferInsert;

function encryptedFromColumns(
  ciphertext: Buffer | null,
  iv: Buffer | null,
  authTag: Buffer | null,
): EncryptedSecret | null {
  if (!ciphertext || !iv || !authTag) return null;
  return { ciphertext, iv, authTag };
}

// Decrypts and, if near/past expiry, refreshes the connection's access
// token -- persisting the refreshed token (and, if Google happened to
// rotate it, the refresh token) back to calendar_connections before
// returning. Google often omits a new refresh_token on this call; the
// existing stored one is kept in that case, per google-oauth.ts's own
// documented contract.
//
// Throws GoogleOAuthError with isPermanent=true on a dead grant (the
// primary trigger for status='needs_reauth') -- the caller is responsible
// for handling that terminally, matching this job's contract with
// calendar.google.refresh-token, which handles the exact same case for its
// own, separately-scheduled refresh pass.
async function resolveFreshAccessToken(
  db: Db,
  connection: typeof calendarConnections.$inferSelect,
): Promise<string> {
  const accessTokenSecret = encryptedFromColumns(
    connection.accessTokenCiphertext,
    connection.accessTokenIv,
    connection.accessTokenAuthTag,
  );
  const refreshTokenSecret = encryptedFromColumns(
    connection.refreshTokenCiphertext,
    connection.refreshTokenIv,
    connection.refreshTokenAuthTag,
  );

  const expiresAt = connection.accessTokenExpiresAt;
  const isExpiring =
    !accessTokenSecret ||
    !expiresAt ||
    expiresAt.getTime() - Date.now() < TOKEN_EXPIRY_SAFETY_MARGIN_MS;

  if (!isExpiring && accessTokenSecret) {
    return decryptSecret(accessTokenSecret, env.CREDENTIALS_ENCRYPTION_KEY);
  }

  if (!refreshTokenSecret) {
    throw new GoogleOAuthError(
      `calendar_connections ${connection.id} has no refresh token and its access token is expired`,
      401,
      "invalid_grant",
    );
  }
  const refreshToken = decryptSecret(refreshTokenSecret, env.CREDENTIALS_ENCRYPTION_KEY);

  const refreshed = await refreshAccessToken({
    refreshToken,
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  });

  const newAccessSecret = encryptSecret(refreshed.accessToken, env.CREDENTIALS_ENCRYPTION_KEY);
  await db
    .update(calendarConnections)
    .set({
      accessTokenCiphertext: newAccessSecret.ciphertext,
      accessTokenIv: newAccessSecret.iv,
      accessTokenAuthTag: newAccessSecret.authTag,
      accessTokenExpiresAt: refreshed.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(calendarConnections.id, connection.id));

  return refreshed.accessToken;
}

function localEventFieldsToInsert(
  fields: LocalEventFields,
  projectId: string | null,
  overrides: Partial<EventInsert> = {},
): EventInsert {
  return {
    title: fields.title,
    description: fields.description,
    location: fields.location,
    allDay: fields.allDay,
    startsAt: fields.startsAt ?? null,
    endsAt: fields.endsAt ?? null,
    timezone: fields.timezone ?? "UTC",
    startDate: fields.startDate ?? null,
    endDate: fields.endDate ?? null,
    rrule: fields.rrule ?? null,
    recurrenceTimezone: fields.recurrenceTimezone ?? null,
    recurrenceUntil: fields.recurrenceUntil ?? null,
    recurrenceCount: fields.recurrenceCount ?? null,
    recurrenceExdates: fields.recurrenceExdates ?? null,
    projectId,
    ...overrides,
  };
}

function localEventFieldsToUpdate(fields: LocalEventFields): Partial<EventInsert> {
  return {
    title: fields.title,
    description: fields.description,
    location: fields.location,
    allDay: fields.allDay,
    startsAt: fields.startsAt ?? null,
    endsAt: fields.endsAt ?? null,
    timezone: fields.timezone ?? "UTC",
    startDate: fields.startDate ?? null,
    endDate: fields.endDate ?? null,
    rrule: fields.rrule ?? null,
    recurrenceTimezone: fields.recurrenceTimezone ?? null,
    recurrenceUntil: fields.recurrenceUntil ?? null,
    recurrenceCount: fields.recurrenceCount ?? null,
    recurrenceExdates: fields.recurrenceExdates ?? null,
    updatedAt: new Date(),
  };
}

// Per-link conflict decision, shared by the master/one-off and
// detached-instance apply paths (which store their baseline in different
// tables -- event_external_links vs calendar_event_instances -- but compare
// identically). See the B3 brief's "PER-LINK baseline" rule: local changed
// iff events.updated_at > baseline.lastSyncedLocalUpdatedAt; remote changed
// iff fields.googleUpdated differs from baseline.googleUpdatedAt. Both
// changed -> true last-write-wins by comparing the two instants directly.
type ConflictDecision = "noop_neither_changed" | "noop_local_wins" | "apply_remote";

function decideConflict(
  localUpdatedAt: Date,
  baselineLocalUpdatedAt: Date | null,
  remoteUpdatedAt: Date,
  baselineRemoteUpdatedAt: Date | null,
): ConflictDecision {
  const localChanged =
    baselineLocalUpdatedAt === null || localUpdatedAt.getTime() > baselineLocalUpdatedAt.getTime();
  const remoteChanged =
    baselineRemoteUpdatedAt === null ||
    remoteUpdatedAt.getTime() !== baselineRemoteUpdatedAt.getTime();

  if (!localChanged && !remoteChanged) return "noop_neither_changed";
  if (localChanged && !remoteChanged) return "noop_local_wins";
  if (!localChanged && remoteChanged) return "apply_remote";
  // Both changed: true last-write-wins.
  return remoteUpdatedAt.getTime() > localUpdatedAt.getTime() ? "apply_remote" : "noop_local_wins";
}

// -- Applying LocalMutationIntent variants ----------------------------------

interface ApplyContext {
  tx: Db;
  connectionId: string;
  googleCalendarId: string;
  defaultProjectId: string | null;
  seenLinkKeys: Set<string>;
  seenInstanceKeys: Set<string>;
}

async function applyUpsertStandaloneOrMaster(
  ctx: ApplyContext,
  intent: Extract<LocalMutationIntent, { kind: "upsert_standalone_or_master" }>,
): Promise<void> {
  ctx.seenLinkKeys.add(intent.sourceGoogleEventId);

  const [link] = await ctx.tx
    .select()
    .from(eventExternalLinks)
    .where(
      and(
        eq(eventExternalLinks.connectionId, ctx.connectionId),
        eq(eventExternalLinks.googleCalendarId, ctx.googleCalendarId),
        eq(eventExternalLinks.googleEventId, intent.sourceGoogleEventId),
      ),
    );

  if (!link) {
    const [inserted] = await ctx.tx
      .insert(events)
      .values(localEventFieldsToInsert(intent.fields, ctx.defaultProjectId))
      .returning();
    if (!inserted) throw new Error("insert into events returned no row");
    await ctx.tx.insert(eventExternalLinks).values({
      eventId: inserted.id,
      connectionId: ctx.connectionId,
      googleCalendarId: ctx.googleCalendarId,
      googleEventId: intent.fields.googleEventId,
      googleIcalUid: intent.fields.googleICalUid,
      googleEtag: intent.fields.googleEtag,
      googleUpdatedAt: intent.fields.googleUpdated,
      lastSyncedLocalUpdatedAt: inserted.updatedAt,
      syncStatus: "synced",
    });
    return;
  }

  const [localEvent] = await ctx.tx.select().from(events).where(eq(events.id, link.eventId));
  if (!localEvent) {
    // The local row is gone (should be unreachable given the FK's cascade
    // delete would also remove this link row) -- defensive no-op, matches
    // this job's general policy of never crash-looping on an inconsistent
    // read.
    return;
  }

  const decision = decideConflict(
    localEvent.updatedAt,
    link.lastSyncedLocalUpdatedAt,
    intent.fields.googleUpdated,
    link.googleUpdatedAt,
  );

  if (decision === "noop_neither_changed" || decision === "noop_local_wins") return;

  const [updated] = await ctx.tx
    .update(events)
    .set(localEventFieldsToUpdate(intent.fields))
    .where(eq(events.id, localEvent.id))
    .returning();
  await ctx.tx
    .update(eventExternalLinks)
    .set({
      googleEtag: intent.fields.googleEtag,
      googleUpdatedAt: intent.fields.googleUpdated,
      lastSyncedLocalUpdatedAt: updated?.updatedAt ?? new Date(),
      syncStatus: "synced",
      updatedAt: new Date(),
    })
    .where(eq(eventExternalLinks.id, link.id));
}

// Mirrors apps/api/src/routes/events.ts's POST /events/:id/detach
// transaction body exactly (exdate append, matching `occurrences` row
// delete, new detached child `events` row) -- duplicated rather than
// imported because apps/api and apps/worker are separate deployable
// processes/packages with no shared internal-logic package between them
// (every other cross-cutting concern in this codebase, e.g. recurrence
// math, already lives in the one place both CAN import from:
// @personal-os/core). If this logic needs to change, both copies must
// change together; the route file is the canonical description of the
// algorithm and this comment is the pointer back to it.
async function applyDetachInstance(
  ctx: ApplyContext,
  event: GoogleCalendarEvent,
  intent: Extract<LocalMutationIntent, { kind: "detach_instance" }>,
): Promise<void> {
  ctx.seenInstanceKeys.add(event.id);

  const [instanceRow] = await ctx.tx
    .select()
    .from(calendarEventInstances)
    .where(
      and(
        eq(calendarEventInstances.connectionId, ctx.connectionId),
        eq(calendarEventInstances.googleCalendarId, ctx.googleCalendarId),
        eq(calendarEventInstances.googleInstanceEventId, event.id),
      ),
    );

  if (instanceRow) {
    if (instanceRow.mappingStatus !== "detached" || !instanceRow.localDetachedEventId) return;
    const [childEvent] = await ctx.tx
      .select()
      .from(events)
      .where(eq(events.id, instanceRow.localDetachedEventId));
    if (!childEvent) return;

    const decision = decideConflict(
      childEvent.updatedAt,
      instanceRow.lastSyncedLocalUpdatedAt,
      intent.fields.googleUpdated,
      instanceRow.googleUpdatedAt,
    );
    if (decision === "noop_neither_changed" || decision === "noop_local_wins") return;

    const [updatedChild] = await ctx.tx
      .update(events)
      .set(localEventFieldsToUpdate(intent.fields))
      .where(eq(events.id, childEvent.id))
      .returning();
    await ctx.tx
      .update(calendarEventInstances)
      .set({
        googleEtag: intent.fields.googleEtag,
        googleUpdatedAt: intent.fields.googleUpdated,
        lastSyncedLocalUpdatedAt: updatedChild?.updatedAt ?? new Date(),
        syncStatus: "synced",
        updatedAt: new Date(),
      })
      .where(eq(calendarEventInstances.id, instanceRow.id));
    return;
  }

  const [parentLink] = await ctx.tx
    .select()
    .from(eventExternalLinks)
    .where(
      and(
        eq(eventExternalLinks.connectionId, ctx.connectionId),
        eq(eventExternalLinks.googleCalendarId, ctx.googleCalendarId),
        eq(eventExternalLinks.googleEventId, intent.parentGoogleEventId),
      ),
    );
  if (!parentLink) {
    // The master hasn't been synced (yet) in this pass -- a subsequent
    // sync (this one already re-lists everything via the stored
    // syncToken, or a later full resync) will resolve it once the master
    // exists locally. Not an error.
    return;
  }
  const [parentEvent] = await ctx.tx.select().from(events).where(eq(events.id, parentLink.eventId));
  if (!parentEvent) return;

  const parentTz = parentEvent.recurrenceTimezone ?? parentEvent.timezone;
  const exdateStr = resolveInstantToLocalUntil(intent.originalStartInstant, parentTz);
  const currentExdates = parentEvent.recurrenceExdates ?? [];
  if (!currentExdates.includes(exdateStr)) {
    await ctx.tx
      .update(events)
      .set({ recurrenceExdates: [...currentExdates, exdateStr], updatedAt: new Date() })
      .where(eq(events.id, parentEvent.id));
  }

  await ctx.tx
    .delete(occurrences)
    .where(
      and(
        eq(occurrences.parentType, "event"),
        eq(occurrences.parentId, parentEvent.id),
        eq(occurrences.occursAt, intent.originalStartInstant),
      ),
    );

  const [childEvent] = await ctx.tx
    .insert(events)
    .values(
      localEventFieldsToInsert(intent.fields, ctx.defaultProjectId, {
        parentEventId: parentEvent.id,
        originalStartAt: intent.originalStartInstant,
        rrule: null,
        recurrenceTimezone: null,
        recurrenceUntil: null,
        recurrenceCount: null,
        recurrenceExdates: null,
      }),
    )
    .returning();
  if (!childEvent) throw new Error("insert into events (detached instance) returned no row");

  await ctx.tx.insert(calendarEventInstances).values({
    connectionId: ctx.connectionId,
    googleCalendarId: ctx.googleCalendarId,
    googleMasterEventId: intent.parentGoogleEventId,
    googleInstanceEventId: event.id,
    googleOriginalStartTime: intent.originalStartInstant,
    localParentEventId: parentEvent.id,
    localOriginalStartAt: intent.originalStartInstant,
    localDetachedEventId: childEvent.id,
    mappingStatus: "detached",
    googleEtag: intent.fields.googleEtag,
    googleUpdatedAt: intent.fields.googleUpdated,
    lastSyncedLocalUpdatedAt: childEvent.updatedAt,
    syncStatus: "synced",
  });
}

// Mirrors apps/api/src/routes/events.ts's POST /events/:id/cancel-occurrence
// transaction body -- see applyDetachInstance's doc comment for why this is
// a deliberate, documented duplication rather than a shared import.
async function applyCancelInstance(
  ctx: ApplyContext,
  googleInstanceEventId: string,
  intent: Extract<LocalMutationIntent, { kind: "cancel_instance" }>,
): Promise<void> {
  ctx.seenInstanceKeys.add(googleInstanceEventId);

  const [existing] = await ctx.tx
    .select()
    .from(calendarEventInstances)
    .where(
      and(
        eq(calendarEventInstances.connectionId, ctx.connectionId),
        eq(calendarEventInstances.googleCalendarId, ctx.googleCalendarId),
        eq(calendarEventInstances.googleInstanceEventId, googleInstanceEventId),
      ),
    );
  if (existing) return; // already applied

  const [parentLink] = await ctx.tx
    .select()
    .from(eventExternalLinks)
    .where(
      and(
        eq(eventExternalLinks.connectionId, ctx.connectionId),
        eq(eventExternalLinks.googleCalendarId, ctx.googleCalendarId),
        eq(eventExternalLinks.googleEventId, intent.parentGoogleEventId),
      ),
    );
  if (!parentLink) return; // master not yet synced -- resolved on a later pass

  const [parentEvent] = await ctx.tx.select().from(events).where(eq(events.id, parentLink.eventId));
  if (!parentEvent) return;

  const parentTz = parentEvent.recurrenceTimezone ?? parentEvent.timezone;
  const exdateStr = resolveInstantToLocalUntil(intent.originalStartInstant, parentTz);
  const currentExdates = parentEvent.recurrenceExdates ?? [];
  if (!currentExdates.includes(exdateStr)) {
    await ctx.tx
      .update(events)
      .set({ recurrenceExdates: [...currentExdates, exdateStr], updatedAt: new Date() })
      .where(eq(events.id, parentEvent.id));
  }

  await ctx.tx
    .delete(occurrences)
    .where(
      and(
        eq(occurrences.parentType, "event"),
        eq(occurrences.parentId, parentEvent.id),
        eq(occurrences.occursAt, intent.originalStartInstant),
      ),
    );

  await ctx.tx.insert(calendarEventInstances).values({
    connectionId: ctx.connectionId,
    googleCalendarId: ctx.googleCalendarId,
    googleMasterEventId: intent.parentGoogleEventId,
    googleInstanceEventId,
    googleOriginalStartTime: intent.originalStartInstant,
    localParentEventId: parentEvent.id,
    localOriginalStartAt: intent.originalStartInstant,
    localDetachedEventId: null,
    mappingStatus: "cancelled",
    syncStatus: "synced",
  });
}

// A genuine Google-side deletion of a standalone/master event: soft-delete
// (archive) the local row, per this app's everywhere-soft-delete
// convention, and remove the link row so a future re-creation of an event
// with the same id (rare, but Google ids can theoretically be reused after
// a long enough purge window) doesn't collide with a stale mapping.
async function applyStandaloneOrMasterDeletion(
  ctx: ApplyContext,
  googleEventId: string,
): Promise<void> {
  ctx.seenLinkKeys.add(googleEventId);
  const [link] = await ctx.tx
    .select()
    .from(eventExternalLinks)
    .where(
      and(
        eq(eventExternalLinks.connectionId, ctx.connectionId),
        eq(eventExternalLinks.googleCalendarId, ctx.googleCalendarId),
        eq(eventExternalLinks.googleEventId, googleEventId),
      ),
    );
  if (!link) return; // never synced -- nothing to delete

  const now = new Date();
  await ctx.tx
    .update(events)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(events.id, link.eventId));
  await ctx.tx.delete(eventExternalLinks).where(eq(eventExternalLinks.id, link.id));
}

async function applyOneItem(
  ctx: ApplyContext,
  event: GoogleCalendarEvent,
  defaultTimezone: string,
): Promise<void> {
  const isInstance = event.recurringEventId !== undefined && event.originalStartTime !== undefined;
  if (!isInstance && event.status === "cancelled") {
    await applyStandaloneOrMasterDeletion(ctx, event.id);
    return;
  }

  const classification = classifyGoogleEvent(event);
  const intent = mapGoogleEventToLocalUpsert(event, classification, { defaultTimezone });

  if (intent.kind === "upsert_standalone_or_master") {
    await applyUpsertStandaloneOrMaster(ctx, intent);
  } else if (intent.kind === "detach_instance") {
    await applyDetachInstance(ctx, event, intent);
  } else {
    await applyCancelInstance(ctx, event.id, intent);
  }
}

// Full-sync-only reconciliation: anything previously mapped for this
// (connectionId, googleCalendarId) that the full listing never mentioned is
// remote-missing -- resolved identically to an explicit deletion/cancel.
async function reconcileFullSync(ctx: ApplyContext): Promise<void> {
  const existingLinks = await ctx.tx
    .select()
    .from(eventExternalLinks)
    .where(
      and(
        eq(eventExternalLinks.connectionId, ctx.connectionId),
        eq(eventExternalLinks.googleCalendarId, ctx.googleCalendarId),
      ),
    );
  for (const link of existingLinks) {
    if (!ctx.seenLinkKeys.has(link.googleEventId)) {
      await applyStandaloneOrMasterDeletion(ctx, link.googleEventId);
    }
  }

  const existingInstances = await ctx.tx
    .select()
    .from(calendarEventInstances)
    .where(
      and(
        eq(calendarEventInstances.connectionId, ctx.connectionId),
        eq(calendarEventInstances.googleCalendarId, ctx.googleCalendarId),
      ),
    );
  for (const instance of existingInstances) {
    if (ctx.seenInstanceKeys.has(instance.googleInstanceEventId)) continue;
    // Defensive: Google's full listing with showDeleted=true should
    // include every tombstone, so this branch generally shouldn't fire.
    // Treated the same as an explicit cancellation -- archive a detached
    // child if one exists, or simply leave a cancelled mapping as-is (it
    // already represents "not on the calendar").
    if (instance.mappingStatus === "detached" && instance.localDetachedEventId) {
      const now = new Date();
      await ctx.tx
        .update(events)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(events.id, instance.localDetachedEventId));
    }
  }
}

export interface RunCalendarSyncDeps {
  db: Db;
  client: GoogleCalendarClient;
}

// Fetch phase (network only, no DB writes) followed by a single DB
// transaction that applies every mutation, runs full-sync reconciliation
// when applicable, and only then commits the new syncToken/status metadata
// -- a crash or thrown error anywhere in the transaction rolls the whole
// pass back, so the stored syncToken can never advance past unprocessed or
// unreconciled state.
export async function runCalendarSync(
  deps: RunCalendarSyncDeps,
  data: CalendarSyncCalendarJobData,
): Promise<void> {
  const { db, client } = deps;

  const [connection] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, data.connectionId));
  if (!connection || connection.status !== "active") return; // no-op, per the B3 spec

  const [calendarRow] = await db
    .select()
    .from(calendarConnectionCalendars)
    .where(eq(calendarConnectionCalendars.id, data.calendarConnectionCalendarId));
  if (!calendarRow || !calendarRow.syncEnabled) return;

  let accessToken: string;
  try {
    accessToken = await resolveFreshAccessToken(db, connection);
  } catch (err) {
    if (err instanceof GoogleOAuthError && err.isPermanent) {
      await db
        .update(calendarConnections)
        .set({ status: "needs_reauth", lastSyncError: err.message, updatedAt: new Date() })
        .where(eq(calendarConnections.id, connection.id));
      return; // permanent -- no retry
    }
    throw err; // transient -- let pg-boss retry
  }

  let isFullSync = !calendarRow.nextSyncToken;
  let syncToken = calendarRow.nextSyncToken ?? undefined;
  const items: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  let finalSyncToken: string | undefined;

  for (;;) {
    let page;
    try {
      page = await client.listEvents(accessToken, {
        calendarId: calendarRow.googleCalendarId,
        syncToken: isFullSync ? undefined : syncToken,
        pageToken,
      });
    } catch (err) {
      if (err instanceof GoogleSyncTokenExpiredError) {
        // Expected, not an error state -- discard the token and restart as
        // a full sync from scratch.
        isFullSync = true;
        syncToken = undefined;
        pageToken = undefined;
        items.length = 0;
        continue;
      }
      throw err;
    }
    items.push(...page.items);
    if (page.nextSyncToken) finalSyncToken = page.nextSyncToken;
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  // calendar_connection_calendars has no per-calendar timezone column --
  // Google always includes an explicit timeZone on a timed event's
  // start/end in practice, so this fallback only matters for the rare
  // malformed response translate.ts's own defaultTimezone parameter exists
  // to guard against.
  const defaultTimezone = "UTC";

  await db.transaction(async (tx) => {
    const ctx: ApplyContext = {
      tx: tx as unknown as Db,
      connectionId: connection.id,
      googleCalendarId: calendarRow.googleCalendarId,
      defaultProjectId: calendarRow.projectId,
      seenLinkKeys: new Set(),
      seenInstanceKeys: new Set(),
    };

    // Two passes: masters/one-offs first, then instances -- avoids an
    // ordering dependency on Google returning a master before its own
    // instances within the same page/listing (not documented as
    // guaranteed).
    const instanceItems: GoogleCalendarEvent[] = [];
    for (const event of items) {
      const isInstance =
        event.recurringEventId !== undefined && event.originalStartTime !== undefined;
      if (isInstance) {
        instanceItems.push(event);
        continue;
      }
      await applyOneItem(ctx, event, defaultTimezone);
    }
    for (const event of instanceItems) {
      await applyOneItem(ctx, event, defaultTimezone);
    }

    if (isFullSync) {
      await reconcileFullSync(ctx);
    }

    const now = new Date();
    await tx
      .update(calendarConnectionCalendars)
      .set({
        nextSyncToken: finalSyncToken ?? calendarRow.nextSyncToken ?? null,
        lastSuccessfulSyncAt: now,
        lastFullSyncAt: isFullSync ? now : calendarRow.lastFullSyncAt,
        updatedAt: now,
      })
      .where(eq(calendarConnectionCalendars.id, calendarRow.id));
  });
}

export function createCalendarSyncCalendarHandler(
  db: Db,
  client: GoogleCalendarClient,
): (jobs: Job<CalendarSyncCalendarJobData>[]) => Promise<void> {
  return async function handleCalendarSyncCalendar(jobs) {
    for (const job of jobs) {
      await runCalendarSync({ db, client }, job.data);
    }
  };
}

// Dead-letter: once retries are exhausted for a sync-calendar job, record
// the failure on the connection so it's visible (e.g. to a future
// Settings UI) rather than silently stopping sync with no trace. Does not
// touch calendarConnectionCalendars.nextSyncToken -- an exhausted attempt
// must never be treated as if it succeeded.
export function createCalendarSyncCalendarDeadLetterHandler(
  db: Db,
): (jobs: Job<CalendarSyncCalendarJobData>[]) => Promise<void> {
  return async function handleCalendarSyncCalendarDead(jobs) {
    for (const job of jobs) {
      await db
        .update(calendarConnections)
        .set({
          lastSyncError: "calendar.google.sync-calendar: retries exhausted",
          updatedAt: new Date(),
        })
        .where(eq(calendarConnections.id, job.data.connectionId));
    }
  };
}

// 15-minute cron target: enqueues calendar.google.sync-calendar for every
// syncEnabled calendar whose parent connection is active. Uses the
// singleton policy's singletonKey (see queue-names.ts) as the per-calendar
// serialization mechanism, so an overlapping cron tick or a manual
// sync-now request is a harmless queued duplicate, not a concurrent run.
export async function enqueueCalendarSyncForAllEnabledCalendars(
  db: Db,
  boss: PgBoss,
  queueName: string,
): Promise<void> {
  const rows = await db
    .select({
      calendarId: calendarConnectionCalendars.id,
      connectionId: calendarConnectionCalendars.connectionId,
      googleCalendarId: calendarConnectionCalendars.googleCalendarId,
      status: calendarConnections.status,
    })
    .from(calendarConnectionCalendars)
    .innerJoin(
      calendarConnections,
      eq(calendarConnectionCalendars.connectionId, calendarConnections.id),
    )
    .where(
      and(
        eq(calendarConnectionCalendars.syncEnabled, true),
        eq(calendarConnections.status, "active"),
      ),
    );

  for (const row of rows) {
    await boss.send(
      queueName,
      { connectionId: row.connectionId, calendarConnectionCalendarId: row.calendarId },
      { singletonKey: `${row.connectionId}:${row.googleCalendarId}` },
    );
  }
}

// Re-exported for apps/api's sync-now route, which needs the same query
// (scoped to one connection) without duplicating it.
export async function enqueueCalendarSyncForConnection(
  db: Db,
  boss: PgBoss,
  queueName: string,
  connectionId: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(calendarConnectionCalendars)
    .where(
      and(
        eq(calendarConnectionCalendars.connectionId, connectionId),
        eq(calendarConnectionCalendars.syncEnabled, true),
      ),
    );
  for (const row of rows) {
    await boss.send(
      queueName,
      { connectionId, calendarConnectionCalendarId: row.id },
      { singletonKey: `${connectionId}:${row.googleCalendarId}` },
    );
  }
  return rows.length;
}
