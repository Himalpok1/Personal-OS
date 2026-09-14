import { devices, notificationDispatchLog, type Db } from "@personal-os/db";
import { and, eq, isNotNull, isNull, like } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";
import type { NotificationsDispatchJobData } from "./notifications-dispatch.js";

// Shared alert fan-out for dead-letter handlers (extracted verbatim from
// occurrences-dead-letter.ts in Checkpoint 9.5 so calendar-push-event.ts's
// dead handler uses the identical eligibility predicate and dedupe check
// rather than a second copy that could drift). The ADR-058 rules -- an
// occurrence-scoped key derived from durable state, a body that names no
// identifier, ids only in `data` -- are the caller's responsibility; this
// module only decides WHO is eligible and whether the key was already claimed.

export type AlertOutcome = "sent" | "already_attempted" | "no_targets";

export interface DeviceAlert {
  dedupeKey: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

/**
 * Fans one alert out to every eligible device, once per failure identity.
 *
 * The dispatch job is the real dedupe (it claims `<dedupeKey>:<deviceId>` and
 * skips a terminal row), so a second delivery of the dead job could simply
 * enqueue again and be collapsed there. The prefix check is what keeps the
 * QUEUE quiet as well as the phone: once any device's row exists for this key,
 * the attempt has been recorded durably and enqueueing again would only add a
 * job whose every target is already claimed. A redelivery that lands BEFORE
 * dispatch has run still enqueues twice; that pair collapses at the claim, and
 * is the at-least-once cost every producer in this system already pays.
 *
 * Best-effort by design: the log line is emitted by the caller whatever this
 * returns, so a pg-boss hiccup costs a notification, never the record.
 */
export async function alertEligibleDevices(
  db: Db,
  boss: PgBoss,
  alert: DeviceAlert,
): Promise<{ outcome: AlertOutcome; deviceCount: number }> {
  const [existing] = await db
    .select({ dedupeKey: notificationDispatchLog.dedupeKey })
    .from(notificationDispatchLog)
    .where(like(notificationDispatchLog.dedupeKey, `${alert.dedupeKey}:%`))
    .limit(1);
  if (existing) return { outcome: "already_attempted", deviceCount: 0 };

  // Axis for axis the predicate notifications-dispatch's `resolveTargets`
  // applies to `category: "alert"`, INCLUDING the push token: a device that
  // passes the three flag checks but has no token is dropped there before any
  // dispatch-log row is claimed, so counting it here would report "sent" for
  // an attempt that leaves no durable trace and re-enqueue on every
  // redelivery, since the prefix check above would never find a row.
  const eligible = await db
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(
        eq(devices.notifyAlerts, true),
        eq(devices.notificationsEnabled, true),
        isNull(devices.revokedAt),
        isNotNull(devices.pushToken),
      ),
    );
  if (eligible.length === 0) return { outcome: "no_targets", deviceCount: 0 };

  for (const device of eligible) {
    const payload: NotificationsDispatchJobData = {
      category: "alert",
      title: alert.title,
      body: alert.body,
      data: alert.data,
      dedupeKey: alert.dedupeKey,
      deviceId: device.id,
    };
    await boss.send(NOTIFICATIONS_DISPATCH_QUEUE, payload);
  }
  return { outcome: "sent", deviceCount: eligible.length };
}
