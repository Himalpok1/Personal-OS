import { devices, type Db } from "@personal-os/db";
import {
  evaluateIncident,
  heartbeatFailureClass,
  isDueForCheck,
  listTargetsOfKind,
  observeWorkerHeartbeat,
  recordCheck,
  suppressionReason,
  type AlertSender,
  type IncidentAlert,
} from "@personal-os/monitoring";
import { and, desc, eq, isNull } from "drizzle-orm";
import { monitorChecks } from "@personal-os/db";
import type { PgBoss } from "pg-boss";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";

// The worker-heartbeat watchdog. THE API PROCESS OWNS THIS.
//
// ===========================================================================
// WHY IT IS HERE AND NOT IN THE WORKER, WHICH OWNS EVERY OTHER CHECK
// ===========================================================================
//
// A WORKER CANNOT ALERT ON ITS OWN DEATH. A cron job that checks whether the
// worker is alive does not run when the worker is dead -- it would report
// nothing at exactly the moment it had something to say, and "no alert" is
// indistinguishable from "everything is fine".
//
// docs/ARCHITECTURE.md has required this since Phase 0: "Worker crashes must be
// loud... Add a heartbeat row it updates each cycle and alert on staleness." The
// heartbeat row shipped then and `GET /health` has reported `worker.stale` ever
// since, but NOTHING EVER ALERTED ON IT. Reporting a fact on an endpoint nobody
// polls is not alerting. ADR-055 assigns the missing half to this process.
//
// ---------------------------------------------------------------------------
// THE RESIDUAL BLIND SPOT, STATED RATHER THAN PAPERED OVER
//
// ADR-055 names it and this implementation does not close it: a worker that is
// HUNG or crash-looping fast enough to keep writing heartbeats, behind a healthy
// API, looks alive to this watchdog. The heartbeat proves a process is running
// its beat cron, not that it is completing jobs. Closing that would need a
// liveness signal derived from actual job completion, which is a different
// design and is not part of this checkpoint.
//
// A second, smaller one: if the API is down, nothing evaluates the heartbeat
// either. That is a strictly better failure than the worker watching itself,
// because an API outage is what the OTHER targets exist to catch.

export interface HeartbeatWatchdogDeps {
  db: Db;
  boss?: PgBoss | null;
  now?: () => Date;
  sendAlert?: AlertSender | null;
}

export interface HeartbeatWatchdogResult {
  /** Null when no `worker_heartbeat` target is configured. */
  status: "up" | "down" | "skipped" | null;
  ageSeconds: number | null;
  failureClass: string | null;
  transition: "none" | "open" | "resolve" | null;
}

const IDLE: HeartbeatWatchdogResult = {
  status: null,
  ageSeconds: null,
  failureClass: null,
  transition: null,
};

/**
 * Enqueues a heartbeat alert.
 *
 * Near-duplicated from the worker's sender rather than shared, and this is the
 * one place in the monitoring lane where near-duplication is the RIGHT call:
 * the two processes have different queue handles, different logging, and -- the
 * decisive part -- the API must never import from apps/worker, because they are
 * separate processes whose only interface is Postgres and pg-boss
 * (docs/ARCHITECTURE.md). The shared thing is the state machine, which is in
 * @personal-os/monitoring; the plumbing is each process's own.
 */
function createHeartbeatAlertSender(db: Db, boss: PgBoss | null): AlertSender {
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
        title: alert.kind === "opened" ? "Worker not responding" : "Worker recovered",
        body:
          alert.kind === "opened"
            ? "The background worker has stopped reporting. Reminders and capture parsing may be delayed."
            : "The background worker is reporting again.",
        data: { monitorIncidentId: alert.incidentId, monitorTargetId: alert.targetId },
        // INCIDENT-SCOPED (ADR-055): a permanent, TTL-less dedupe key means a
        // target-scoped one would burn itself on the first outage.
        dedupeKey: alert.dedupeKey,
        deviceId: device.id,
      });
    }
  };
}

/**
 * Runs one watchdog evaluation.
 *
 * Returns rather than throws on every path. This runs on an interval inside the
 * HTTP process; an exception escaping it would surface as an unhandled rejection
 * that could take the API down -- which would be a monitoring feature causing
 * the outage it exists to detect.
 */
export async function runHeartbeatWatchdog(
  deps: HeartbeatWatchdogDeps,
): Promise<HeartbeatWatchdogResult> {
  const now = deps.now ? deps.now() : new Date();
  const [target] = await listTargetsOfKind(deps.db, "worker_heartbeat");

  // No target configured is not a failure: monitoring is opt-in configuration,
  // and a deployment that has not seeded targets should be silent rather than
  // inventing one.
  if (target === undefined) return { ...IDLE };

  const suppression = suppressionReason(
    {
      enabled: target.enabled,
      mutedUntil: target.mutedUntil,
      maintenanceStart: target.maintenanceStart,
      maintenanceEnd: target.maintenanceEnd,
      maintenanceTimezone: target.maintenanceTimezone,
    },
    now,
  );

  if (suppression !== null) {
    if (suppression === "disabled") return { ...IDLE, status: "skipped" };
    await recordCheck(deps.db, {
      targetId: target.id,
      status: "skipped",
      failureClass: suppression,
      checkedAt: now,
    });
    return { ...IDLE, status: "skipped" };
  }

  const [last] = await deps.db
    .select({ checkedAt: monitorChecks.checkedAt })
    .from(monitorChecks)
    .where(eq(monitorChecks.targetId, target.id))
    .orderBy(desc(monitorChecks.checkedAt))
    .limit(1);
  if (!isDueForCheck(last?.checkedAt ?? null, target.intervalSeconds, now)) {
    return { ...IDLE };
  }

  // A target with no explicit bound falls back to three minutes, which is three
  // missed beats against the worker's one-minute cron: two are noise, three are
  // a pattern.
  const maxAgeSeconds = target.heartbeatMaxAgeSeconds ?? 180;
  const observation = await observeWorkerHeartbeat(deps.db, maxAgeSeconds, now);
  const failureClass = heartbeatFailureClass(observation);
  const status = observation.stale ? "down" : "up";

  await recordCheck(deps.db, {
    targetId: target.id,
    status,
    failureClass,
    heartbeatAgeSeconds: observation.ageSeconds,
    checkedAt: now,
  });

  const sendAlert =
    deps.sendAlert === undefined
      ? createHeartbeatAlertSender(deps.db, deps.boss ?? null)
      : deps.sendAlert;

  const outcome = await evaluateIncident(deps.db, {
    target,
    failureClass,
    now,
    sendAlert,
  });

  return {
    status,
    ageSeconds: observation.ageSeconds,
    failureClass,
    transition: outcome.transition,
  };
}
