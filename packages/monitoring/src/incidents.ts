import { monitorChecks, monitorIncidents, type Db } from "@personal-os/db";
import { sanitizeMonitorFailureClass, type MonitorCheckStatus } from "@personal-os/schema";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { evaluateThreshold, type IncidentTransition } from "./thresholds.js";

// The incident state machine.
//
// ===========================================================================
// WHY THIS LIVES IN A SHARED PACKAGE RATHER THAN IN EITHER APP
// ===========================================================================
//
// ADR-055 splits monitoring across two processes on purpose: general monitoring
// is worker-owned, but the `worker_heartbeat` staleness check belongs to the API,
// because A WORKER CANNOT ALERT ON ITS OWN DEATH.
//
// That split means BOTH processes open and resolve incidents. This repository's
// standing preference is deliberate near-duplication over premature sharing
// (ADR-052), and that is the right call when two implementations legitimately
// DIFFER -- as the worker's and the API's token refresh do. Here they would be
// IDENTICAL: the lifecycle of an incident does not depend on who noticed. Two
// copies of one state machine is two chances for them to diverge, in the exact
// component whose correctness this checkpoint is about.
//
// So the state machine is shared and the OBSERVATION is not: each process
// supplies its own probe and its own scheduling.
//
// ---------------------------------------------------------------------------
// NOTHING HERE IMPORTS pg-boss.
//
// Alerts are enqueued through an injected `AlertSender`, so this package stays
// free of the queue library and both callers pass their own `boss`. It also
// means the alert path is testable without a running queue.

/** How many checks the threshold evaluation reads. */
const CHECK_WINDOW = 20;

export type IncidentAlertKind = "opened" | "resolved";

export interface IncidentAlert {
  kind: IncidentAlertKind;
  incidentId: string;
  targetId: string;
  targetName: string;
  failureClass: string | null;
  /**
   * ===================================================================
   * INCIDENT-SCOPED, NEVER TARGET-SCOPED. THIS IS AN ADR-055 REQUIREMENT
   * WRITTEN AGAINST A REAL LATENT DEFECT.
   * ===================================================================
   *
   * `notification_dispatch_log.dedupe_key` is a PERMANENT primary key with no
   * TTL. The existing `calendar-needs-reauth:${connectionId}` producer carries
   * no time or incident discriminator, so once that key is `accepted` the
   * connection can NEVER alert again -- for the life of the database.
   *
   * `monitor:${incidentId}:opened` cannot have that problem: a second outage is
   * a new incident row, which is a new uuid, which is a key that has never been
   * used. The incident row is what makes a second alert possible at all, and is
   * the concrete reason incidents are durable state rather than a derived view.
   */
  dedupeKey: string;
}

/** Enqueues an alert. Injected so this package never imports pg-boss. */
export type AlertSender = (alert: IncidentAlert) => Promise<void>;

// Re-exported from targets.ts rather than declared twice: two identical type
// aliases for one table is the smallest possible version of the duplicate-source
// problem this whole checkpoint is written against.
import type { MonitorTargetRow } from "./targets.js";

export interface RecordCheckParams {
  targetId: string;
  status: MonitorCheckStatus;
  httpStatus?: number | null;
  latencyMs?: number | null;
  failureClass?: string | null;
  tlsExpiresAt?: Date | null;
  tlsDaysRemaining?: number | null;
  heartbeatAgeSeconds?: number | null;
  checkedAt?: Date;
}

/**
 * Writes one check row.
 *
 * `failure_class` is re-sanitized here even though every caller in this package
 * already emits a token. Defence in depth costs one function call, and the
 * alternative is trusting that no future caller ever passes a string from
 * somewhere else -- which is precisely how a URL with a token in it would reach
 * a durable column.
 */
