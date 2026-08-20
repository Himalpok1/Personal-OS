import { decryptSecret, encryptSecret } from "@personal-os/ai-providers";
import {
  GoogleCalendarApiError,
  GoogleOAuthError,
  localAllDayToGoogle,
  refreshAccessToken,
  type GoogleCalendarClient,
  type GoogleEventWriteBody,
} from "@personal-os/calendar-providers";
import {
  calendarConnectionCalendars,
  calendarConnections,
  calendarEventInstances,
  eventExternalLinks,
  events,
  type Db,
} from "@personal-os/db";
import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { env } from "../env.js";

export interface CalendarPushEventJobData {
  eventId: string;
}

const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;

// Same inline-refresh approach as calendar-sync-calendar.ts's
// resolveFreshAccessToken -- duplicated in miniature here rather than
// imported, since the two jobs' surrounding error handling differs enough
// (this one has no "no-op the whole calendar" fallback, only a single
// event to push) that sharing would need its own abstraction; not worth it
// for a ~20-line function. If this drifts out of sync with the
// sync-calendar copy, prefer that file's version as canonical -- it's
// exercised far more (every sync pass, not just pushes).
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

// Reconstitutes a single-line Google `recurrence` array from this app's
// separated rrule/recurrence_until/recurrence_count columns -- the inverse
// of googleRecurrenceToLocal's UNTIL=/COUNT= extraction
// (@personal-os/calendar-providers/translate.ts). UNTIL is always emitted
// in UTC "Z" form (RFC5545 permits this regardless of the rule's own
// recurrence_timezone -- Google's own API does the same).
function buildGoogleRecurrenceLines(row: typeof events.$inferSelect): string[] | undefined {
  if (!row.rrule) return undefined;
  let rrule = row.rrule.startsWith("RRULE:") ? row.rrule.slice("RRULE:".length) : row.rrule;
  if (row.recurrenceUntil) {
    const until = row.recurrenceUntil
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    rrule = `${rrule};UNTIL=${until}`;
  } else if (row.recurrenceCount) {
    rrule = `${rrule};COUNT=${row.recurrenceCount}`;
  }
  return [`RRULE:${rrule}`];
}

function eventRowToGoogleWriteBody(
  row: typeof events.$inferSelect,
  parentGoogleEventId?: string,
): GoogleEventWriteBody {
  const body: GoogleEventWriteBody = {
    summary: row.title,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
  };
  if (row.allDay && row.startDate) {
    const { googleStartDate, googleEndDate } = localAllDayToGoogle(
      row.startDate,
      row.endDate ?? row.startDate,
    );
    body.start = { date: googleStartDate };
    body.end = { date: googleEndDate };
    if (parentGoogleEventId && row.originalStartAt) {
      body.recurringEventId = parentGoogleEventId;
      body.originalStartTime = { date: row.originalStartAt.toISOString().slice(0, 10) };
    }
  } else if (row.startsAt) {
    body.start = { dateTime: row.startsAt.toISOString(), timeZone: row.timezone };
    body.end = { dateTime: (row.endsAt ?? row.startsAt).toISOString(), timeZone: row.timezone };
    if (parentGoogleEventId && row.originalStartAt) {
      body.recurringEventId = parentGoogleEventId;
      body.originalStartTime = {
        dateTime: row.originalStartAt.toISOString(),
        timeZone: row.timezone,
      };
    }
  }
  const recurrence = buildGoogleRecurrenceLines(row);
  if (recurrence) body.recurrence = recurrence;
  return body;
}

export function createCalendarPushEventHandler(
  db: Db,
  client: GoogleCalendarClient,
): (jobs: Job<CalendarPushEventJobData>[]) => Promise<void> {
  return async function handleCalendarPushEvent(jobs) {
    for (const job of jobs) {
      const [link] = await db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.eventId, job.data.eventId));
      // Only pushes events that already have an event_external_links row --
      // never an automatic new-event-to-Google trigger. A local event gains
      // this row only via the explicit POST /events/:id/link-google-calendar
      // route (Decision 9's outbound flow); this job never creates the link
      // itself, only acts once one exists (with googleEventId possibly still
      // null, meaning "linked but never pushed yet" -- see below).
      if (!link) continue;

      const [connection] = await db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, link.connectionId));
      if (!connection || connection.status !== "active") continue;

      const [calendarRow] = await db
        .select()
        .from(calendarConnectionCalendars)
        .where(
          and(
            eq(calendarConnectionCalendars.connectionId, link.connectionId),
            eq(calendarConnectionCalendars.googleCalendarId, link.googleCalendarId),
          ),
        );
      if (!calendarRow || !calendarRow.syncEnabled) continue;

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
        // A link with no googleEventId was never pushed -- there is
        // nothing on Google's side to delete, only the local link row.
        if (link.googleEventId) {
          try {
            await client.deleteEvent(accessToken, link.googleCalendarId, link.googleEventId);
          } catch (err) {
            // 404/410 -- already gone on Google's side. Any other status is
            // a real failure; rethrow to retry.
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

      // No googleEventId yet: this is the link's first push -- the local
      // event was explicitly linked (Decision 9's outbound flow) but never
      // pushed to Google before. Create it there instead of updating.
      const written = link.googleEventId
        ? await client.updateEvent(accessToken, link.googleCalendarId, link.googleEventId, body)
        : await client.insertEvent(accessToken, link.googleCalendarId, body);

      // Advance BOTH halves of the conflict baseline -- this is what
      // prevents the pulled-back echo of this exact push from being
      // misread as a fresh remote change on the next pull-sync pass. Also
      // fills in googleEventId/googleIcalUid on a first-ever push.
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

// Dead-letter: leaves event_external_links.sync_status as whatever it was
// (still "synced" from its last successful round-trip, or "pending_push" if
// a caller set that when enqueuing -- this job never sets pending_push
// itself, since that's an enqueue-time concern for whichever code path
// eventually triggers a push on ordinary local edits, out of this
// checkpoint's scope). Records the failure so it's at least visible.
export function createCalendarPushEventDeadLetterHandler(
  db: Db,
): (jobs: Job<CalendarPushEventJobData>[]) => Promise<void> {
  return async function handleCalendarPushEventDead(jobs) {
    for (const job of jobs) {
      await db
        .update(eventExternalLinks)
        .set({
          syncStatus: "error",
          lastSyncError: "calendar.google.push-event: retries exhausted",
        })
        .where(eq(eventExternalLinks.eventId, job.data.eventId));
    }
  };
}
