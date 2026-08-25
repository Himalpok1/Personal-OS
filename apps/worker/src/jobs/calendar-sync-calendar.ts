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

function localEventFieldsToUpdate(
  fields: LocalEventFields | CalDavEventFields,
): Partial<typeof events.$inferInsert> {
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
    recurrenceUntil: fields.recurrenceUntil ?? null,
    recurrenceCount: fields.recurrenceCount ?? null,
    recurrenceTimezone: fields.recurrenceTimezone ?? null,
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

    // Identify deleted remotely
    for (const link of existingLinks) {
      if (link.caldavResourceUrl && !inventoryMap.has(link.caldavResourceUrl)) {
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
                .set({ syncStatus: "conflict", lastSyncError: "Conflict detected on CalDAV sync" })
                .where(eq(eventExternalLinks.id, existingLink.id));
              continue;
            }

            const [updated] = await tx
              .update(events)
              .set(localEventFieldsToUpdate(intent.fields))
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
              await tx
                .update(events)
                .set(localEventFieldsToUpdate(intent.fields))
                .where(eq(events.id, existingInstance.localDetachedEventId));

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
              const [detachedChild] = await tx
                .insert(events)
                .values({
                  ...localEventFieldsToInsert(intent.fields, calendarRow.projectId),
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
}

async function applyOneItem(
  ctx: ApplyContext,
  event: GoogleCalendarEvent,
  defaultTimezone: string,
): Promise<void> {
  if (event.status === "cancelled" && !event.recurringEventId) {
    ctx.seenLinkKeys.add(event.id);
    const [link] = await ctx.tx
      .select()
      .from(eventExternalLinks)
      .where(
        and(
          eq(eventExternalLinks.connectionId, ctx.connectionId),
          eq(eventExternalLinks.googleCalendarId, ctx.googleCalendarId),
          eq(eventExternalLinks.googleEventId, event.id),
        ),
      );
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
  });
  if (intent.kind === "upsert_standalone_or_master") {
    await applyUpsertMaster(ctx, event, intent);
  } else if (intent.kind === "detach_instance") {
    await applyDetachInstance(ctx, event, intent);
  } else if (intent.kind === "cancel_instance") {
    await applyCancelInstance(ctx, event, intent);
  }
}

async function applyUpsertMaster(
  ctx: ApplyContext,
  event: GoogleCalendarEvent,
  intent: Extract<LocalMutationIntent, { kind: "upsert_standalone_or_master" }>,
): Promise<void> {
  ctx.seenLinkKeys.add(event.id);

  const [link] = await ctx.tx
    .select()
    .from(eventExternalLinks)
    .where(
      and(
        eq(eventExternalLinks.connectionId, ctx.connectionId),
        eq(eventExternalLinks.googleCalendarId, ctx.googleCalendarId),
        eq(eventExternalLinks.googleEventId, event.id),
      ),
    );

  if (event.status === "cancelled") {
    if (!link) return;
    await ctx.tx.update(events).set({ archivedAt: new Date() }).where(eq(events.id, link.eventId));
    await ctx.tx.delete(eventExternalLinks).where(eq(eventExternalLinks.id, link.id));
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
  if (!parentLink) return;

  const [parentEvent] = await ctx.tx.select().from(events).where(eq(events.id, parentLink.eventId));
  if (!parentEvent) return;

  const [detachedChild] = await ctx.tx
    .insert(events)
    .values({
      ...localEventFieldsToInsert(intent.fields, ctx.defaultProjectId),
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
    if (link.googleEventId && !ctx.seenLinkKeys.has(link.googleEventId)) {
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
      !ctx.seenInstanceKeys.has(instance.googleInstanceEventId)
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
  deps: { db: Db; client: GoogleCalendarClient; caldavClient?: CalDavClient },
  data: CalendarSyncCalendarJobData,
): Promise<void> {
  const { db, client, caldavClient } = deps;

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
      await db
        .update(calendarConnections)
        .set({
          status: "needs_reauth",
          // Never err.message: for Google that is `error_description`, i.e.
          // vendor prose lifted verbatim out of the token endpoint's JSON
          // body, and this column is projected by GET /calendar-connections.
          lastSyncError: classifyCalendarProviderError(err),
          updatedAt: new Date(),
        })
        .where(eq(calendarConnections.id, connection.id));
      return;
    }
    throw err;
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

  const defaultTimezone = "UTC";

  await db.transaction(async (tx) => {
    const ctx: ApplyContext = {
      tx: tx as unknown as Db,
      connectionId: connection.id,
      googleCalendarId: calendarRow.googleCalendarId!,
      defaultProjectId: calendarRow.projectId,
      seenLinkKeys: new Set(),
      seenInstanceKeys: new Set(),
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
): (jobs: Job<CalendarSyncCalendarJobData>[]) => Promise<void> {
  // Nothing provider-authored may reach pgboss.job.output -- see
  // calendar-job-error.ts.
  return withCalendarJobErrorContainment(
    CALENDAR_SYNC_CALENDAR_QUEUE,
    createCalendarSyncCalendarHandlerUncontained(db, client, caldavClient),
  );
}

function createCalendarSyncCalendarHandlerUncontained(
  db: Db,
  client: GoogleCalendarClient,
  caldavClient?: CalDavClient,
): (jobs: Job<CalendarSyncCalendarJobData>[]) => Promise<void> {
  return async function handleCalendarSyncCalendar(jobs) {
    for (const job of jobs) {
      await runCalendarSync({ db, client, caldavClient }, job.data);
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
        .where(eq(calendarConnections.id, job.data.connectionId));
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
