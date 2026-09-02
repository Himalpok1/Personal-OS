import { decryptSecret, encryptSecret } from "@personal-os/ai-providers";
import {
  GoogleOAuthError,
  classifyCalendarProviderError,
  refreshAccessToken,
} from "@personal-os/calendar-providers";
import type { CalendarSyncErrorCode } from "@personal-os/schema";
import { calendarConnections, devices, type Db } from "@personal-os/db";
import { and, eq, isNull } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { env } from "../env.js";
import { CALENDAR_REFRESH_TOKEN_QUEUE, NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";
import { withCalendarJobErrorContainment } from "./calendar-job-error.js";

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
  // See calendar-job-error.ts.
  return withCalendarJobErrorContainment(
    CALENDAR_REFRESH_TOKEN_QUEUE,
    createCalendarRefreshTokenHandlerUncontained(db, boss),
  );
}

function createCalendarRefreshTokenHandlerUncontained(
  db: Db,
  boss: PgBoss,
): (jobs: Job<CalendarRefreshTokenJobData>[]) => Promise<void> {
  return async function handleCalendarRefreshToken(jobs) {
    for (const job of jobs) {
      const [connection] = await db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, job.data.connectionId));
      if (!connection) continue;
      if (connection.status === "needs_reauth") {
        // Reachable only via a pg-boss RETRY of a job that already
        // transitioned this connection: the cron enqueues `status = 'active'`
        // connections only (see enqueueCalendarRefreshForActiveConnections).
        //
        // THIS IS THE FIX FOR A SILENT, PERMANENT ALERT LOSS. Before Checkpoint
        // 8.1 this was a bare `continue`: if anything between the committed
        // status UPDATE and `boss.send` threw -- the device SELECT, the queue --
        // the retry landed here, returned normally, and pg-boss marked the job
        // COMPLETED. The connection was correctly `needs_reauth` and nobody was
        // ever told. Re-enqueueing is free because the key is episode-scoped:
        // it is the SAME string, so notification_dispatch_log dedupes it.
        await enqueueNeedsReauthAlert(db, boss, connection.id);
        continue;
      }
      if (connection.status !== "active") continue; // no-op

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
        await markNeedsReauth(db, boss, connection.id, "auth_expired");
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
          // Never err.message -- see calendar-sync-calendar.ts.
          await markNeedsReauth(db, boss, connection.id, classifyCalendarProviderError(err));
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
  reason: CalendarSyncErrorCode,
): Promise<void> {
  // CONDITIONAL ON `status = 'active'`, and that predicate is what makes the
  // alert key episode-scoped (Checkpoint 8.1).
  //
  // On a pg-boss retry of a job that already transitioned, this matches ZERO
  // rows and therefore does NOT re-stamp `updated_at` -- so the episode's
  // identity is frozen at the instant of the transition and every retry derives
  // the identical dedupe key.
  //
  // `eq(status, 'active')` rather than `ne(status, 'needs_reauth')`: the latter
  // also matches a row a concurrent disconnect just set to 'disconnected' and
  // would flip it back to needs_reauth, resurrecting a connection the user
  // deliberately removed.
  await db
    .update(calendarConnections)
    .set({ status: "needs_reauth", lastSyncError: reason, updatedAt: new Date() })
    .where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.status, "active")));

  await enqueueNeedsReauthAlert(db, boss, connectionId);
}

