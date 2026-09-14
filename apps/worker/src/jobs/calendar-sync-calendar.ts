import { decryptSecret, encryptSecret, type EncryptedSecret } from "@personal-os/ai-providers";
import {
  classifyGoogleEvent,
  CalDavError,
  GoogleOAuthError,
  GoogleSyncTokenExpiredError,
  googleExdateInstantToLocalDate,
  mapGoogleEventToLocalUpsert,
  parseVCalendarToMutationIntents,
  refreshAccessToken,
  type CalDavClient,
  type CalDavEventFields,
  type CalDavMutationIntent,
  type GoogleCalendarClient,
  type GoogleCalendarEvent,
  type LocalEventFields,
  classifyCalendarProviderError,
  type LocalMutationIntent,
} from "@personal-os/calendar-providers";
import type { CalendarSyncErrorCode } from "@personal-os/schema";
import { CALENDAR_SYNC_CALENDAR_QUEUE } from "../queue-names.js";
import { withCalendarJobErrorContainment } from "./calendar-job-error.js";
import { markNeedsReauth } from "./calendar-refresh-token.js";
import {
  calendarConnectionCalendars,
  calendarConnections,
  calendarEventInstances,
  eventExternalLinks,
  events,
  occurrences,
  type Db,
} from "@personal-os/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { env } from "../env.js";
import { log } from "../logger.js";
import { desiredCaldavResourceHref } from "./calendar-push-event.js";

export interface CalendarSyncCalendarJobData {
  connectionId: string;
  calendarConnectionCalendarId: string;
}

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

