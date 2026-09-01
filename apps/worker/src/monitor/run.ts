import { monitorChecks, type Db } from "@personal-os/db";
import {
  evaluateIncident,
  isDueForCheck,
  listTargetsOfKind,
  probeHttp,
  probeTls,
  recordCheck,
  suppressionReason,
  type AlertSender,
  type FetchLike,
  type MonitorTargetRow,
  type TlsProbeFn,
} from "@personal-os/monitoring";
import { desc, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { errorToken, log } from "../logger.js";
import { createIncidentAlertSender } from "./alerts.js";

// The worker's monitoring pass.
//
// ===========================================================================
// THE WORKER OWNS EVERY `http` TARGET AND NOTHING ELSE.
// ===========================================================================
//
// `worker_heartbeat` targets are deliberately NOT selected here, and the
// omission is the entire point of ADR-055's split: a worker-hosted monitor
// cannot alert on its own death. A cron job that checks whether the worker is
// alive does not run when the worker is dead, so it would report nothing at
// exactly the moment it had something to say. That check belongs to the API
// process and lives in apps/api/src/monitor.
//
// The residual blind spot is documented rather than papered over: a worker that
// is HUNG rather than dead -- still holding its process, no longer beating --
// is caught by the API watchdog, but a worker that is crash-looping fast enough
// to keep beating while never completing a job is not caught by either. Nothing
// in this design claims otherwise.

export interface MonitorRunDeps {
  db: Db;
  boss?: PgBoss | null;
  now?: () => Date;
  fetchFn?: FetchLike;
  tlsProbe?: TlsProbeFn;
  /** Overrides the default queue-backed sender; used by tests. */
  sendAlert?: AlertSender | null;
}

export interface MonitorRunResult {
  evaluated: number;
  checksWritten: number;
  skipped: number;
  incidentsOpened: number;
  incidentsResolved: number;
}

/** The newest check for a target, used to decide whether the interval elapsed. */
async function lastCheckedAt(db: Db, targetId: string): Promise<Date | null> {
  const [row] = await db
    .select({ checkedAt: monitorChecks.checkedAt })
    .from(monitorChecks)
    .where(eq(monitorChecks.targetId, targetId))
    .orderBy(desc(monitorChecks.checkedAt))
    .limit(1);
  return row?.checkedAt ?? null;
}

/**
 * Probes one HTTP target and records the result.
 *
 * TLS IS A SEPARATE OBSERVATION FROM REACHABILITY, and the ordering matters: the
 * HTTP probe runs first and decides up/down, then TLS is consulted only if the
 * endpoint answered. A certificate expiring next week on a service that is
 * currently down is not the headline, and letting the TLS result overwrite a
 * transport failure would hide the outage behind the warning.
 *
 * A TLS problem on a REACHABLE endpoint does mark the check down, because an
 * expired certificate is an outage for every client that validates -- which is
 * every client except this probe, which deliberately does not.
 */
async function runHttpTarget(
  deps: MonitorRunDeps,
  target: MonitorTargetRow,
  now: Date,
): Promise<{ status: "up" | "down"; failureClass: string | null }> {
  const outcome = await probeHttp(
    {
      url: target.url ?? "",
      expectedStatus: target.expectedStatus,
      timeoutMs: target.timeoutMs,
      expectHealthyPayload: target.expectHealthyPayload,
    },
    deps.fetchFn,
  );

  let tlsExpiresAt: Date | null = null;
  let tlsDaysRemaining: number | null = null;
  let failureClass = outcome.status === "down" ? outcome.failureClass : null;
  let status: "up" | "down" = outcome.status;

  if (target.tlsWarnDays !== null && outcome.status === "up") {
    const tls = await probeTls(
      { url: target.url ?? "", warnDays: target.tlsWarnDays, timeoutMs: target.timeoutMs },
      deps.tlsProbe,
      now,
    );
    tlsExpiresAt = tls.observation?.expiresAt ?? null;
    tlsDaysRemaining = tls.observation?.daysRemaining ?? null;
    if (tls.failureClass !== null) {
      status = "down";
      failureClass = tls.failureClass;
    }
  }

  await recordCheck(deps.db, {
    targetId: target.id,
    status,
    httpStatus: outcome.httpStatus,
    latencyMs: outcome.latencyMs,
    failureClass,
    tlsExpiresAt,
    tlsDaysRemaining,
    checkedAt: now,
  });

  return { status, failureClass };
}

/**
 * Runs one monitoring pass over every `http` target.
 *
 * Sequential, never `Promise.all`. Probing every target concurrently would mean
 * a single tick opening as many sockets as there are targets, and -- more to the
 * point -- a slow target would no longer delay the others, which sounds good
 * until two targets are the same overloaded host and the monitor becomes part of
 * the outage it is reporting.
 */
export async function runMonitorPass(deps: MonitorRunDeps): Promise<MonitorRunResult> {
  const now = deps.now ? deps.now() : new Date();
  const result: MonitorRunResult = {
    evaluated: 0,
    checksWritten: 0,
    skipped: 0,
    incidentsOpened: 0,
    incidentsResolved: 0,
  };

  const sendAlert =
    deps.sendAlert === undefined
      ? createIncidentAlertSender(deps.db, deps.boss ?? null)
      : deps.sendAlert;

  for (const target of await listTargetsOfKind(deps.db, "http")) {
    result.evaluated += 1;

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
      // A `skipped` ROW IS WRITTEN, not nothing. "We deliberately did not look"
      // is a fact, and it is what lets the uptime read model render
      // `not_checked` rather than presenting a maintenance window as an outage.
      // Threshold evaluation excludes these rows entirely, so a nightly window
      // cannot reset a failure streak that was one check from opening.
      //
      // A DISABLED target is the one exception: it writes nothing, because a
      // target nobody is watching should not accumulate rows forever.
      if (suppression !== "disabled") {
        await recordCheck(deps.db, {
          targetId: target.id,
          status: "skipped",
          failureClass: suppression,
          checkedAt: now,
        });
        result.checksWritten += 1;
      }
      result.skipped += 1;
      continue;
    }

    if (!isDueForCheck(await lastCheckedAt(deps.db, target.id), target.intervalSeconds, now)) {
      result.skipped += 1;
      continue;
    }

    let observed: { status: "up" | "down"; failureClass: string | null };
    try {
      observed = await runHttpTarget(deps, target, now);
      result.checksWritten += 1;
    } catch (err) {
      // A probe that threw where it should have returned. Recorded as a down
      // check with a token, never with the error's text -- a fetch failure
      // carries the URL it failed against, and a target URL may carry a token.
      log.warn("monitor.probe_error", { target: target.name, error: errorToken(err) });
      await recordCheck(deps.db, {
        targetId: target.id,
        status: "down",
        failureClass: "probe_error",
        checkedAt: now,
      });
      result.checksWritten += 1;
      observed = { status: "down", failureClass: "probe_error" };
    }

    const outcome = await evaluateIncident(deps.db, {
      target,
      failureClass: observed.failureClass,
      now,
      sendAlert,
    });
    if (outcome.transition === "open") result.incidentsOpened += 1;
    if (outcome.transition === "resolve") result.incidentsResolved += 1;

    if (outcome.transition !== "none") {
      log.info("monitor.incident", {
        target: target.name,
        transition: outcome.transition,
        failureClass: observed.failureClass,
        alerted: outcome.alerted,
      });
    }
  }

  return result;
}
