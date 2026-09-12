import { monitorChecks, monitorIncidents, monitorTargets, type Db } from "@personal-os/db";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { MonitorIncidentRow } from "./incidents.js";
import {
  listMonitorTargets,
  type ListMonitorTargetsOptions,
  type MonitorTargetRow,
} from "./targets.js";

// Read models for the monitoring UI.
//
// ===========================================================================
// THESE RETURN FACTS. THEY DO NOT DECIDE WHAT A SCREEN SAYS.
// ===========================================================================
//
// No function here computes a "status" string, a colour, or a verdict. The
// health dashboard settled that question once already: the precedence between
// display states is the whole design, it belongs in one pure client module with
// its own tests (`resolveHealthConnectionState`), and duplicating it server-side
// would let the API and the screen disagree about the same target.
//
// What these DO own is the query shape -- specifically, avoiding the N+1 that a
// naive implementation reaches for. "Every target with its newest check" is one
// lateral join, not one query per target.

/** A target, its newest check, and its active incident if it has one. */
export interface MonitorTargetStatusRow {
  target: MonitorTargetRow;
  /**
   * Null when the target has NEVER been checked.
   *
   * This is a real and common answer -- a target seeded a minute ago, or one
   * disabled since creation, has no check at all -- and it is categorically
   * different from a check that found the service down. A caller that collapses
   * the two reports an outage for something nobody has looked at yet.
   */
  latestCheck: typeof monitorChecks.$inferSelect | null;
  /**
   * The open OR acknowledged incident.
   *
   * Acknowledgement does not resolve anything; it records that a human has seen
   * it. An acknowledged incident is therefore still active, and returning it
   * here (rather than filtering it out) is what lets a screen show "someone is
   * on this" instead of implying the outage ended.
   */
  activeIncident: MonitorIncidentRow | null;
}

/**
 * Every target with its newest check and active incident.
 *
 * Ordered by name so the list is stable across reloads. A status-first ordering
 * was considered and rejected: a list that reshuffles as services flap is
 * unreadable precisely when it matters most, and a screen that wants failures
 * first can sort what it is given.
 */
export async function listMonitorTargetStatus(
  db: Db,
  options: ListMonitorTargetsOptions = {},
): Promise<MonitorTargetStatusRow[]> {
  const targets = await listMonitorTargets(db, options);
  if (targets.length === 0) return [];

  // One row per target: its newest check. `distinct on` is the Postgres-native
  // way to say that, and it uses the (target_id, checked_at) index directly.
  const latest = await db
    .select()
    .from(monitorChecks)
    .where(
      sql`${monitorChecks.id} in (
        select distinct on (c.target_id) c.id
        from monitor_checks c
        order by c.target_id, c.checked_at desc, c.id desc
      )`,
    );
  const latestByTarget = new Map(latest.map((row) => [row.targetId, row]));

  const active = await db
    .select()
    .from(monitorIncidents)
    .where(isNull(monitorIncidents.resolvedAt));
  // The partial unique index guarantees at most one per target, so a Map cannot
  // silently drop a second one -- there cannot be a second one.
  const activeByTarget = new Map(active.map((row) => [row.targetId, row]));

  return targets.map((target) => ({
    target,
    latestCheck: latestByTarget.get(target.id) ?? null,
    activeIncident: activeByTarget.get(target.id) ?? null,
  }));
}

export interface ListIncidentsOptions {
  targetId?: string;
  /** When true, only incidents that are still open or acknowledged. */
  activeOnly?: boolean;
  limit: number;
  offset: number;
}

export interface IncidentWithTarget {
  incident: MonitorIncidentRow;
  targetName: string;
}

export interface ListIncidentsResult {
  items: IncidentWithTarget[];
  /** The honest total BEFORE the limit, so a screen can say "showing 20 of 57". */
  total: number;
}

/**
 * Incident history, newest first.
 *
 * `total` is counted separately rather than inferred from the page, for the
 * reason every honest-totals read model in this repository counts separately:
 * a caller that derives the total from what it received cannot distinguish "57
 * incidents, 20 shown" from "20 incidents", and the difference is the whole
 * point of showing a count.
 */
export async function listMonitorIncidents(
  db: Db,
  options: ListIncidentsOptions,
): Promise<ListIncidentsResult> {
  const filters = [
    options.targetId === undefined ? undefined : eq(monitorIncidents.targetId, options.targetId),
    options.activeOnly === true ? isNull(monitorIncidents.resolvedAt) : undefined,
  ].filter((f) => f !== undefined);
  const where = filters.length === 0 ? undefined : and(...filters);

  const [totalRow] = await db.select({ value: count() }).from(monitorIncidents).where(where);

  const rows = await db
    .select({ incident: monitorIncidents, targetName: monitorTargets.name })
    .from(monitorIncidents)
    .innerJoin(monitorTargets, eq(monitorTargets.id, monitorIncidents.targetId))
    .where(where)
    // opened_at then id: two incidents opened in the same millisecond would
    // otherwise order arbitrarily, and an unstable sort makes pagination drop
    // and repeat rows across pages.
    .orderBy(desc(monitorIncidents.openedAt), desc(monitorIncidents.id))
    .limit(options.limit)
    .offset(options.offset);

  return {
    items: rows.map((row) => ({ incident: row.incident, targetName: row.targetName })),
    total: totalRow?.value ?? 0,
  };
}

/** One incident with its target's name, or null. Used by the acknowledge route. */
export async function findIncidentWithTarget(
  db: Db,
  incidentId: string,
): Promise<IncidentWithTarget | null> {
  const [row] = await db
    .select({ incident: monitorIncidents, targetName: monitorTargets.name })
    .from(monitorIncidents)
    .innerJoin(monitorTargets, eq(monitorTargets.id, monitorIncidents.targetId))
    .where(eq(monitorIncidents.id, incidentId))
    .limit(1);
  return row ? { incident: row.incident, targetName: row.targetName } : null;
}
