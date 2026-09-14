import { decryptSecret, encryptSecret } from "@personal-os/ai-providers";
import {
  applyExceptionToVCalendar,
  CalDavError,
  GoogleCalendarApiError,
  GoogleOAuthError,
  localAllDayToGoogle,
  localEventToVCalendar,
  localRecurrenceToGoogle,
  refreshAccessToken,
  type CalDavClient,
  type GoogleCalendarClient,
  type GoogleCalendarEvent,
  classifyCalendarProviderError,
  type GoogleEventWriteBody,
} from "@personal-os/calendar-providers";
import { toWallClockComponents } from "@personal-os/core/timezone";
import type { CalendarSyncErrorCode } from "@personal-os/schema";
import { CALENDAR_PUSH_EVENT_QUEUE } from "../queue-names.js";
import { withCalendarJobErrorContainment } from "./calendar-job-error.js";
import { markNeedsReauth } from "./calendar-refresh-token.js";
import { alertEligibleDevices } from "./alert-eligible-devices.js";
import {
  calendarConnections,
  calendarEventInstances,
  eventExternalLinks,
  events,
  type Db,
} from "@personal-os/db";
import { and, eq, sql } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { env } from "../env.js";
import { errorToken, log } from "../logger.js";

export interface CalendarPushEventJobData {
  eventId: string;
}

const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;

/**
 * Error classes on which a push is NOT retried (Checkpoint 9.5): the provider
 * has said the request itself is wrong -- the calendar is not writable for
 * this grant, the body is malformed, or the remote event no longer exists --
 * and replaying the identical body cannot change the answer. Everything else
 * (rate limits, 5xx, a timed-out socket, an expired access token the next
 * attempt will refresh) is transient and left to pg-boss's backoff.
 */
const PERMANENT_PUSH_ERRORS: ReadonlySet<CalendarSyncErrorCode> = new Set([
  "missing_scope",
  "invalid_request",
  "not_found",
]);

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

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * The Google event id this link's event is pushed under (Checkpoint 9.5).
 * Derived from the link row rather than minted per attempt, so a retry after
 * a lost response asks Google for the SAME id, gets a 409, and updates rather
 * than duplicating. 32 lowercase hex characters, inside Google's accepted
 * `[a-v0-9]{5,1024}` base32hex alphabet.
 */
export function desiredGoogleEventId(linkId: string): string {
  return linkId.replace(/-/g, "").toLowerCase();
}

/**
 * The CalDAV UID and resource href this link's event is pushed under
 * (Checkpoint 9.5, fixer review BLOCKER-2). Both are DERIVED FROM THE LINK
 * ROW, never minted per attempt: the first design drew a random UUID and
 * persisted it only after the PUT, so a lost response re-PUT under a fresh
 * href and left two VEVENTs on the server. With a deterministic href a retry
 * hits the same resource, gets a 412 from `If-None-Match: *`, and adopts it.
 * The inbound sync uses the same function to recognise a resource that a
 * still-pending link created (see calendar-sync-calendar.ts).
 */
export function desiredCaldavIcalUid(linkId: string): string {
  return `${linkId}@personal-os.local`;
}

export function desiredCaldavResourceHref(calendarUrl: string | null, linkId: string): string {
  const base = calendarUrl || "/";
  return `${base.endsWith("/") ? base : base + "/"}${linkId}.ics`;
}