/**
 * Fans the needs-reauth alert out to every eligible device, keyed to THIS
 * failure episode.
 *
 * ===========================================================================
 * WHY THE KEY CARRIES A TIMESTAMP -- AND WHY THAT IS NOT "TIMESTAMP RANDOMNESS"
 * ===========================================================================
 *
 * `notification_dispatch_log.dedupe_key` is a permanent PRIMARY KEY with no TTL
 * and no sweep, claimed with `onConflictDoNothing`. The old key was
 * `calendar-needs-reauth:${connectionId}` -- scoped to an identity that outlives
 * every failure -- so it burned itself on the FIRST outage and could never alert
 * again. It did: the key was accepted on 2026-08-25, which is why the real
 * calendar failure of 2026-08-31 notified nobody (ADR-057 finding #4).
 *
 * The discriminator is `updated_at` READ BACK FROM THE ROW after the conditional
 * transition above -- not a `new Date()` captured in JS. It is the durable
 * record of WHEN THIS EPISODE BEGAN, so it is the episode's identity rather than
 * a clock reading:
 *
 *   - same episode, retried  -> the UPDATE matched nothing, `updated_at` is
 *                               unchanged, the key is byte-identical, deduped.
 *   - reconnect, then fail   -> the reconnect stamped a new `updated_at` and the
 *                               next failure stamps another, so the key differs
 *                               and the alert fires again. This is the whole
 *                               point.
 *   - two jobs racing        -> both read the SAME post-transition `updated_at`,
 *                               so both produce the same key and at most one
 *                               dispatch is claimed.
 *
 * That property depends on `updated_at` not moving DURING an episode, which is
 * why both dead-letter handlers in this file and in calendar-sync-calendar.ts
 * are now `status = 'active'`-guarded.
 *
 * Idempotent on purpose, and called on the retry path too.
 */
async function enqueueNeedsReauthAlert(db: Db, boss: PgBoss, connectionId: string): Promise<void> {
  const [row] = await db
    .select({
      status: calendarConnections.status,
      updatedAt: calendarConnections.updatedAt,
    })
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId));
  // Reconnected or disconnected in between -- there is no live episode to
  // alert about, and inventing a key here would burn one for an episode that
  // has already ended.
  if (!row || row.status !== "needs_reauth") return;

  const dedupeKey = `calendar-needs-reauth:${connectionId}:${row.updatedAt.toISOString()}`;

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
      // NO ACCOUNT EMAIL. This body used to interpolate
      // `connection.googleAccountEmail`, which made it the only alert in the
      // system carrying a personal identifier -- rendered on a lock screen,
      // the least private surface there is. monitor/alerts.ts states the rule
      // this now follows: an alert says "look at this", it does not report
      // details. There is exactly one Google Calendar connection, so the
      // address added nothing a user needed.
      body: "Calendar sync has stopped. Reconnect it in Settings.",
      data: { calendarConnectionId: connectionId },
      dedupeKey,
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
          lastSyncError: "retries_exhausted" satisfies CalendarSyncErrorCode,
          updatedAt: new Date(),
        })
        // `status = 'active'`-GUARDED as of Checkpoint 8.1. Two things depend on
        // it. First, this handler's own comment above already asserts the
        // invariant -- "a transient failure never changed status in the first
        // place" -- which the unguarded UPDATE did not enforce. Second, and
        // load-bearing: `updated_at` is the discriminator in the needs-reauth
        // alert key, so an unguarded write here could move it mid-episode and
        // mint a second key for one failure. It also stops the specific
        // classification (`auth_expired`) being downgraded to the generic
        // `retries_exhausted` after the fact.
        .where(
          and(
            eq(calendarConnections.id, job.data.connectionId),
            eq(calendarConnections.status, "active"),
          ),
        );
    }
  };
}

// Enqueues a refresh check for every active *Google* connection -- cheap
// no-op for any connection whose token is still fresh (checked inside the
// handler). CalDAV connections use static username/password credentials,
// not OAuth tokens, and must never enter this job: the handler treats a
// missing refresh token as a permanent auth failure and would otherwise
// mark a healthy CalDAV connection needs_reauth on its very first cron
// pass (Checkpoint 4.7 production-deployment finding).
export async function enqueueCalendarRefreshForAllActiveConnections(
  db: Db,
  boss: PgBoss,
  queueName: string,
): Promise<void> {
  const rows = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(
      and(eq(calendarConnections.status, "active"), eq(calendarConnections.provider, "google")),
    );
  for (const row of rows) {
    await boss.send(queueName, { connectionId: row.id });
  }
}
