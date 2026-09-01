import { devices, type Db } from "@personal-os/db";
import type { AlertSender, IncidentAlert } from "@personal-os/monitoring";
import { and, eq, isNull } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";

// Turning an incident transition into a push.
//
// ===========================================================================
// THE NOTIFICATION ROUTER IS REUSED UNCHANGED. NO NEW CATEGORY, NO NEW COLUMN.
// ===========================================================================
//
// ADR-055 is explicit about this: `category: "alert"` is already wired end to
// end, already defaults `notify_alerts = true` on every device, and is already
// exempt from quiet hours -- which is exactly right for "a service is down" and
// exactly wrong for a digest. Adding a `notify_monitoring` column would have
// meant a migration to `devices`, a settings screen, and a default that every
// existing device would have had to be migrated into.
//
// ---------------------------------------------------------------------------
// WHAT AN ALERT BODY MAY CONTAIN
//
// A push notification is the LEAST private surface in the system: it renders on
// a lock screen. So the body carries the target NAME and a failure CLASS, both
// of which are operator-authored or machine tokens, and never the URL -- which
// may legitimately carry a token in a query string. The alert exists to say
// "look at this", not to report the details.

/** Shared by both processes' senders. */
export function alertTitle(alert: IncidentAlert): string {
  return alert.kind === "opened" ? "Service down" : "Service recovered";
}

export function alertBody(alert: IncidentAlert): string {
  if (alert.kind === "resolved") return `${alert.targetName} is responding again.`;
  return alert.failureClass === null
    ? `${alert.targetName} is not responding.`
    : `${alert.targetName} is not responding (${alert.failureClass}).`;
}

/**
 * Builds an `AlertSender` that enqueues through the existing dispatch job.
 *
 * FANS OUT PER DEVICE, matching what `notifications.dispatch` expects when it is
 * handed an explicit `deviceId`: the job suffixes the dedupe key with the device
 * id itself, so each device's delivery is tracked separately and one device's
 * permanent failure cannot suppress another's.
 *
 * Returns a no-op sender when there is no queue. The incident row is already
 * committed by the time this runs, so a missing queue must cost a notification
 * and never a fact.
 */
export function createIncidentAlertSender(db: Db, boss: PgBoss | null): AlertSender {
  return async (alert: IncidentAlert): Promise<void> => {
    if (!boss) return;

    const eligible = await db
      .select({ id: devices.id })
      .from(devices)
      .where(
        and(
          eq(devices.notifyAlerts, true),
          eq(devices.notificationsEnabled, true),
          isNull(devices.revokedAt),
        ),
      );

    for (const device of eligible) {
      await boss.send(NOTIFICATIONS_DISPATCH_QUEUE, {
        category: "alert",
        title: alertTitle(alert),
        body: alertBody(alert),
        // Ids only -- never the URL, never a probe error's text.
        data: { monitorIncidentId: alert.incidentId, monitorTargetId: alert.targetId },
        // INCIDENT-SCOPED (ADR-055). `notification_dispatch_log.dedupe_key` is a
        // permanent primary key with no TTL, so a target-scoped key would burn
        // itself on the first outage and never alert again.
        dedupeKey: alert.dedupeKey,
        deviceId: device.id,
      });
    }
  };
}