export async function recordCheck(db: Db, params: RecordCheckParams): Promise<string> {
  const [row] = await db
    .insert(monitorChecks)
    .values({
      targetId: params.targetId,
      status: params.status,
      httpStatus: params.httpStatus ?? null,
      latencyMs: params.latencyMs ?? null,
      failureClass: sanitizeMonitorFailureClass(params.failureClass),
      tlsExpiresAt: params.tlsExpiresAt ?? null,
      tlsDaysRemaining: params.tlsDaysRemaining ?? null,
      heartbeatAgeSeconds: params.heartbeatAgeSeconds ?? null,
      ...(params.checkedAt ? { checkedAt: params.checkedAt } : {}),
    })
    .returning({ id: monitorChecks.id });
  return row!.id;
}

export type MonitorIncidentRow = typeof monitorIncidents.$inferSelect;

/** The unresolved incident for a target, if there is one. */
export async function findActiveIncident(
  db: Db,
  targetId: string,
): Promise<MonitorIncidentRow | undefined> {
  const [row] = await db
    .select()
    .from(monitorIncidents)
    .where(and(eq(monitorIncidents.targetId, targetId), isNull(monitorIncidents.resolvedAt)))
    .limit(1);
  return row;
}

/**
 * Reads the recent check history a threshold decision needs.
 *
 * `skipped` IS EXCLUDED IN THE QUERY, not in the caller and not in the
 * evaluator. That placement matters: it means no code path can accidentally
 * evaluate a threshold against a history containing maintenance skips, and it
 * puts the exclusion next to the ordering it depends on.
 *
 * A skip is not evidence either way. Counting one as "not down" would let a
 * nightly maintenance window silently reset a failure streak that was one check
 * from opening an incident -- so an outage beginning before the window would
 * never be reported. Counting it as "down" would manufacture an outage. Omitting
 * it means the streak spans the window, which is what an operator would say
 * happened.
 */
export async function recentDecisiveStatuses(
  db: Db,
  targetId: string,
  limit: number = CHECK_WINDOW,
): Promise<MonitorCheckStatus[]> {
  const rows = await db
    .select({ status: monitorChecks.status })
    .from(monitorChecks)
    .where(and(eq(monitorChecks.targetId, targetId), inArray(monitorChecks.status, ["up", "down"])))
    .orderBy(desc(monitorChecks.checkedAt), desc(monitorChecks.id))
    .limit(limit);
  return rows.map((r) => r.status as MonitorCheckStatus);
}

export interface EvaluateIncidentParams {
  target: MonitorTargetRow;
  failureClass: string | null;
  now: Date;
  sendAlert?: AlertSender | null;
}

export interface IncidentOutcome {
  transition: IncidentTransition;
  incidentId: string | null;
  alerted: boolean;
}

/**
 * Applies the threshold decision to durable incident state.
 *
 * Called AFTER the check row is written, so the decision always includes the
 * check that just happened. Doing it the other way round would make an incident
 * open one check late, forever.
 *
 * Alerting is BEST-EFFORT and deliberately last: the durable state (the incident
 * row) is committed before any notification is attempted, so a queue hiccup
 * costs a notification, never a fact. That is the same ordering
 * `health/orchestrate.ts` uses, and the reason is the same -- a system that
 * loses the incident because it could not tell you about it is worse than one
 * that records it silently.
 */
