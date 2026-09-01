import { nextQuietHoursEnd } from "@personal-os/core";
import { devices, type Db } from "@personal-os/db";
import { and, eq, isNull } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../../queue-names.js";

// Telling the user a digest is ready.
//
// ===========================================================================
// QUIET HOURS DELAY THIS NOTIFICATION. THEY DO NOT SUPPRESS IT.
// ===========================================================================
//
// ADR-053 amendment E exists because of a specific, live defect in the shared
// router. `notifications.dispatch` drops a non-`alert` notification for any
// device currently inside its quiet hours, and the drop is total: the device is
// never added to `targets`, so `claimTarget` is never called, so NO
// `notification_dispatch_log` row is written -- and the handler then returns
// normally, so pg-boss marks the job completed and never retries it.
//
// For a capture confirmation that is survivable; the capture is in the Inbox
// either way. For a RECURRING digest it is not. The cron fires at a fixed
// wall-clock hour, so a user whose quiet hours span that hour loses the
// notification every single day, permanently, with no row and no log line to
// show it ever happened.
//
// The fix is scheduling, not exemption. Each device's job is enqueued with
// pg-boss's `startAfter` set to the instant that device's quiet window ends, so
// it simply ARRIVES later and the router's own unchanged check passes when it
// does. `notifications-dispatch.ts` is deliberately not modified: its
// quiet-hours test becomes a safety net rather than the dropper.
//
// Exempting digests from quiet hours -- adding `digest` beside `alert` in that
// condition -- was the other option and is worse. Quiet hours exist precisely so
// a 07:00 digest does not wake someone at 03:00 in their own zone.
//
// ---------------------------------------------------------------------------
// WHAT A DIGEST PUSH MAY SAY (ADR-054)
//
// The digest TEXT is model prose derived from attacker-authored subject lines,
// and a push notification renders on a lock screen. So the body is a fixed
// literal plus the digest's own date, and carries no subject, no sender, no
// address, no display name and no URL. ADR-054 states the rule directly: none of
// those may appear in a push body, a log line, a commit message or any status
// document.

export interface MailDigestNotification {
  digestDate: string;
  timezone: string;
  now: Date;
}

export type MailDigestNotifier = (notification: MailDigestNotification) => Promise<void>;

/**
 * The dedupe key for a digest notification.
 *
 * THE DATE IS LOAD-BEARING, not decoration. `notification_dispatch_log.dedupe_key`
 * is a permanent primary key with no TTL and no cleanup job, so a key without a
 * per-occurrence discriminator burns itself on its first success and that
 * notification can never be sent again for the life of the database. That is not
 * a hypothetical: the pre-existing `calendar-needs-reauth:${connectionId}`
 * producer has exactly that defect, and it is why monitoring's keys are
 * incident-scoped.
 *
 * The timezone is included because it is half of the digest's identity -- two
 * zones legitimately produce two different digests for the same calendar date.
 *
 * The router suffixes `:${deviceId}` itself, so each device is tracked
 * independently and one device's permanent failure cannot suppress another's.
 */
export function mailDigestDedupeKey(digestDate: string, timezone: string): string {
  return `mail-digest:${digestDate}:${timezone}`;
}

/** Fixed copy. No mail content of any kind may appear here -- see ADR-054 above. */
export function mailDigestNotificationBody(digestDate: string): string {
  return `Your mail digest for ${digestDate} is ready.`;
}

/**
 * Builds the notifier the digest pass calls after a digest is persisted.
 *
 * Returns a no-op when there is no queue. The digest row is already committed by
 * the time this runs, so a missing queue must cost a notification and never a
 * fact -- the same posture the monitoring alert sender takes.
 */
export function createMailDigestNotifier(db: Db, boss: PgBoss | null): MailDigestNotifier {
  return async (notification: MailDigestNotification): Promise<void> => {
    if (!boss) return;

    const eligible = await db
      .select({
        id: devices.id,
        quietHoursStart: devices.quietHoursStart,
        quietHoursEnd: devices.quietHoursEnd,
        quietHoursTimezone: devices.quietHoursTimezone,
      })
      .from(devices)
      .where(
        and(
          eq(devices.notifyDigests, true),
          eq(devices.notificationsEnabled, true),
          isNull(devices.revokedAt),
        ),
      );

    const dedupeKey = mailDigestDedupeKey(notification.digestDate, notification.timezone);

    for (const device of eligible) {
      // PER DEVICE, because quiet hours are per device. One device in a quiet
      // window must not delay another device that is awake, and a single job
      // for all devices could only ever honour one device's schedule.
      const deferUntil = nextQuietHoursEnd(
        notification.now,
        device.quietHoursStart,
        device.quietHoursEnd,
        device.quietHoursTimezone,
      );

      await boss.send(
        NOTIFICATIONS_DISPATCH_QUEUE,
        {
          category: "digest",
          title: "Mail digest",
          body: mailDigestNotificationBody(notification.digestDate),
          // Ids and a date only. A tap needs somewhere to go; it does not need
          // to carry the digest's contents.
          data: {
            mailDigestDate: notification.digestDate,
            mailDigestTimezone: notification.timezone,
          },
          dedupeKey,
          deviceId: device.id,
        },
        deferUntil === null ? {} : { startAfter: deferUntil },
      );
    }
  };
}