export function eventRowToGoogleWriteBody(
  row: typeof events.$inferSelect,
  parentGoogleEventId?: string,
): GoogleEventWriteBody {
  const isInstance = row.parentEventId !== null && row.originalStartAt !== null;
  const isMaster = !isInstance && row.rrule !== null && row.rrule.trim().length > 0;
  const recurrenceTimezone = row.recurrenceTimezone ?? row.timezone;

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
    if (isMaster) {
      body.recurrence = localRecurrenceToGoogle({
        rrule: row.rrule!,
        recurrenceUntil: row.recurrenceUntil,
        recurrenceCount: row.recurrenceCount,
        recurrenceExdates: row.recurrenceExdates,
        allDay: true,
        timezone: recurrenceTimezone,
      });
    }
    if (isInstance && parentGoogleEventId && row.originalStartAt) {
      // The LOCAL calendar date of the original instance in the series' own
      // zone -- never `toISOString().slice(0, 10)`, which is the UTC date and
      // is one day early for every evening-anchored instance west of Greenwich
      // (ADR-042/045: the all-day anchor is local noon, so the UTC date can
      // differ from the local one).
      const { year, month, day } = toWallClockComponents(row.originalStartAt, recurrenceTimezone);
      body.recurringEventId = parentGoogleEventId;
      body.originalStartTime = {
        date: `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`,
      };
    }
    return body;
  }

  if (!row.startsAt) {
    throw new Error(`event ${row.id} has all_day=false but no starts_at`);
  }
  // A recurring master's start/end zone is the RECURRENCE zone (fixer review,
  // MAJOR-E): the EXDATE;TZID lines and the local expansion are both built in
  // `recurrence_timezone`, and Google resolves the RRULE against
  // `start.timeZone`, so sending the event's own zone here would make the
  // rule and its exceptions disagree the moment the two differ.
  const timeZone = isMaster ? recurrenceTimezone : (row.timezone ?? "UTC");
  const startDateTime = row.startsAt.toISOString();
  const endDateTime = (row.endsAt ?? row.startsAt).toISOString();
  const body: GoogleEventWriteBody = {
    summary: row.title,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    start: { dateTime: startDateTime, timeZone },
    end: { dateTime: endDateTime, timeZone },
  };
  if (isMaster) {
    body.recurrence = localRecurrenceToGoogle({
      rrule: row.rrule!,
      recurrenceUntil: row.recurrenceUntil,
      recurrenceCount: row.recurrenceCount,
      recurrenceExdates: row.recurrenceExdates,
      allDay: false,
      timezone: recurrenceTimezone,
      startsAt: row.startsAt,
    });
  }
  if (isInstance && parentGoogleEventId && row.originalStartAt) {
    body.recurringEventId = parentGoogleEventId;
    body.originalStartTime = {
      dateTime: row.originalStartAt.toISOString(),
      timeZone,
    };
  }
  return body;
}

/**
 * The race-safe final write (Checkpoint 9.5, contract §8).
 *
 * Provider identifiers and the remote baseline are stored UNCONDITIONALLY:
 * they describe what now exists on the provider, whatever happened locally
 * meanwhile, and a retry needs them (an insert that lost its id would insert
 * again). The FLIP to `synced` -- and the `updated_at` bump that goes with it
 * -- happens ONLY where `updated_at` still equals the value read at job start.
 * A PATCH landing mid-push sets `pending_push` and bumps `updated_at` inside
 * its own transaction; if this write were unconditional it would overwrite
 * that durable intent with `synced` and the edit would never be pushed. Left
 * `pending_push`, the next job (or the five-minute redrive) pushes it.
 *
 * `last_synced_local_updated_at` is the event's `updated_at` AS READ AT JOB
 * START: the version whose body actually went to the provider. A mid-push
 * edit is strictly newer, so the next inbound pass sees "local changed since
 * baseline" and local wins, which is correct -- that edit has not been pushed.
 */
async function storeProviderResultRaceSafe(
  db: Db,
  linkId: string,
  linkUpdatedAtAtStart: string,
  rowUpdatedAtAtStart: Date,
  providerFields: Partial<typeof eventExternalLinks.$inferInsert>,
): Promise<{ flipped: boolean }> {
  await db
    .update(eventExternalLinks)
    .set({ ...providerFields, lastSyncedLocalUpdatedAt: rowUpdatedAtAtStart, lastSyncError: null })
    .where(eq(eventExternalLinks.id, linkId));
  const flipped = await db
    .update(eventExternalLinks)
    .set({ syncStatus: "synced", updatedAt: new Date() })
    .where(
      and(
        eq(eventExternalLinks.id, linkId),
        // Compared as the column's own text rendering (microsecond precision),
        // not as a JS Date: `timestamptz` carries microseconds, a Date only
        // milliseconds, so a round-tripped Date would almost never be equal
        // to the row and the flip would silently never happen.
        eq(eventExternalLinks.updatedAt, sql`${linkUpdatedAtAtStart}::timestamptz`),
      ),
    )
    .returning({ id: eventExternalLinks.id });
  return { flipped: flipped.length > 0 };
}

/** The link row plus its `updated_at` at full precision -- see storeProviderResultRaceSafe. */
async function readLinkAtStart(
  db: Db,
  eventId: string,
): Promise<{ link: typeof eventExternalLinks.$inferSelect; updatedAtRaw: string } | undefined> {
  const [found] = await db
    .select({
      link: eventExternalLinks,
      updatedAtRaw: sql<string>`${eventExternalLinks.updatedAt}::text`,
    })
    .from(eventExternalLinks)
    .where(eq(eventExternalLinks.eventId, eventId));
  return found;
}