export async function evaluateIncident(
  db: Db,
  params: EvaluateIncidentParams,
): Promise<IncidentOutcome> {
  const { target, now } = params;
  const active = await findActiveIncident(db, target.id);
  const statuses = await recentDecisiveStatuses(db, target.id);

  const transition = evaluateThreshold({
    recentStatuses: statuses,
    failureThreshold: target.failureThreshold,
    recoveryThreshold: target.recoveryThreshold,
    hasActiveIncident: active !== undefined,
  });

  if (transition === "none") {
    // Still broken: advance the incident's last-failure marker so an operator
    // can see it is ongoing rather than stale. Nothing else changes, and no
    // alert fires -- a still-open incident has already been announced.
    if (active !== undefined && statuses[0] === "down") {
      await db
        .update(monitorIncidents)
        .set({ lastFailureAt: now, updatedAt: now })
        .where(eq(monitorIncidents.id, active.id));
    }
    return { transition, incidentId: active?.id ?? null, alerted: false };
  }

  if (transition === "open") {
    const [opened] = await db
      .insert(monitorIncidents)
      .values({
        targetId: target.id,
        status: "open",
        failureClass: sanitizeMonitorFailureClass(params.failureClass),
        openedAt: now,
        lastFailureAt: now,
        createdAt: now,
        updatedAt: now,
      })
      // The partial unique index on (target_id) WHERE resolved_at IS NULL is the
      // real guarantee; this makes a lost race a no-op rather than a thrown
      // constraint violation. Two processes CAN evaluate the same target -- the
      // API owns the heartbeat target and the worker owns the rest, but nothing
      // structurally prevents an operator from misconfiguring that -- and the
      // correct outcome is one incident, not an error.
      .onConflictDoNothing()
      .returning({ id: monitorIncidents.id });

    if (opened === undefined) {
      return { transition: "none", incidentId: active?.id ?? null, alerted: false };
    }

    const alerted = await tryAlert(params.sendAlert, {
      kind: "opened",
      incidentId: opened.id,
      targetId: target.id,
      targetName: target.name,
      failureClass: sanitizeMonitorFailureClass(params.failureClass),
      dedupeKey: `monitor:${opened.id}:opened`,
    });
    return { transition, incidentId: opened.id, alerted };
  }

  // transition === "resolve"
  if (active === undefined) return { transition: "none", incidentId: null, alerted: false };

  await db
    .update(monitorIncidents)
    .set({ status: "resolved", resolvedAt: now, updatedAt: now })
    .where(and(eq(monitorIncidents.id, active.id), isNull(monitorIncidents.resolvedAt)));

  const alerted = await tryAlert(params.sendAlert, {
    kind: "resolved",
    incidentId: active.id,
    targetId: target.id,
    targetName: target.name,
    failureClass: sanitizeMonitorFailureClass(active.failureClass),
    dedupeKey: `monitor:${active.id}:resolved`,
  });
  return { transition, incidentId: active.id, alerted };
}

/**
 * Sends an alert without letting a queue failure undo committed state.
 *
 * Swallows deliberately: by the time this runs the incident row is committed, so
 * throwing would turn "we recorded an outage but could not push about it" into
 * "the whole pass failed", which loses the record too.
 */
async function tryAlert(
  sender: AlertSender | null | undefined,
  alert: IncidentAlert,
): Promise<boolean> {
  if (!sender) return false;
  try {
    await sender(alert);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acknowledges an incident without resolving it.
 *
 * Two separate facts: acknowledgement says a human has SEEN it, resolution says
 * the service recovered. Collapsing them would mean either acknowledging closed
 * an incident that is still broken, or that there was no way to record having
 * seen one. Only the machine resolves, and it does so from check history.
 */
export async function acknowledgeIncident(
  db: Db,
  incidentId: string,
  now: Date = new Date(),
): Promise<MonitorIncidentRow | undefined> {
  const [row] = await db
    .update(monitorIncidents)
    .set({ status: "acknowledged", acknowledgedAt: now, updatedAt: now })
    .where(
      and(
        eq(monitorIncidents.id, incidentId),
        isNull(monitorIncidents.resolvedAt),
        // Idempotent: acknowledging twice must not move the timestamp, or "when
        // did someone first see this?" becomes unanswerable.
        ne(monitorIncidents.status, "acknowledged"),
      ),
    )
    .returning();
  return row;
}

/** Live incident count, for tests and audits. */
export async function countActiveIncidents(db: Db, targetId?: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(monitorIncidents)
    .where(
      targetId === undefined
        ? isNull(monitorIncidents.resolvedAt)
        : and(eq(monitorIncidents.targetId, targetId), isNull(monitorIncidents.resolvedAt)),
    );
  return rows[0]?.n ?? 0;
}
