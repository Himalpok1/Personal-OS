import { decryptSecret, encryptSecret } from "@personal-os/ai-providers";
import {
  applyExceptionToVCalendar,
  CalDavError,
  GoogleCalendarApiError,
  GoogleOAuthError,
  localAllDayToGoogle,
  localEventToVCalendar,
  refreshAccessToken,
  type CalDavClient,
  type GoogleCalendarClient,
  type GoogleEventWriteBody,
} from "@personal-os/calendar-providers";
import {
  calendarConnections,
  calendarEventInstances,
  eventExternalLinks,
  events,
  type Db,
} from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { env } from "../env.js";

export interface CalendarPushEventJobData {
  eventId: string;
}

const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;

async function resolveFreshAccessToken(
  db: Db,
  connection: typeof calendarConnections.$inferSelect,
): Promise<string> {
  const hasAccessToken =
    connection.accessTokenCiphertext && connection.accessTokenIv && connection.accessTokenAuthTag;
  const expiresAt = connection.accessTokenExpiresAt;
  const isExpiring =
    !hasAccessToken ||
    !expiresAt ||
    expiresAt.getTime() - Date.now() < TOKEN_EXPIRY_SAFETY_MARGIN_MS;

  if (
    !isExpiring &&
    connection.accessTokenCiphertext &&
    connection.accessTokenIv &&
    connection.accessTokenAuthTag
  ) {
    return decryptSecret(
      {
        ciphertext: connection.accessTokenCiphertext,
        iv: connection.accessTokenIv,
        authTag: connection.accessTokenAuthTag,
      },
      env.CREDENTIALS_ENCRYPTION_KEY,
    );
  }

  if (
    !connection.refreshTokenCiphertext ||
    !connection.refreshTokenIv ||
    !connection.refreshTokenAuthTag
  ) {
    throw new GoogleOAuthError(
      `calendar_connections ${connection.id} has no refresh token and its access token is expired`,
      401,
      "invalid_grant",
    );
  }
  const refreshToken = decryptSecret(
    {
      ciphertext: connection.refreshTokenCiphertext,
      iv: connection.refreshTokenIv,
      authTag: connection.refreshTokenAuthTag,
    },
    env.CREDENTIALS_ENCRYPTION_KEY,
  );
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

function eventRowToGoogleWriteBody(
  row: typeof events.$inferSelect,
  parentGoogleEventId?: string,
): GoogleEventWriteBody {
  const isInstance = row.parentEventId !== null && row.originalStartAt !== null;

  if (row.allDay) {
    if (!row.startDate) {
      throw new Error(`event ${row.id} has all_day=true but no start_date`);
    }
    const { googleStartDate, googleEndDate } = localAllDayToGoogle(
      row.startDate,
      row.endDate ?? row.startDate,
    );
    const body: GoogleEventWriteBody = {
      summary: row.title,
      description: row.description ?? undefined,
      location: row.location ?? undefined,
      start: { date: googleStartDate },
      end: { date: googleEndDate },
    };
    if (isInstance && parentGoogleEventId && row.originalStartAt) {
      body.recurringEventId = parentGoogleEventId;
      body.originalStartTime = {
        date: row.originalStartAt.toISOString().slice(0, 10),
      };
    }
    return body;
  }

  if (!row.startsAt) {
    throw new Error(`event ${row.id} has all_day=false but no starts_at`);
  }
  const timeZone = row.timezone ?? "UTC";
  const startDateTime = row.startsAt.toISOString();
  const endDateTime = (row.endsAt ?? row.startsAt).toISOString();
  const body: GoogleEventWriteBody = {
    summary: row.title,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    start: { dateTime: startDateTime, timeZone },
    end: { dateTime: endDateTime, timeZone },
  };
  if (isInstance && parentGoogleEventId && row.originalStartAt) {
    body.recurringEventId = parentGoogleEventId;
    body.originalStartTime = {
      dateTime: row.originalStartAt.toISOString(),
      timeZone,
    };
  }
  return body;
}

export function createCalendarPushEventHandler(
  db: Db,
  googleClient: GoogleCalendarClient,
  caldavClient?: CalDavClient,
): (jobs: Job<CalendarPushEventJobData>[]) => Promise<void> {
  return async function handleCalendarPushEvent(jobs) {
    for (const job of jobs) {
      const [link] = await db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.eventId, job.data.eventId));
      if (!link) continue;

      const [connection] = await db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, link.connectionId));
      if (!connection) continue;

      if (connection.status !== "active") {
        await db
          .update(eventExternalLinks)
          .set({
            syncStatus: "error",
            lastSyncError: `calendar connection is ${connection.status}`,
          })
          .where(eq(eventExternalLinks.id, link.id));
        continue;
      }

      // -----------------------------------------------------------------------
      // CALDAV PROVIDER PUSH
      // -----------------------------------------------------------------------
      if (connection.provider === "caldav" && caldavClient) {
        if (
          !connection.passwordCiphertext ||
          !connection.passwordIv ||
          !connection.passwordAuthTag
        ) {
          continue;
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

        const [row] = await db.select().from(events).where(eq(events.id, job.data.eventId));

        if (!row || row.archivedAt) {
          if (link.caldavResourceUrl) {
            try {
              await caldavClient.deleteEvent(
                link.caldavResourceUrl,
                link.caldavEtag || undefined,
                auth,
              );
            } catch (err: unknown) {
              if (!(err instanceof CalDavError && err.status === 404)) {
                throw err;
              }
            }
          }
          await db.delete(eventExternalLinks).where(eq(eventExternalLinks.id, link.id));
          continue;
        }

        // Outbound push for detached occurrence
        if (row.parentEventId && row.originalStartAt) {
          const [parentLink] = await db
            .select()
            .from(eventExternalLinks)
            .where(eq(eventExternalLinks.eventId, row.parentEventId));

          if (parentLink?.caldavResourceUrl) {
            const parentEvent = await caldavClient.getEvent(parentLink.caldavResourceUrl, auth);
            const modifiedIcs = applyExceptionToVCalendar(parentEvent.icsData, {
              kind: "detach",
              originalStartInstant: row.originalStartAt,
              fields: {
                title: row.title,
                description: row.description,
                location: row.location,
                allDay: row.allDay,
                startsAt: row.startsAt ?? undefined,
                endsAt: row.endsAt ?? undefined,
                startDate: row.startDate ?? undefined,
                endDate: row.endDate ?? undefined,
                timezone: row.timezone ?? undefined,
              },
            });

            const putRes = await caldavClient.putEvent(
              parentLink.caldavResourceUrl,
              modifiedIcs,
              parentLink.caldavEtag || undefined,
              auth,
            );

            await db
              .update(eventExternalLinks)
              .set({
                caldavEtag: putRes.etag,
                lastSyncedLocalUpdatedAt: row.updatedAt,
                syncStatus: "synced",
                updatedAt: new Date(),
              })
              .where(eq(eventExternalLinks.id, parentLink.id));

            await db
              .insert(calendarEventInstances)
              .values({
                connectionId: link.connectionId,
                caldavCalendarUrl: link.caldavCalendarUrl,
                caldavResourceUrl: parentLink.caldavResourceUrl,
                caldavRecurrenceId: row.originalStartAt.toISOString(),
                localParentEventId: row.parentEventId,
                localOriginalStartAt: row.originalStartAt,
                localDetachedEventId: row.id,
                mappingStatus: "detached",
                caldavEtag: putRes.etag,
                lastSyncedLocalUpdatedAt: row.updatedAt,
                syncStatus: "synced",
              })
              .onConflictDoUpdate({
                target: [
                  calendarEventInstances.localParentEventId,
                  calendarEventInstances.localOriginalStartAt,
                ],
                set: {
                  localDetachedEventId: row.id,
                  mappingStatus: "detached",
                  caldavEtag: putRes.etag,
                  lastSyncedLocalUpdatedAt: row.updatedAt,
                  syncStatus: "synced",
                  updatedAt: new Date(),
                },
              });
          }
          continue;
        }

        // Outbound push for master / standalone event
        const isNew = !link.caldavResourceUrl;
        const uid = link.caldavIcalUid || `${crypto.randomUUID()}@personal-os.local`;
        const calendarUrl = link.caldavCalendarUrl || "/";
        const resourceHref =
          link.caldavResourceUrl ||
          `${calendarUrl.endsWith("/") ? calendarUrl : calendarUrl + "/"}${uid.split("@")[0]}.ics`;

        const icsData = localEventToVCalendar({
          title: row.title,
          description: row.description,
          location: row.location,
          allDay: row.allDay,
          startsAt: row.startsAt ?? undefined,
          endsAt: row.endsAt ?? undefined,
          startDate: row.startDate ?? undefined,
          endDate: row.endDate ?? undefined,
          timezone: row.timezone ?? undefined,
          rrule: row.rrule ?? undefined,
          recurrenceUntil: row.recurrenceUntil ?? undefined,
          recurrenceCount: row.recurrenceCount ?? undefined,
          recurrenceExdates: row.recurrenceExdates ?? undefined,
          uid,
          caldavResourceUrl: resourceHref,
          caldavEtag: link.caldavEtag || "",
        });

        try {
          const putRes = await caldavClient.putEvent(
            resourceHref,
            icsData,
            isNew ? undefined : link.caldavEtag || undefined,
            auth,
            isNew ? { ifNoneMatch: true } : undefined,
          );

          await db
            .update(eventExternalLinks)
            .set({
              caldavResourceUrl: resourceHref,
              caldavIcalUid: uid,
              caldavEtag: putRes.etag,
              lastSyncedLocalUpdatedAt: row.updatedAt,
              syncStatus: "synced",
              updatedAt: new Date(),
            })
            .where(eq(eventExternalLinks.id, link.id));
        } catch (err: unknown) {
          if (err instanceof CalDavError && err.isConflict) {
            await db
              .update(eventExternalLinks)
              .set({
                syncStatus: "conflict",
                lastSyncError: "CalDAV PUT 412 Precondition Failed (ETag conflict)",
              })
              .where(eq(eventExternalLinks.id, link.id));
            continue;
          }
          throw err;
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // GOOGLE PROVIDER PUSH
      // -----------------------------------------------------------------------
      let accessToken: string;
      try {
        accessToken = await resolveFreshAccessToken(db, connection);
      } catch (err) {
        if (err instanceof GoogleOAuthError && err.isPermanent) {
          await db
            .update(calendarConnections)
            .set({ status: "needs_reauth", lastSyncError: err.message, updatedAt: new Date() })
            .where(eq(calendarConnections.id, connection.id));
          continue;
        }
        throw err;
      }

      const [row] = await db.select().from(events).where(eq(events.id, job.data.eventId));

      if (!row || row.archivedAt) {
        if (link.googleEventId && link.googleCalendarId) {
          try {
            await googleClient.deleteEvent(accessToken, link.googleCalendarId, link.googleEventId);
          } catch (err) {
            const alreadyGone =
              err instanceof GoogleCalendarApiError &&
              (err.httpStatus === 404 || err.httpStatus === 410);
            if (!alreadyGone) throw err;
          }
        }
        await db.delete(eventExternalLinks).where(eq(eventExternalLinks.id, link.id));
        continue;
      }

      let parentGoogleEventId: string | undefined;
      if (row.parentEventId) {
        const [parentLink] = await db
          .select()
          .from(eventExternalLinks)
          .where(eq(eventExternalLinks.eventId, row.parentEventId));
        if (parentLink?.googleEventId) {
          parentGoogleEventId = parentLink.googleEventId;
        }
      }

      const body = eventRowToGoogleWriteBody(row, parentGoogleEventId);

      const written = link.googleEventId
        ? await googleClient.updateEvent(
            accessToken,
            link.googleCalendarId!,
            link.googleEventId,
            body,
          )
        : await googleClient.insertEvent(accessToken, link.googleCalendarId!, body);

      await db
        .update(eventExternalLinks)
        .set({
          googleEventId: written.id,
          googleIcalUid: written.iCalUID,
          googleEtag: written.etag,
          googleUpdatedAt: new Date(written.updated),
          lastSyncedLocalUpdatedAt: row.updatedAt,
          syncStatus: "synced",
          updatedAt: new Date(),
        })
        .where(eq(eventExternalLinks.id, link.id));

      if (row.parentEventId && row.originalStartAt && parentGoogleEventId) {
        await db
          .insert(calendarEventInstances)
          .values({
            connectionId: link.connectionId,
            googleCalendarId: link.googleCalendarId,
            googleMasterEventId: parentGoogleEventId,
            googleInstanceEventId: written.id,
            googleOriginalStartTime: row.originalStartAt,
            localParentEventId: row.parentEventId,
            localOriginalStartAt: row.originalStartAt,
            localDetachedEventId: row.id,
            mappingStatus: "detached",
            googleEtag: written.etag,
            googleUpdatedAt: new Date(written.updated),
            lastSyncedLocalUpdatedAt: row.updatedAt,
            syncStatus: "synced",
          })
          .onConflictDoUpdate({
            target: [
              calendarEventInstances.connectionId,
              calendarEventInstances.googleCalendarId,
              calendarEventInstances.googleInstanceEventId,
            ],
            set: {
              localDetachedEventId: row.id,
              mappingStatus: "detached",
              googleEtag: written.etag,
              googleUpdatedAt: new Date(written.updated),
              lastSyncedLocalUpdatedAt: row.updatedAt,
              syncStatus: "synced",
              updatedAt: new Date(),
            },
          });
      }
    }
  };
}

export function createCalendarPushEventDeadLetterHandler(
  db: Db,
): (jobs: Job<CalendarPushEventJobData>[]) => Promise<void> {
  return async function handleCalendarPushEventDead(jobs) {
    for (const job of jobs) {
      await db
        .update(eventExternalLinks)
        .set({
          syncStatus: "error",
          lastSyncError: "calendar.push-event: retries exhausted",
        })
        .where(eq(eventExternalLinks.eventId, job.data.eventId));
    }
  };
}