export function createCalendarPushEventHandler(
  db: Db,
  googleClient: GoogleCalendarClient,
  caldavClient?: CalDavClient,
  boss?: PgBoss,
): (jobs: Job<CalendarPushEventJobData>[]) => Promise<void> {
  // See calendar-job-error.ts.
  return withCalendarJobErrorContainment(
    CALENDAR_PUSH_EVENT_QUEUE,
    createCalendarPushEventHandlerUncontained(db, googleClient, caldavClient, boss),
  );
}

function createCalendarPushEventHandlerUncontained(
  db: Db,
  googleClient: GoogleCalendarClient,
  caldavClient?: CalDavClient,
  boss?: PgBoss,
): (jobs: Job<CalendarPushEventJobData>[]) => Promise<void> {
  return async function handleCalendarPushEvent(jobs) {
    for (const job of jobs) {
      const found = await readLinkAtStart(db, job.data.eventId);
      if (!found) continue;
      const { link } = found;
      // The value every conditional write below is keyed on. Read ONCE, here.
      const linkUpdatedAtAtStart = found.updatedAtRaw;

      const [connection] = await db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, link.connectionId));
      if (!connection) continue;

      if (connection.status !== "active") {
        // NOT an error on the link (fixer review, MAJOR-B). `connection_inactive`
        // was terminal: nothing reset it on reconnect, so an edit made while
        // the connection needed reauth was never pushed. Left `pending_push`
        // the durable intent survives, the five-minute redrive re-sends it
        // cheaply, and the push completes on its own once the connection is
        // active again. The connection row already says why sync is stopped.
        log.info("calendar.push_event.skipped", {
          eventId: job.data.eventId,
          linkId: link.id,
          connectionId: connection.id,
          reason: "connection_inactive",
          connectionStatus: connection.status,
        });
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
          // A closed code rather than a bare `continue` (fixer review, MAJOR-B):
          // left `pending_push` the redrive would re-send this every five
          // minutes for ever. No credential is a credential failure.
          await db
            .update(eventExternalLinks)
            .set({
              syncStatus: "error",
              lastSyncError: "auth_failed" satisfies CalendarSyncErrorCode,
            })
            .where(eq(eventExternalLinks.id, link.id));
          log.warn("calendar.push_event.permanent_failure", {
            provider: "caldav",
            eventId: job.data.eventId,
            linkId: link.id,
            operation: "credentials",
            errorCode: "auth_failed",
          });
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
          // Delete at the deterministic href even when no href was ever stored
          // (fixer review, MAJOR-A): an insert whose response was lost DID
          // create the resource, and archiving before the retry would
          // otherwise orphan it on the server for ever. A 404 is "already gone".
          const href =
            link.caldavResourceUrl ?? desiredCaldavResourceHref(link.caldavCalendarUrl, link.id);
          try {
            await caldavClient.deleteEvent(
              href,
              link.caldavResourceUrl ? link.caldavEtag || undefined : undefined,
              auth,
            );
          } catch (err: unknown) {
            if (!(err instanceof CalDavError && (err.status === 404 || err.status === 410))) {
              throw err;
            }
          }
          await db.delete(eventExternalLinks).where(eq(eventExternalLinks.id, link.id));
          log.info("calendar.push_event.deleted", {
            provider: "caldav",
            eventId: job.data.eventId,
            linkId: link.id,
            hrefKnown: link.caldavResourceUrl !== null,
          });
          continue;
        }
        const rowUpdatedAtAtStart = row.updatedAt;

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
                caldavUpdatedAt: new Date(),
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
                caldavUpdatedAt: new Date(),
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
                  caldavUpdatedAt: new Date(),
                  lastSyncedLocalUpdatedAt: row.updatedAt,
                  syncStatus: "synced",
                  updatedAt: new Date(),
                },
              });
            // The child's own link row: race-safe like every other final write.
            await storeProviderResultRaceSafe(db, link.id, linkUpdatedAtAtStart, row.updatedAt, {
              caldavEtag: putRes.etag,
              caldavUpdatedAt: new Date(),
            });
          } else {
            // The parent series has no remote resource to carry an exception
            // (fixer review, MAJOR-B): a closed code, not a bare `continue`,
            // or the redrive would loop this link every five minutes.
            await db
              .update(eventExternalLinks)
              .set({
                syncStatus: "error",
                lastSyncError: "not_found" satisfies CalendarSyncErrorCode,
              })
              .where(eq(eventExternalLinks.id, link.id));
            log.warn("calendar.push_event.permanent_failure", {
              provider: "caldav",
              eventId: row.id,
              linkId: link.id,
              operation: "detach",
              errorCode: "not_found",
            });
          }
          continue;
        }

        // Outbound push for master / standalone event. UID and href are
        // link-derived (see desiredCaldavResourceHref) so a retry after a lost
        // response targets the SAME resource.
        const isNew = !link.caldavResourceUrl;
        const uid = link.caldavIcalUid || desiredCaldavIcalUid(link.id);
        const resourceHref =
          link.caldavResourceUrl || desiredCaldavResourceHref(link.caldavCalendarUrl, link.id);

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

        let operation: "insert" | "update" | "insert_412_adopt" = isNew ? "insert" : "update";
        let etag: string;
        try {
          try {
            const putRes = await caldavClient.putEvent(
              resourceHref,
              icsData,
              isNew ? undefined : link.caldavEtag || undefined,
              auth,
              isNew ? { ifNoneMatch: true } : undefined,
            );
            etag = putRes.etag;
          } catch (err: unknown) {
            // A 412 from `If-None-Match: *` on a link that has never stored an
            // href means the resource ALREADY EXISTS at the deterministic
            // href -- a previous attempt created it and lost the response
            // (fixer review, BLOCKER-2). That is not a conflict, but the
            // body on the server is the PREVIOUS attempt's, not this one's
            // (second-round review): read the etag and PUT the current body
            // conditionally -- the CalDAV twin of Google's 409 -> update.
            if (isNew && err instanceof CalDavError && err.status === 412) {
              operation = "insert_412_adopt";
              const existing = await caldavClient.getEvent(resourceHref, auth);
              const rePut = await caldavClient.putEvent(
                resourceHref,
                icsData,
                existing.etag || undefined,
                auth,
              );
              etag = rePut.etag;
            } else {
              throw err;
            }
          }

          const { flipped } = await storeProviderResultRaceSafe(
            db,
            link.id,
            linkUpdatedAtAtStart,
            rowUpdatedAtAtStart,
            {
              caldavResourceUrl: resourceHref,
              caldavIcalUid: uid,
              caldavEtag: etag,
              caldavUpdatedAt: new Date(),
            },
          );
          log.info("calendar.push_event.pushed", {
            provider: "caldav",
            eventId: row.id,
            linkId: link.id,
            operation,
            flipped,
          });
        } catch (err: unknown) {
          if (err instanceof CalDavError && err.isConflict) {
            await db
              .update(eventExternalLinks)
              .set({
                syncStatus: "conflict",
                lastSyncError: "conflict" satisfies CalendarSyncErrorCode,
              })
              .where(eq(eventExternalLinks.id, link.id));
            continue;
          }
          const code = classifyCalendarProviderError(err);
          // 403/405 on a PUT is the collection refusing writes; replaying the
          // identical body cannot change the answer (fixer review, MINOR-3).
          const permanent =
            PERMANENT_PUSH_ERRORS.has(code) ||
            (err instanceof CalDavError && (err.status === 403 || err.status === 405));
          if (permanent) {
            await db
              .update(eventExternalLinks)
              .set({ syncStatus: "error", lastSyncError: code })
              .where(eq(eventExternalLinks.id, link.id));
            log.warn("calendar.push_event.permanent_failure", {
              provider: "caldav",
              eventId: row.id,
              linkId: link.id,
              operation,
              errorCode: code,
              httpStatus: err instanceof CalDavError ? err.status : undefined,
            });
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
          // Through the ONE shared transition (Checkpoint 9.5), so this job
          // mints the same episode key the refresh-token job would and never
          // re-stamps `updated_at` on a retry. Never err.message: provider prose.
          await markNeedsReauth(db, boss, connection.id, classifyCalendarProviderError(err));
          continue;
        }
        throw err;
      }

      const [row] = await db.select().from(events).where(eq(events.id, job.data.eventId));

      if (!row || row.archivedAt) {
        // Delete at the link-derived id even when none was ever stored (fixer
        // review, MAJOR-A): an insert whose response was lost DID create the
        // event, and archiving before the retry would otherwise orphan it on
        // Google for ever. 404/410 is "already gone" -- including the ordinary
        // case where the insert never happened at all.
        if (link.googleCalendarId) {
          const remoteId = link.googleEventId ?? desiredGoogleEventId(link.id);
          try {
            await googleClient.deleteEvent(accessToken, link.googleCalendarId, remoteId);
          } catch (err) {
            const alreadyGone =
              err instanceof GoogleCalendarApiError &&
              (err.httpStatus === 404 || err.httpStatus === 410);
            if (!alreadyGone) throw err;
          }
        }
        await db.delete(eventExternalLinks).where(eq(eventExternalLinks.id, link.id));
        log.info("calendar.push_event.deleted", {
          provider: "google",
          eventId: job.data.eventId,
          linkId: link.id,
          idKnown: link.googleEventId !== null,
        });
        continue;
      }
      const rowUpdatedAtAtStart = row.updatedAt;

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
      const calendarId = link.googleCalendarId!;

      let written: GoogleCalendarEvent;
      let operation: "insert" | "update" | "insert_409_update" = link.googleEventId
        ? "update"
        : "insert";
      try {
        if (link.googleEventId) {
          written = await googleClient.updateEvent(
            accessToken,
            calendarId,
            link.googleEventId,
            body,
          );
        } else {
          // IDEMPOTENT INSERT (Checkpoint 9.5). The id is derived from the link
          // row, so a retry after a lost response asks for the same id. Google
          // answers 409 for a taken id, which means a previous attempt DID
          // create the event -- so the retry updates it and continues as if the
          // insert had succeeded, and exactly one remote event ever exists.
          const desiredId = desiredGoogleEventId(link.id);
          try {
            written = await googleClient.insertEvent(accessToken, calendarId, {
              id: desiredId,
              ...body,
            });
          } catch (err) {
            // Only a 409 that MEANS "id already taken" is resolved into an
            // update (fixer review, MINOR-1): Google's reason is `duplicate`,
            // or absent on a body it did not annotate. Any other 409 reason
            // is a different refusal and is rethrown to the classifier.
            const isDuplicateId =
              err instanceof GoogleCalendarApiError &&
              err.httpStatus === 409 &&
              (err.googleReason === undefined || err.googleReason === "duplicate");
            if (!isDuplicateId) throw err;
            operation = "insert_409_update";
            written = await googleClient.updateEvent(accessToken, calendarId, desiredId, body);
          }
        }
      } catch (err) {
        const code = classifyCalendarProviderError(err);
        if (PERMANENT_PUSH_ERRORS.has(code)) {
          // Not retryable: the answer will not change. Recorded on the link so
          // the client can show it; the row keeps the code, never the message.
          await db
            .update(eventExternalLinks)
            .set({ syncStatus: "error", lastSyncError: code })
            .where(eq(eventExternalLinks.id, link.id));
          log.warn("calendar.push_event.permanent_failure", {
            provider: "google",
            eventId: row.id,
            linkId: link.id,
            operation,
            errorCode: code,
            httpStatus: err instanceof GoogleCalendarApiError ? err.httpStatus : undefined,
          });
          continue;
        }
        throw err;
      }

      const { flipped } = await storeProviderResultRaceSafe(
        db,
        link.id,
        linkUpdatedAtAtStart,
        rowUpdatedAtAtStart,
        {
          googleEventId: written.id,
          googleIcalUid: written.iCalUID,
          googleEtag: written.etag,
          googleUpdatedAt: new Date(written.updated),
        },
      );
      log.info("calendar.push_event.pushed", {
        provider: "google",
        eventId: row.id,
        linkId: link.id,
        operation,
        flipped,
      });

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
            lastSyncedLocalUpdatedAt: rowUpdatedAtAtStart,
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
              lastSyncedLocalUpdatedAt: rowUpdatedAtAtStart,
              syncStatus: "synced",
              updatedAt: new Date(),
            },
          });
      }
    }
  };
}