export async function resolveFreshAccessToken(
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

export type ConflictDecision =
  "noop_neither_changed" | "apply_remote" | "noop_local_wins" | "conflict";

export function decideConflict(
  localUpdatedAt: Date,
  baselineLocalUpdatedAt: Date | null,
  remoteUpdatedAt?: Date,
  baselineRemoteUpdatedAt?: Date | null,
): ConflictDecision {
  const localChanged =
    baselineLocalUpdatedAt === null || localUpdatedAt.getTime() > baselineLocalUpdatedAt.getTime();
  const remoteChanged =
    remoteUpdatedAt !== undefined &&
    (baselineRemoteUpdatedAt === null ||
      baselineRemoteUpdatedAt === undefined ||
      remoteUpdatedAt.getTime() > baselineRemoteUpdatedAt.getTime());

  if (!localChanged && !remoteChanged) return "noop_neither_changed";
  if (!localChanged && remoteChanged) return "apply_remote";
  if (localChanged && !remoteChanged) return "noop_local_wins";

  if (remoteUpdatedAt && remoteUpdatedAt.getTime() > localUpdatedAt.getTime()) {
    return "apply_remote";
  }
  if (remoteUpdatedAt && localUpdatedAt.getTime() > remoteUpdatedAt.getTime()) {
    return "noop_local_wins";
  }
  return "conflict";
}

function localEventFieldsToInsert(
  fields: LocalEventFields | CalDavEventFields,
  projectId: string | null,
): EventInsert {
  return {
    // EVERY inbound insert is provider-originated (Checkpoint 9.5, ADR ownership
    // contract): read-only through the ordinary edit/cancel surface. Set
    // explicitly even though the column defaults to 'external', so the intent
    // is visible at the one place every inbound insert site builds its row.
    origin: "external",
    title: fields.title,
    description: fields.description,
    location: fields.location,
    allDay: fields.allDay,
    startsAt: fields.startsAt ?? null,
    endsAt: fields.endsAt ?? null,
    timezone: fields.timezone ?? "UTC",
    startDate: fields.startDate ?? null,
    endDate: fields.endDate ?? null,
    projectId,
    rrule: fields.rrule ?? null,
    recurrenceUntil: fields.recurrenceUntil ?? null,
    recurrenceCount: fields.recurrenceCount ?? null,
    recurrenceTimezone: fields.recurrenceTimezone ?? null,
    recurrenceExdates: fields.recurrenceExdates ?? null,
  };
}

/**
 * The zone an EXISTING local row's recurrence is read in: the caller passes it
 * to the translation layer so a remote payload that carries no zone (every
 * all-day event from Google) is resolved where the row already lives, never
 * in the connection-level fallback (fixer review, MAJOR-D).
 */
function existingZoneOf(row: typeof events.$inferSelect): string {
  return row.recurrenceTimezone ?? row.timezone;
}

function localEventFieldsToUpdate(
  fields: LocalEventFields | CalDavEventFields,
  existing: typeof events.$inferSelect,
): Partial<typeof events.$inferInsert> {
  return {
    title: fields.title,
    description: fields.description,
    location: fields.location,
    allDay: fields.allDay,
    startsAt: fields.startsAt ?? null,
    endsAt: fields.endsAt ?? null,
    // NEVER the fallback over a row that already has a zone (fixer review,
    // MAJOR-D): an all-day payload carries no zone, and "UTC" written here
    // re-anchored a LOCAL Chicago series on every apply_remote of its own echo.
    timezone: fields.timezone ?? existing.timezone,
    startDate: fields.startDate ?? null,
    endDate: fields.endDate ?? null,
    rrule: fields.rrule ?? null,
    recurrenceUntil: fields.recurrenceUntil ?? null,
    recurrenceCount: fields.recurrenceCount ?? null,
    recurrenceTimezone: fields.rrule
      ? (fields.recurrenceTimezone ?? existing.recurrenceTimezone ?? existing.timezone)
      : null,
    recurrenceExdates: fields.recurrenceExdates ?? null,
    updatedAt: new Date(),
  };
}

// -----------------------------------------------------------------------------
// CALDAV SYNC ENGINE
// -----------------------------------------------------------------------------

async function runCaldavSync(
  db: Db,
  caldavClient: CalDavClient,
  connection: typeof calendarConnections.$inferSelect,
  calendarRow: typeof calendarConnectionCalendars.$inferSelect,
): Promise<void> {
  if (!connection.passwordCiphertext || !connection.passwordIv || !connection.passwordAuthTag) {
    return;
  }
  const password = decryptSecret(
    {
      ciphertext: connection.passwordCiphertext,
      iv: connection.passwordIv,
      authTag: connection.passwordAuthTag,
    },
    env.CREDENTIALS_ENCRYPTION_KEY,
  );
  const auth = {
    username: connection.username!,
    password,
  };
  const calendarHref = calendarRow.caldavCalendarUrl!;

  let isFullSync = !calendarRow.nextSyncToken;
  let finalSyncToken: string | undefined;
  const updatedItems: Array<{ href: string; etag: string }> = [];
  const deletedHrefs: string[] = [];
  // Captured BEFORE the first provider read (fixer review, MAJOR-C): a link
  // that a push completed after this instant can be absent from a listing
  // taken before it, and must not be archived for that.
  const listStartedAt = new Date();

  if (!isFullSync && calendarRow.nextSyncToken) {
    let currentToken: string | undefined = calendarRow.nextSyncToken;
    let iterations = 0;
    const MAX_PAGES = 50;

    while (iterations++ < MAX_PAGES) {
      try {
        const res = await caldavClient.syncCollection(calendarHref, currentToken, auth);
        updatedItems.push(...res.updated);
        deletedHrefs.push(...res.deletedHrefs);
        currentToken = res.syncToken;
        if (!res.hasMore) {
          finalSyncToken = res.syncToken;
          break;
        }
      } catch (err: unknown) {
        if (err instanceof CalDavError && err.isInvalidSyncToken) {
          isFullSync = true;
          updatedItems.length = 0;
          deletedHrefs.length = 0;
          break;
        }
        throw err;
      }
    }
  }

  if (isFullSync) {
    const inventory = await caldavClient.listEventsInventory(calendarHref, auth);
    const existingLinks = await db
      .select()
      .from(eventExternalLinks)
      .where(
        and(
          eq(eventExternalLinks.connectionId, connection.id),
          eq(eventExternalLinks.caldavCalendarUrl, calendarHref),
        ),
      );

    const inventoryMap = new Map(inventory.map((i) => [i.href, i.etag]));

    // Identify deleted remotely -- only links that were SYNCED before the
    // listing began. A link stamped by a push mid-listing is newer than the
    // inventory it is missing from (MAJOR-C, the CalDAV twin).
    for (const link of existingLinks) {
      if (
        link.caldavResourceUrl &&
        !inventoryMap.has(link.caldavResourceUrl) &&
        link.syncStatus === "synced" &&
        link.updatedAt.getTime() < listStartedAt.getTime()
      ) {
        deletedHrefs.push(link.caldavResourceUrl);
      }
    }

    // Identify added / updated
    for (const item of inventory) {
      const existing = existingLinks.find((l) => l.caldavResourceUrl === item.href);
      if (!existing || existing.caldavEtag !== item.etag) {
        updatedItems.push(item);
      }
    }
  }

  // Multiget changed resources in batches of 50
  const multigetHrefs = updatedItems.map((u) => u.href);
  const fetchedEvents: Array<{ href: string; etag: string; icsData: string }> = [];

  for (let i = 0; i < multigetHrefs.length; i += 50) {
    const batch = multigetHrefs.slice(i, i + 50);
    const fetched = await caldavClient.multigetEvents(calendarHref, batch, auth);
    fetchedEvents.push(...fetched);
  }

  await db.transaction(async (tx) => {
    // 1. Process deletions
    for (const delHref of deletedHrefs) {
      const [link] = await tx
        .select()
        .from(eventExternalLinks)
        .where(
          and(
            eq(eventExternalLinks.connectionId, connection.id),
            eq(eventExternalLinks.caldavCalendarUrl, calendarHref),
            eq(eventExternalLinks.caldavResourceUrl, delHref),
          ),
        );
      if (link) {
        await tx.update(events).set({ archivedAt: new Date() }).where(eq(events.id, link.eventId));
        await tx.delete(eventExternalLinks).where(eq(eventExternalLinks.id, link.id));
      }
    }

    // 2. Process fetched VCALENDAR payloads
    for (const item of fetchedEvents) {
      let intents: CalDavMutationIntent[];
      try {
        intents = parseVCalendarToMutationIntents(item.icsData, item.href, item.etag);
      } catch {
        continue;
      }

      for (const intent of intents) {
        if (intent.kind === "upsert_standalone_or_master") {
          const [existingLink] = await tx
            .select()
            .from(eventExternalLinks)
            .where(
              and(
                eq(eventExternalLinks.connectionId, connection.id),
                eq(eventExternalLinks.caldavCalendarUrl, calendarHref),
                eq(eventExternalLinks.caldavResourceUrl, item.href),
              ),
            );

          if (!existingLink) {
            // OUR OWN JUST-PUSHED RESOURCE (fixer review, BLOCKER-2): the push
            // job creates resources at a link-derived href and stores it only
            // after a confirmed response, so a sync running inside the retry
            // window sees a resource no link claims yet. Adopt the pending
            // link rather than importing a duplicate; the retry then updates
            // in place. Local is authoritative -- nothing is applied.
            const adopted = await adoptPendingCaldavLink(
              tx as unknown as Db,
              connection.id,
              calendarHref,
              item.href,
              { icalUid: intent.icalUid ?? null, etag: intent.etag, updatedAt: intent.updatedAt },
            );
            if (adopted) continue;
          }

          if (existingLink) {
            const [localEvent] = await tx
              .select()
              .from(events)
              .where(eq(events.id, existingLink.eventId));
            if (!localEvent) continue;

            const decision = decideConflict(
              localEvent.updatedAt,
              existingLink.lastSyncedLocalUpdatedAt,
              intent.updatedAt,
              existingLink.caldavUpdatedAt,
            );

            if (decision === "noop_neither_changed" || decision === "noop_local_wins") {
              continue;
            }

            if (decision === "conflict") {
              await tx
                .update(eventExternalLinks)
                .set({
                  syncStatus: "conflict",
                  lastSyncError: "conflict" satisfies CalendarSyncErrorCode,
                })
                .where(eq(eventExternalLinks.id, existingLink.id));
              continue;
            }

            const [updated] = await tx
              .update(events)
              .set(localEventFieldsToUpdate(intent.fields, localEvent))
              .where(eq(events.id, localEvent.id))
              .returning();

            await tx
              .update(eventExternalLinks)
              .set({
                caldavEtag: intent.etag,
                caldavUpdatedAt: intent.updatedAt ?? null,
                lastSyncedLocalUpdatedAt: updated?.updatedAt ?? new Date(),
                syncStatus: "synced",
                updatedAt: new Date(),
              })
              .where(eq(eventExternalLinks.id, existingLink.id));
          } else {
            const [created] = await tx
              .insert(events)
              .values(localEventFieldsToInsert(intent.fields, calendarRow.projectId))
              .returning();

            if (created) {
              await tx.insert(eventExternalLinks).values({
                eventId: created.id,
                connectionId: connection.id,
                caldavCalendarUrl: calendarHref,
                caldavResourceUrl: item.href,
                caldavIcalUid: intent.icalUid ?? null,
                caldavEtag: intent.etag,
                caldavUpdatedAt: intent.updatedAt ?? null,
                lastSyncedLocalUpdatedAt: created.updatedAt,
                syncStatus: "synced",
              });
            }
          }
        } else if (intent.kind === "detach_instance") {
          const [parentLink] = await tx
            .select()
            .from(eventExternalLinks)
            .where(
              and(
                eq(eventExternalLinks.connectionId, connection.id),
                eq(eventExternalLinks.caldavCalendarUrl, calendarHref),
                eq(eventExternalLinks.caldavResourceUrl, intent.resourceHref),
              ),
            );

          if (parentLink) {
            const [existingInstance] = await tx
              .select()
              .from(calendarEventInstances)
              .where(
                and(
                  eq(calendarEventInstances.localParentEventId, parentLink.eventId),
                  eq(calendarEventInstances.localOriginalStartAt, intent.originalStartInstant),
                ),
              );

            if (existingInstance && existingInstance.localDetachedEventId) {
              const [childEvent] = await tx
                .select()
                .from(events)
                .where(eq(events.id, existingInstance.localDetachedEventId));
              if (!childEvent) continue;
              await tx
                .update(events)
                .set(localEventFieldsToUpdate(intent.fields, childEvent))
                .where(eq(events.id, childEvent.id));

              await tx
                .update(calendarEventInstances)
                .set({
                  caldavEtag: intent.etag,
                  caldavUpdatedAt: intent.updatedAt ?? null,
                  syncStatus: "synced",
                  updatedAt: new Date(),
                })
                .where(eq(calendarEventInstances.id, existingInstance.id));
            } else {
              const [parentEvent] = await tx
                .select({ origin: events.origin })
                .from(events)
                .where(eq(events.id, parentLink.eventId));
              if (!parentEvent) continue;
              const [detachedChild] = await tx
                .insert(events)
                .values({
                  ...localEventFieldsToInsert(intent.fields, calendarRow.projectId),
                  // A detached child of a LOCAL series is local (fixer review,
                  // MINOR-6): ownership follows the parent, not the transport.
                  origin: parentEvent.origin,
                  parentEventId: parentLink.eventId,
                  originalStartAt: intent.originalStartInstant,
                })
                .returning();

              if (detachedChild) {
                await tx
                  .insert(calendarEventInstances)
                  .values({
                    connectionId: connection.id,
                    caldavCalendarUrl: calendarHref,
                    caldavResourceUrl: intent.resourceHref,
                    caldavRecurrenceId: intent.originalStartInstant.toISOString(),
                    localParentEventId: parentLink.eventId,
                    localOriginalStartAt: intent.originalStartInstant,
                    localDetachedEventId: detachedChild.id,
                    mappingStatus: "detached",
                    caldavEtag: intent.etag,
                    caldavUpdatedAt: intent.updatedAt ?? null,
                    lastSyncedLocalUpdatedAt: detachedChild.updatedAt,
                    syncStatus: "synced",
                  })
                  .onConflictDoUpdate({
                    target: [
                      calendarEventInstances.localParentEventId,
                      calendarEventInstances.localOriginalStartAt,
                    ],
                    set: {
                      localDetachedEventId: detachedChild.id,
                      mappingStatus: "detached",
                      caldavEtag: intent.etag,
                      caldavUpdatedAt: intent.updatedAt ?? null,
                      lastSyncedLocalUpdatedAt: detachedChild.updatedAt,
                      syncStatus: "synced",
                      updatedAt: new Date(),
                    },
                  });
              }
            }
          }
        } else if (intent.kind === "cancel_instance") {
          const [parentLink] = await tx
            .select()
            .from(eventExternalLinks)
            .where(
              and(
                eq(eventExternalLinks.connectionId, connection.id),
                eq(eventExternalLinks.caldavCalendarUrl, calendarHref),
                eq(eventExternalLinks.caldavResourceUrl, intent.resourceHref),
              ),
            );

          if (parentLink) {
            await tx
              .insert(calendarEventInstances)
              .values({
                connectionId: connection.id,
                caldavCalendarUrl: calendarHref,
                caldavResourceUrl: intent.resourceHref,
                caldavRecurrenceId: intent.originalStartInstant.toISOString(),
                localParentEventId: parentLink.eventId,
                localOriginalStartAt: intent.originalStartInstant,
                localDetachedEventId: null,
                mappingStatus: "cancelled",
                caldavEtag: intent.etag,
                caldavUpdatedAt: intent.updatedAt ?? null,
                syncStatus: "synced",
              })
              .onConflictDoUpdate({
                target: [
                  calendarEventInstances.localParentEventId,
                  calendarEventInstances.localOriginalStartAt,
                ],
                set: {
                  localDetachedEventId: null,
                  mappingStatus: "cancelled",
                  caldavEtag: intent.etag,
                  caldavUpdatedAt: intent.updatedAt ?? null,
                  syncStatus: "synced",
                  updatedAt: new Date(),
                },
              });

            // Delete pre-expanded occurrence if any
            await tx
              .delete(occurrences)
              .where(
                and(
                  eq(occurrences.parentType, "event"),
                  eq(occurrences.parentId, parentLink.eventId),
                  eq(occurrences.occursAt, intent.originalStartInstant),
                ),
              );
          }
        }
      }
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

// -----------------------------------------------------------------------------
// GOOGLE SYNC ENGINE
// -----------------------------------------------------------------------------

interface ApplyContext {
  tx: Db;
  connectionId: string;
  googleCalendarId: string;
  defaultProjectId: string | null;
  seenLinkKeys: Set<string>;
  seenInstanceKeys: Set<string>;
  /** Captured before the first listEvents call -- see reconcileFullSync (MAJOR-C). */
  listStartedAt: Date;
}

/**
 * Finds the link a still-pending push is about to claim for this Google id
 * (fixer review, BLOCKER-1). The push job pre-derives the remote id from the
 * link row (`desiredGoogleEventId(link.id)`) and stores `google_event_id`
 * only after a confirmed response, so between a lost response and the retry
 * the remote event exists under an id that NO link carries yet. Looking the
 * event up by `google_event_id` alone therefore inserted a second `events`
 * row plus a link claiming the same id -- and the retry's own id write then
 * collided on `event_external_links_connection_calendar_event_idx` and
 * dead-lettered for ever.
 */
async function findPendingLinkForGoogleId(
  ctx: ApplyContext,
  googleEventId: string,
): Promise<typeof eventExternalLinks.$inferSelect | undefined> {
  const [link] = await ctx.tx
    .select()
    .from(eventExternalLinks)
    .where(
      and(
        eq(eventExternalLinks.connectionId, ctx.connectionId),
        eq(eventExternalLinks.googleCalendarId, ctx.googleCalendarId),
        isNull(eventExternalLinks.googleEventId),
        sql`replace(${eventExternalLinks.id}::text, '-', '') = ${googleEventId}`,
      ),
    );
  return link;
}

/**
 * Adopts a pending link for the remote event its push created: stores the
 * provider identifiers and the remote baseline, sets the local baseline to
 * the row's CURRENT `updated_at` (local is what the remote is a copy of), and
 * leaves `sync_status` untouched -- `pending_push` stays pending so the retry
 * finishes cleanly, and its unconditional id write is then a no-op rather
 * than a 23505. Nothing from the remote is applied.
 */
async function adoptPendingGoogleLink(
  ctx: ApplyContext,
  link: typeof eventExternalLinks.$inferSelect,
  event: GoogleCalendarEvent,
): Promise<void> {
  const [localEvent] = await ctx.tx
    .select({ updatedAt: events.updatedAt })
    .from(events)
    .where(eq(events.id, link.eventId));
  await ctx.tx
    .update(eventExternalLinks)
    .set({
      googleEventId: event.id,
      googleIcalUid: event.iCalUID ?? null,
      googleEtag: event.etag,
      googleUpdatedAt: new Date(event.updated),
      lastSyncedLocalUpdatedAt: localEvent?.updatedAt ?? new Date(),
    })
    .where(eq(eventExternalLinks.id, link.id));
  log.info("calendar.sync_calendar.adopted_pending_link", {
    provider: "google",
    linkId: link.id,
    eventId: link.eventId,
    syncStatus: link.syncStatus,
  });
}

/** The CalDAV twin of adoptPendingGoogleLink, keyed on the deterministic href. */
async function adoptPendingCaldavLink(
  db: Db,
  connectionId: string,
  calendarHref: string,
  resourceHref: string,
  remote: { icalUid: string | null; etag: string; updatedAt: Date | undefined },
): Promise<boolean> {
  const pending = await db
    .select()
    .from(eventExternalLinks)
    .where(
      and(
        eq(eventExternalLinks.connectionId, connectionId),
        eq(eventExternalLinks.caldavCalendarUrl, calendarHref),
        isNull(eventExternalLinks.caldavResourceUrl),
      ),
    );
  const link = pending.find(
    (candidate) => desiredCaldavResourceHref(calendarHref, candidate.id) === resourceHref,
  );
  if (!link) return false;
  const [localEvent] = await db
    .select({ updatedAt: events.updatedAt })
    .from(events)
    .where(eq(events.id, link.eventId));
  await db
    .update(eventExternalLinks)
    .set({
      caldavResourceUrl: resourceHref,
      caldavIcalUid: remote.icalUid,
      caldavEtag: remote.etag,
      caldavUpdatedAt: remote.updatedAt ?? null,
      lastSyncedLocalUpdatedAt: localEvent?.updatedAt ?? new Date(),
    })
    .where(eq(eventExternalLinks.id, link.id));
  log.info("calendar.sync_calendar.adopted_pending_link", {
    provider: "caldav",
    linkId: link.id,
    eventId: link.eventId,
    syncStatus: link.syncStatus,
  });
  return true;
}

async function applyOneItem(
  ctx: ApplyContext,
  event: GoogleCalendarEvent,
  defaultTimezone: string,
): Promise<void> {
  if (event.status === "cancelled" && !event.recurringEventId) {
    ctx.seenLinkKeys.add(event.id);
    const [byId] = await ctx.tx
      .select()
      .from(eventExternalLinks)
      .where(
        and(
          eq(eventExternalLinks.connectionId, ctx.connectionId),
          eq(eventExternalLinks.googleCalendarId, ctx.googleCalendarId),
          eq(eventExternalLinks.googleEventId, event.id),
        ),
      );
    // A cancelled remote event matching a PENDING link is someone deleting
    // our just-created event remotely: archive + unlink, as for any link.
    const link = byId ?? (await findPendingLinkForGoogleId(ctx, event.id));
    if (link) {
      await ctx.tx
        .update(events)
        .set({ archivedAt: new Date() })
        .where(eq(events.id, link.eventId));
      await ctx.tx.delete(eventExternalLinks).where(eq(eventExternalLinks.id, link.id));
    }
    return;
  }

  const classification = classifyGoogleEvent(event);
  const intent = mapGoogleEventToLocalUpsert(event, classification, {
    defaultTimezone,
    existingTimezone: await existingLinkedZone(ctx, event),
  });
  if (intent.kind === "upsert_standalone_or_master") {
    await applyUpsertMaster(ctx, event, intent);
  } else if (intent.kind === "detach_instance") {
    await applyDetachInstance(ctx, event, intent);
  } else if (intent.kind === "cancel_instance") {
    await applyCancelInstance(ctx, event, intent);
  }
}

/**
 * The zone of the local row this Google event already maps to, if any, so
 * the translation resolves a zone-less payload (all-day) where the row lives
 * rather than in `defaultTimezone` (fixer review, MAJOR-D). A detached
 * instance reads its parent's zone. Undefined for a never-seen event.
 */
async function existingLinkedZone(
  ctx: ApplyContext,
  event: GoogleCalendarEvent,
): Promise<string | undefined> {
  const remoteId = event.recurringEventId ?? event.id;
  const [byId] = await ctx.tx
    .select({ eventId: eventExternalLinks.eventId })
    .from(eventExternalLinks)
    .where(
      and(
        eq(eventExternalLinks.connectionId, ctx.connectionId),
        eq(eventExternalLinks.googleCalendarId, ctx.googleCalendarId),
        eq(eventExternalLinks.googleEventId, remoteId),
      ),
    );
  const link = byId ?? (await findPendingLinkForGoogleId(ctx, remoteId));
  if (!link) return undefined;
  const [row] = await ctx.tx
    .select({ timezone: events.timezone, recurrenceTimezone: events.recurrenceTimezone })
    .from(events)
    .where(eq(events.id, link.eventId));
  return row ? existingZoneOf(row as typeof events.$inferSelect) : undefined;
}

async function applyUpsertMaster(
  ctx: ApplyContext,
  event: GoogleCalendarEvent,
  intent: Extract<LocalMutationIntent, { kind: "upsert_standalone_or_master" }>,
): Promise<void> {
  ctx.seenLinkKeys.add(event.id);

  const [byId] = await ctx.tx
    .select()
    .from(eventExternalLinks)
    .where(
      and(
        eq(eventExternalLinks.connectionId, ctx.connectionId),
        eq(eventExternalLinks.googleCalendarId, ctx.googleCalendarId),
        eq(eventExternalLinks.googleEventId, event.id),
      ),
    );
  const pendingLink = byId ? undefined : await findPendingLinkForGoogleId(ctx, event.id);
  const link = byId ?? pendingLink;

  if (event.status === "cancelled") {
    if (!link) return;
    await ctx.tx.update(events).set({ archivedAt: new Date() }).where(eq(events.id, link.eventId));
    await ctx.tx.delete(eventExternalLinks).where(eq(eventExternalLinks.id, link.id));
    return;
  }

  if (pendingLink) {
    await adoptPendingGoogleLink(ctx, pendingLink, event);
    return;
  }

  if (!link) {
    const [created] = await ctx.tx
      .insert(events)
      .values(localEventFieldsToInsert(intent.fields, ctx.defaultProjectId))
      .returning();
    if (!created) return;

    await ctx.tx.insert(eventExternalLinks).values({
      eventId: created.id,
      connectionId: ctx.connectionId,
      googleCalendarId: ctx.googleCalendarId,
      googleEventId: event.id,
      googleIcalUid: event.iCalUID ?? null,
      googleEtag: intent.fields.googleEtag,
      googleUpdatedAt: intent.fields.googleUpdated,
      lastSyncedLocalUpdatedAt: created.updatedAt,
      syncStatus: "synced",
    });
    return;
  }

  const [localEvent] = await ctx.tx.select().from(events).where(eq(events.id, link.eventId));
  if (!localEvent) return;

  const decision = decideConflict(
    localEvent.updatedAt,
    link.lastSyncedLocalUpdatedAt,
    intent.fields.googleUpdated,
    link.googleUpdatedAt,
  );

  if (decision === "noop_neither_changed" || decision === "noop_local_wins") return;

  if (decision === "conflict") {
    // Both sides changed and neither timestamp is later (Checkpoint 9.5):
    // mirror the CalDAV branch -- record the conflict on the link and apply
    // NOTHING, so the local edit is never silently overwritten by the remote
    // one. The link stays parked until a later local edit re-arms it
    // (pending_push) or the remote moves on (a strictly later `updated`).
    await ctx.tx
      .update(eventExternalLinks)
      .set({
        syncStatus: "conflict",
        lastSyncError: "conflict" satisfies CalendarSyncErrorCode,
      })
      .where(eq(eventExternalLinks.id, link.id));
    return;
  }

  const [updated] = await ctx.tx
    .update(events)
    .set(localEventFieldsToUpdate(intent.fields, localEvent))
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

    if (decision === "conflict") {
      // Same rule as the master path: park, never overwrite.
      await ctx.tx
        .update(calendarEventInstances)
        .set({
          syncStatus: "conflict",
          lastSyncError: "conflict" satisfies CalendarSyncErrorCode,
        })
        .where(eq(calendarEventInstances.id, instanceRow.id));
      return;
    }

    const [updatedChild] = await ctx.tx
      .update(events)
      .set(localEventFieldsToUpdate(intent.fields, childEvent))
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
  if (!parentLink) return;

  const [parentEvent] = await ctx.tx.select().from(events).where(eq(events.id, parentLink.eventId));
  if (!parentEvent) return;

  const [detachedChild] = await ctx.tx
    .insert(events)
    .values({
      ...localEventFieldsToInsert(intent.fields, ctx.defaultProjectId),
      // A detached child of a LOCAL series is local (fixer review, MINOR-6):
      // ownership follows the parent, not the transport that delivered it.
      origin: parentEvent.origin,
      parentEventId: parentEvent.id,
      originalStartAt: intent.originalStartInstant,
    })
    .returning();
  if (!detachedChild) return;

  const exdateStr = googleExdateInstantToLocalDate(
    intent.originalStartInstant,
    parentEvent.timezone,
  );
  const currentExdates = parentEvent.recurrenceExdates ?? [];
  if (!currentExdates.includes(exdateStr)) {
    await ctx.tx
      .update(events)
      .set({
        recurrenceExdates: [...currentExdates, exdateStr],
        updatedAt: new Date(),
      })
      .where(eq(events.id, parentEvent.id));
  }

  await ctx.tx
    .insert(calendarEventInstances)
    .values({
      connectionId: ctx.connectionId,
      googleCalendarId: ctx.googleCalendarId,
      googleMasterEventId: intent.parentGoogleEventId,
      googleInstanceEventId: event.id,
      googleOriginalStartTime: intent.originalStartInstant,
      localParentEventId: parentEvent.id,
      localOriginalStartAt: intent.originalStartInstant,
      localDetachedEventId: detachedChild.id,
      mappingStatus: "detached",
      googleEtag: intent.fields.googleEtag,
      googleUpdatedAt: intent.fields.googleUpdated,
      lastSyncedLocalUpdatedAt: detachedChild.updatedAt,
      syncStatus: "synced",
    })
    .onConflictDoUpdate({
      target: [
        calendarEventInstances.connectionId,
        calendarEventInstances.googleCalendarId,
        calendarEventInstances.googleInstanceEventId,
      ],
      set: {
        localDetachedEventId: detachedChild.id,
        mappingStatus: "detached",
        googleEtag: intent.fields.googleEtag,
        googleUpdatedAt: intent.fields.googleUpdated,
        lastSyncedLocalUpdatedAt: detachedChild.updatedAt,
        syncStatus: "synced",
        updatedAt: new Date(),
      },
    });
}

async function applyCancelInstance(
  ctx: ApplyContext,
  event: GoogleCalendarEvent,
  intent: Extract<LocalMutationIntent, { kind: "cancel_instance" }>,
): Promise<void> {
  ctx.seenInstanceKeys.add(event.id);

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
  if (!parentLink) return;

  const [parentEvent] = await ctx.tx.select().from(events).where(eq(events.id, parentLink.eventId));

  if (parentEvent) {
    const exdateStr = googleExdateInstantToLocalDate(
      intent.originalStartInstant,
      parentEvent.timezone,
    );
    const currentExdates = parentEvent.recurrenceExdates ?? [];
    if (!currentExdates.includes(exdateStr)) {
      await ctx.tx
        .update(events)
        .set({
          recurrenceExdates: [...currentExdates, exdateStr],
          updatedAt: new Date(),
        })
        .where(eq(events.id, parentEvent.id));
    }
  }

  await ctx.tx
    .insert(calendarEventInstances)
    .values({
      connectionId: ctx.connectionId,
      googleCalendarId: ctx.googleCalendarId,
      googleMasterEventId: intent.parentGoogleEventId,
      googleInstanceEventId: event.id,
      googleOriginalStartTime: intent.originalStartInstant,
      localParentEventId: parentLink.eventId,
      localOriginalStartAt: intent.originalStartInstant,
      localDetachedEventId: null,
      mappingStatus: "cancelled",
      googleEtag: event.etag,
      googleUpdatedAt: new Date(event.updated),
      syncStatus: "synced",
    })
    .onConflictDoUpdate({
      target: [
        calendarEventInstances.connectionId,
        calendarEventInstances.googleCalendarId,
        calendarEventInstances.googleInstanceEventId,
      ],
      set: {
        localDetachedEventId: null,
        mappingStatus: "cancelled",
        googleEtag: event.etag,
        googleUpdatedAt: new Date(event.updated),
        syncStatus: "synced",
        updatedAt: new Date(),
      },
    });

  await ctx.tx
    .delete(occurrences)
    .where(
      and(
        eq(occurrences.parentType, "event"),
        eq(occurrences.parentId, parentLink.eventId),
        eq(occurrences.occursAt, intent.originalStartInstant),
      ),
    );
}

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
    // Only a link that was SYNCED before the listing began can be "absent
    // from the listing" (fixer review, MAJOR-C). A push that completed after
    // `listStartedAt` stamped an id the listing could not contain; archiving
    // that would delete the owner's just-created event on its first sync.
    // `synced` alone also excludes a still-pending link, whose id is null.
    if (
      link.googleEventId &&
      !ctx.seenLinkKeys.has(link.googleEventId) &&
      link.syncStatus === "synced" &&
      link.updatedAt.getTime() < ctx.listStartedAt.getTime()
    ) {
      await ctx.tx
        .update(events)
        .set({ archivedAt: new Date() })
        .where(eq(events.id, link.eventId));
      await ctx.tx.delete(eventExternalLinks).where(eq(eventExternalLinks.id, link.id));
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
    if (
      instance.googleInstanceEventId &&
      !ctx.seenInstanceKeys.has(instance.googleInstanceEventId) &&
      instance.syncStatus === "synced" &&
      instance.updatedAt.getTime() < ctx.listStartedAt.getTime()
    ) {
      if (instance.localDetachedEventId) {
        await ctx.tx
          .update(events)
          .set({ archivedAt: new Date() })
          .where(eq(events.id, instance.localDetachedEventId));
      }
      await ctx.tx.delete(calendarEventInstances).where(eq(calendarEventInstances.id, instance.id));
    }
  }
}

export async function runCalendarSync(
  deps: { db: Db; client: GoogleCalendarClient; caldavClient?: CalDavClient; boss?: PgBoss },
  data: CalendarSyncCalendarJobData,
): Promise<void> {
  const { db, client, caldavClient, boss } = deps;

  const [connection] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, data.connectionId));
  if (!connection || connection.status !== "active") return;

  const [calendarRow] = await db
    .select()
    .from(calendarConnectionCalendars)
    .where(eq(calendarConnectionCalendars.id, data.calendarConnectionCalendarId));
  if (!calendarRow || !calendarRow.syncEnabled) return;

  if (connection.provider === "caldav" && caldavClient) {
    await runCaldavSync(db, caldavClient, connection, calendarRow);
    return;
  }

  let accessToken: string;
  try {
    accessToken = await resolveFreshAccessToken(db, connection);
  } catch (err) {
    if (err instanceof GoogleOAuthError && err.isPermanent) {
      // Through the ONE shared, `status = 'active'`-conditional transition
      // (Checkpoint 9.5), so this job mints the same ADR-058 episode key the
      // refresh-token job would and never re-stamps `updated_at` on a retry.
      // Never err.message: for Google that is `error_description`, i.e.
      // vendor prose lifted verbatim out of the token endpoint's JSON body,
      // and this column is projected by GET /calendar-connections.
      await markNeedsReauth(db, boss, connection.id, classifyCalendarProviderError(err));
      return;
    }
    throw err;
  }

  let isFullSync = !calendarRow.nextSyncToken;
  let syncToken = calendarRow.nextSyncToken ?? undefined;
  const items: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  let finalSyncToken: string | undefined;
  // BEFORE the first provider read -- see reconcileFullSync (MAJOR-C).
  const listStartedAt = new Date();

  for (;;) {
    let page;
    try {
      page = await client.listEvents(accessToken, {
        calendarId: calendarRow.googleCalendarId!,
        syncToken: isFullSync ? undefined : syncToken,
        pageToken,
      });
    } catch (err) {
      if (err instanceof GoogleSyncTokenExpiredError) {
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

  // Last resort only (fixer review, MAJOR-D): a payload that carries no zone
  // is resolved in the EXISTING linked row's zone first -- see applyOneItem.
  const defaultTimezone = "UTC";

  await db.transaction(async (tx) => {
    const ctx: ApplyContext = {
      tx: tx as unknown as Db,
      connectionId: connection.id,
      googleCalendarId: calendarRow.googleCalendarId!,
      defaultProjectId: calendarRow.projectId,
      seenLinkKeys: new Set(),
      seenInstanceKeys: new Set(),
      listStartedAt,
    };

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
  caldavClient?: CalDavClient,
  boss?: PgBoss,
): (jobs: Job<CalendarSyncCalendarJobData>[]) => Promise<void> {
  // Nothing provider-authored may reach pgboss.job.output -- see
  // calendar-job-error.ts.
  return withCalendarJobErrorContainment(
    CALENDAR_SYNC_CALENDAR_QUEUE,
    createCalendarSyncCalendarHandlerUncontained(db, client, caldavClient, boss),
  );
}

function createCalendarSyncCalendarHandlerUncontained(
  db: Db,
  client: GoogleCalendarClient,
  caldavClient?: CalDavClient,
  boss?: PgBoss,
): (jobs: Job<CalendarSyncCalendarJobData>[]) => Promise<void> {
  return async function handleCalendarSyncCalendar(jobs) {
    for (const job of jobs) {
      await runCalendarSync({ db, client, caldavClient, boss }, job.data);
    }
  };
}

export function createCalendarSyncCalendarDeadLetterHandler(
  db: Db,
): (jobs: Job<CalendarSyncCalendarJobData>[]) => Promise<void> {
  return async function handleCalendarSyncCalendarDead(jobs) {
    for (const job of jobs) {
      await db
        .update(calendarConnections)
        .set({
          lastSyncError: "retries_exhausted" satisfies CalendarSyncErrorCode,
          updatedAt: new Date(),
        })
        // `status = 'active'`-GUARDED as of Checkpoint 8.1, for the same reason
        // as the twin handler in calendar-refresh-token.ts: `updated_at` is the
        // episode discriminator in the needs-reauth alert key, so an unguarded
        // write here could move it mid-episode and mint a second key for one
        // failure. It also stops a specific classification being downgraded to
        // the generic `retries_exhausted` after the connection already failed.
        .where(
          and(
            eq(calendarConnections.id, job.data.connectionId),
            eq(calendarConnections.status, "active"),
          ),
        );
    }
  };
}

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
      caldavCalendarUrl: calendarConnectionCalendars.caldavCalendarUrl,
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
    const calKey = row.googleCalendarId || row.caldavCalendarUrl || row.calendarId;
    await boss.send(
      queueName,
      { connectionId: row.connectionId, calendarConnectionCalendarId: row.calendarId },
      { singletonKey: `${row.connectionId}:${calKey}` },
    );
  }
}
