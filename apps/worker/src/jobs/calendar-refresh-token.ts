import { decryptSecret, encryptSecret } from "@personal-os/ai-providers";
import { GoogleOAuthError, refreshAccessToken } from "@personal-os/calendar-providers";
import { calendarConnections, devices, type Db } from "@personal-os/db";
import { and, eq, isNull } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { env } from "../env.js";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";

export interface CalendarRefreshTokenJobData {
  connectionId: string;
}

// Refresh ~10 minutes before expiry -- generous relative to Google's
// typical ~1h access token lifetime, and gives calendar.google.sync-calendar
// (which also refreshes inline if it finds a token this stale) room to
// almost never need to.
const REFRESH_MARGIN_MS = 10 * 60_000;

export function createCalendarRefreshTokenHandler(
  db: Db,
  boss: PgBoss,
): (jobs: Job<CalendarRefreshTokenJobData>[]) => Promise<void> {
  return async function handleCalendarRefreshToken(jobs) {
    for (const job of jobs) {
      const [connection] = await db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, job.data.connectionId));
      if (!connection || connection.status !== "active") continue; // no-op

      const expiresAt = connection.accessTokenExpiresAt;
      const isFresh = expiresAt && expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS;
      if (isFresh) continue;

      if (
        !connection.refreshTokenCiphertext ||
        !connection.refreshTokenIv ||
        !connection.refreshTokenAuthTag
      ) {
        // No refresh token stored at all -- treat identically to a
        // permanent OAuth failure (nothing this job can do without the
        // user re-authorizing).
        await markNeedsReauth(db, boss, connection.id, "no refresh token stored");
        continue;
      }

      const refreshToken = decryptSecret(
        {
          ciphertext: connection.refreshTokenCiphertext,
          iv: connection.refreshTokenIv,
          authTag: connection.refreshTokenAuthTag,
        },
        env.CREDENTIALS_ENCRYPTION_KEY,
      );

      try {
        const refreshed = await refreshAccessToken({
          refreshToken,
          clientId: env.GOOGLE_OAUTH_CLIENT_ID,
          clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        });
        const newAccessSecret = encryptSecret(
          refreshed.accessToken,
          env.CREDENTIALS_ENCRYPTION_KEY,
        );
        await db
          .update(calendarConnections)
          .set({
            accessTokenCiphertext: newAccessSecret.ciphertext,
            accessTokenIv: newAccessSecret.iv,
            accessTokenAuthTag: newAccessSecret.authTag,
            accessTokenExpiresAt: refreshed.expiresAt,
            lastSyncError: null,
            updatedAt: new Date(),
          })
          .where(eq(calendarConnections.id, connection.id));
        // Google often omits a new refresh_token on this call -- the
        // existing stored one (still encrypted, untouched above) keeps
        // being used, per google-oauth.ts's documented contract.
      } catch (err) {
        if (err instanceof GoogleOAuthError && err.isPermanent) {
          await markNeedsReauth(db, boss, connection.id, err.message);
          continue; // permanent -- no retry
        }
        throw err; // transient -- let pg-boss retry
      }
    }
  };
}

async function markNeedsReauth(
  db: Db,
  boss: PgBoss,
  connectionId: string,
  reason: string,
): Promise<void> {
  const [updated] = await db
    .update(calendarConnections)
    .set({ status: "needs_reauth", lastSyncError: reason, updatedAt: new Date() })
    .where(eq(calendarConnections.id, connectionId))
    .returning({ googleAccountEmail: calendarConnections.googleAccountEmail });

  // Alert every eligible device -- matches devices.ts's own
  // test-notification enqueue shape. Best-effort: if pg-boss/notification
  // delivery fails, the connection's needs_reauth status (already
  // committed above) is still the source of truth.
  const eligibleDevices = await db
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(
        eq(devices.notifyAlerts, true),
        eq(devices.notificationsEnabled, true),
        isNull(devices.revokedAt),
      ),
    );

  for (const device of eligibleDevices) {
    await boss.send(NOTIFICATIONS_DISPATCH_QUEUE, {
      category: "alert",
      title: "Google Calendar needs reconnecting",
      body: updated
        ? `Sync for ${updated.googleAccountEmail} has stopped. Reconnect it in Settings.`
        : "A Google Calendar connection needs to be reconnected.",
      data: { calendarConnectionId: connectionId },
      dedupeKey: `calendar-needs-reauth:${connectionId}`,
      deviceId: device.id,
    });
  }
}

// Dead-letter: an exhausted transient-retry run leaves the connection in
// whatever state it was already in (active, still possibly stale) --
// there's nothing new to record here since a transient failure never
// changed status in the first place. The next scheduled refresh attempt
// (or a sync-calendar job's own inline refresh) will simply try again.
export function createCalendarRefreshTokenDeadLetterHandler(
  db: Db,
): (jobs: Job<CalendarRefreshTokenJobData>[]) => Promise<void> {
  return async function handleCalendarRefreshTokenDead(jobs) {
    for (const job of jobs) {
      await db
        .update(calendarConnections)
        .set({
          lastSyncError: "calendar.google.refresh-token: retries exhausted (transient)",
          updatedAt: new Date(),
        })
        .where(eq(calendarConnections.id, job.data.connectionId));
    }
  };
}

// Enqueues a refresh check for every active connection -- cheap no-op for
// any connection whose token is still fresh (checked inside the handler).
export async function enqueueCalendarRefreshForAllActiveConnections(
  db: Db,
  boss: PgBoss,
  queueName: string,
): Promise<void> {
  const rows = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(eq(calendarConnections.status, "active"));
  for (const row of rows) {
    await boss.send(queueName, { connectionId: row.id });
  }
}