/**
 * Dead-letter handler for calendar.google.push-event (Checkpoint 9.5).
 *
 * Marks the link `error` / `retries_exhausted` ONLY where it is still
 * `pending_push`: a later job may already have pushed it (`synced`), or a
 * mid-flight edit may have re-armed it, and neither may be overwritten by a
 * verdict about an older attempt. The flip deliberately does NOT bump
 * `updated_at`, because that timestamp is the episode discriminator in the
 * alert key below: a redelivered dead job derives the same key and is deduped,
 * while the next local edit (which sets `pending_push` and bumps `updated_at`
 * in its own transaction) starts a new episode with a new key (ADR-058).
 *
 * The body carries no title, no calendar name and no error text; ids travel
 * in `data`. No eligible device means no alert, but the structured line is
 * emitted regardless so the exhaustion is recorded.
 */
export function createCalendarPushEventDeadLetterHandler(
  db: Db,
  boss?: PgBoss,
): (jobs: Job<CalendarPushEventJobData>[]) => Promise<void> {
  return async function handleCalendarPushEventDead(jobs) {
    for (const job of jobs) {
      const [link] = await db
        .select({
          id: eventExternalLinks.id,
          syncStatus: eventExternalLinks.syncStatus,
          updatedAt: eventExternalLinks.updatedAt,
          updatedAtRaw: sql<string>`${eventExternalLinks.updatedAt}::text`,
        })
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.eventId, job.data.eventId));
      if (!link) {
        log.warn("calendar.push_event.dead_letter_skipped", {
          eventId: job.data.eventId,
          reason: "link_missing",
        });
        continue;
      }
      if (link.syncStatus !== "pending_push") {
        log.info("calendar.push_event.dead_letter_skipped", {
          eventId: job.data.eventId,
          linkId: link.id,
          reason: "not_pending",
          syncStatus: link.syncStatus,
        });
        continue;
      }

      const dedupeKey = `calendar.push-event.dead:${job.data.eventId}:${link.updatedAt.toISOString()}`;
      let outcome = "no_queue";
      let deviceCount = 0;
      let matched = false;
      // The flip and the alert are ONE unit (fixer review, MINOR-2): the flip
      // is conditional and RETURNING, the alert is enqueued only where it
      // matched, and the flip commits only once the alert enqueue has
      // succeeded. Before this the flip was committed first, so a failing
      // `boss.send` left the exhaustion recorded and the alert lost for ever
      // (a redelivery found `error`, not `pending_push`, and skipped).
      try {
        await db.transaction(async (tx) => {
          const flipped = await tx
            .update(eventExternalLinks)
            .set({
              syncStatus: "error",
              lastSyncError: "retries_exhausted" satisfies CalendarSyncErrorCode,
            })
            .where(
              and(
                eq(eventExternalLinks.id, link.id),
                eq(eventExternalLinks.syncStatus, "pending_push"),
                // Pinned to the same `updated_at` the dedupe key was built
                // from (second-round review): a PATCH that landed after the
                // read above has re-armed its own push, and this exhaustion
                // belongs to the PREVIOUS episode -- it must neither flip the
                // new intent to `error` nor alert under a stale key.
                sql`${eventExternalLinks.updatedAt}::text = ${link.updatedAtRaw}`,
              ),
            )
            .returning({ id: eventExternalLinks.id });
          matched = flipped.length > 0;
          if (!matched || !boss) return;
          const result = await alertEligibleDevices(tx as unknown as Db, boss, {
            dedupeKey,
            title: "Calendar sync failed",
            // An EDIT is the re-arm (it sets pending_push and enqueues a fresh
            // push); there is no retry button, so the body must not promise one.
            body: "A calendar event could not be synced. Open it in Personal OS and edit it to retry.",
            data: { eventId: job.data.eventId, linkId: link.id },
          });
          outcome = result.outcome;
          deviceCount = result.deviceCount;
        });
      } catch (err) {
        // Rolled back: the link is still pending_push and a redelivery of this
        // dead job repeats both halves. Token only -- never the message.
        log.warn("calendar.push_event.dead_letter_deferred", {
          eventId: job.data.eventId,
          linkId: link.id,
          dedupeKey,
          error: errorToken(err),
        });
        throw err;
      }
      if (!matched) {
        log.info("calendar.push_event.dead_letter_skipped", {
          eventId: job.data.eventId,
          linkId: link.id,
          reason: "not_pending",
          syncStatus: link.syncStatus,
        });
        continue;
      }
      log.warn("calendar.push_event.dead_letter", {
        eventId: job.data.eventId,
        linkId: link.id,
        dedupeKey,
        alert: outcome,
        deviceCount,
      });
    }
  };
}
