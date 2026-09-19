// The Action Framework's READ projection (Checkpoint 10.8, ADR-078).
//
// ===========================================================================
// READS ONLY. WRITES LIVE IN apps/api/src/actions/service.ts.
// ===========================================================================
//
// Guard 7 (apps/api/src/ask/ai-egress-guard.test.ts) pins that this file
// contains no write verb, imports neither the AI SDK, a provider package,
// a memory module nor an AI lane, and that NO other read model imports it or
// names the action tables -- so an action request can never become an input
// to `buildTodayResponse`, the object both AI collectors are built from.
// read-models/user-export.ts reads the summary columns for GET /export and
// deliberately does not import this file (the Guard 6 arrangement, kept).
//
// Two honest computations happen here rather than in storage:
//   - a `pending` row whose `expires_at` has passed is PRESENTED as
//     `expired` (one `now` per request); the stored status flips only when
//     an approve/cancel next touches the row. Nothing sweeps.
//   - a grant with NO row at all for the `app` principal is PRESENTED as
//     granted (ADR-078 §3, ships ON); the row is materialised only by the
//     owner's own PATCH. Reads never write.
//
// Checkpoint 10.9 (ADR-081) adds the `agent` principal's two projections
// here rather than in read-models/agents.ts, because both are computed over
// THIS file's tables: `listAgentPermissionGrants` reads permission_grants
// under principal 'agent' across the wider AGENT_PERMISSIONS vocabulary
// (read + write), and `listActionRequestsForAgent` / `getActionRequestForAgent`
// project an agent's OWN rows of action_requests (filtered on `agent_id`)
// onto `AgentActionItem` -- never `input`, never `reason`, the two
// owner-only columns. `toActionRequestItem` itself is NOT widened: the
// deployed client parses it `.strict()`, and `agent_id`/`correlation_id`
// already ride on `principal`/`source_ref`. This file still never names the
// `agents` table (Guard 8 (b)): `agent_id` is an opaque column here.
import {
  ACTION_PERMISSIONS,
  ACTION_PERMISSION_DISCLOSURE_VERSION,
  ACTION_PERMISSION_LABELS,
  ACTION_REGISTRY,
  AGENT_PERMISSIONS,
  ActionListResponseSchema,
  ActionRequestItemSchema,
  ActionsSummarySchema,
  AgentActionItemSchema,
  AgentActionListResponseSchema,
  AgentPermissionGrantItemSchema,
  AgentPermissionsResponseSchema,
  PermissionGrantItemSchema,
  PermissionsResponseSchema,
  READ_PERMISSION_LABELS,
  actionsRequiring,
  isActionPermission,
  isReadPermission,
  permissionKind,
  toolsRequiring,
  type ActionListQuery,
  type ActionListResponse,
  type ActionPermission,
  type ActionPrincipal,
  type ActionRequestItem,
  type ActionsSummary,
  type AgentActionItem,
  type AgentActionListQuery,
  type AgentActionListResponse,
  type AgentPermission,
  type AgentPermissionGrantItem,
  type AgentPermissionsResponse,
  type PermissionGrantItem,
  type PermissionsResponse,
} from "@personal-os/schema";
import { actionRequests, permissionGrants, type Db } from "@personal-os/db";
import { and, asc, count, desc, eq, gt, gte, inArray, lte, max, or } from "drizzle-orm";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type ActionReader = Db | Tx;

type ActionRequestRow = typeof actionRequests.$inferSelect;
type PermissionGrantRow = typeof permissionGrants.$inferSelect;

const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** The status the owner sees: a pending row past its expiry reads as expired. */
export function presentedStatus(row: ActionRequestRow, now: Date): ActionRequestRow["status"] {
  if (row.status === "pending" && row.expiresAt.getTime() <= now.getTime()) return "expired";
  return row.status;
}

/** Named fields only -- never a spread -- so a future column is a decision. */
export function toActionRequestItem(
  row: ActionRequestRow,
  reversedByRequestId: string | null,
  now: Date,
): ActionRequestItem {
  return ActionRequestItemSchema.parse({
    id: row.id,
    client_uuid: row.clientUuid,
    action_id: row.actionId,
    input: row.input,
    principal: row.principal,
    status: presentedStatus(row, now),
    source: row.source,
    source_ref: row.sourceRef,
    reason: row.reason,
    input_summary: row.inputSummary,
    result_summary: row.resultSummary,
    target_type: row.targetType,
    target_id: row.targetId,
    error_class: row.errorClass,
    reverses_request_id: row.reversesRequestId,
    requested_at: row.requestedAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    approved_at: isoOrNull(row.approvedAt),
    finished_at: isoOrNull(row.finishedAt),
    reversed_by_request_id: reversedByRequestId,
  });
}

/**
 * The agent-facing projection of its own request (Checkpoint 10.9): the
 * lifecycle fields and the server-authored summaries, never the frozen
 * `input` and never the `reason` echoed back.
 */
export function toAgentActionItem(row: ActionRequestRow, now: Date): AgentActionItem {
  return AgentActionItemSchema.parse({
    id: row.id,
    action_id: row.actionId,
    status: presentedStatus(row, now),
    input_summary: row.inputSummary,
    result_summary: row.resultSummary,
    error_class: row.errorClass,
    target_type: row.targetType,
    target_id: row.targetId,
    correlation_id: row.correlationId,
    requested_at: row.requestedAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    approved_at: isoOrNull(row.approvedAt),
    finished_at: isoOrNull(row.finishedAt),
  });
}

/**
 * For each id, the COMPLETED request that reverses it, if any. A cancelled,
 * failed or pending reversal does not count as "undone".
 */
async function reversedByMap(db: ActionReader, ids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (ids.length === 0) return result;
  const rows = await db
    .select({ id: actionRequests.id, reverses: actionRequests.reversesRequestId })
    .from(actionRequests)
    .where(
      and(inArray(actionRequests.reversesRequestId, ids), eq(actionRequests.status, "completed")),
    )
    .orderBy(asc(actionRequests.finishedAt), asc(actionRequests.id));
  for (const row of rows) {
    if (row.reverses && !result.has(row.reverses)) result.set(row.reverses, row.id);
  }
  return result;
}

/** The stored-status predicate that matches one PRESENTED status. */
function statusPredicate(status: ActionListQuery["status"], now: Date) {
  if (!status) return undefined;
  if (status === "pending") {
    return and(eq(actionRequests.status, "pending"), gt(actionRequests.expiresAt, now));
  }
  if (status === "expired") {
    return or(
      eq(actionRequests.status, "expired"),
      and(eq(actionRequests.status, "pending"), lte(actionRequests.expiresAt, now)),
    );
  }
  return eq(actionRequests.status, status);
}

export async function listActionRequests(
  db: ActionReader,
  query: ActionListQuery,
  now: Date,
): Promise<ActionListResponse> {
  const where = and(
    statusPredicate(query.status, now),
    query.action_id ? eq(actionRequests.actionId, query.action_id) : undefined,
  );
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(actionRequests)
      .where(where)
      // Newest first; the tie-break ends in id so identical requests are
      // byte-identical (the search/read-model rule).
      .orderBy(desc(actionRequests.requestedAt), asc(actionRequests.id))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ total: count() }).from(actionRequests).where(where),
  ]);
  const reversed = await reversedByMap(
    db,
    rows.map((row) => row.id),
  );
  return ActionListResponseSchema.parse({
    items: rows.map((row) => toActionRequestItem(row, reversed.get(row.id) ?? null, now)),
    limit: query.limit,
    offset: query.offset,
    total: totals[0]?.total ?? 0,
  });
}

export async function getActionRequestItem(
  db: ActionReader,
  id: string,
  now: Date,
): Promise<ActionRequestItem | null> {
  const [row] = await db.select().from(actionRequests).where(eq(actionRequests.id, id));
  if (!row) return null;
  const reversed = await reversedByMap(db, [row.id]);
  return toActionRequestItem(row, reversed.get(row.id) ?? null, now);
}

// ---- The agent's own rows (Checkpoint 10.9) ---------------------------------

/**
 * An agent's proposals, newest first, scoped to `agent_id` in SQL so a
 * foreign row is simply absent -- the route answers 404, never 403, and
 * never confirms another agent's request exists.
 */
export async function listActionRequestsForAgent(
  db: ActionReader,
  agentId: string,
  query: AgentActionListQuery,
  now: Date,
): Promise<AgentActionListResponse> {
  const where = and(eq(actionRequests.agentId, agentId), statusPredicate(query.status, now));
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(actionRequests)
      .where(where)
      .orderBy(desc(actionRequests.requestedAt), asc(actionRequests.id))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ total: count() }).from(actionRequests).where(where),
  ]);
  return AgentActionListResponseSchema.parse({
    items: rows.map((row) => toAgentActionItem(row, now)),
    limit: query.limit,
    offset: query.offset,
    total: totals[0]?.total ?? 0,
  });
}

/**
 * The OWNER'S view of one agent's proposals (the activity screen): the full
 * `ActionRequestItem` the Action Center renders, paired with the row's
 * `correlation_id` -- which the strict, deployed item shape cannot carry, so
 * it rides beside the item rather than on it.
 */
export async function listActionRequestsByAgentForOwner(
  db: ActionReader,
  agentId: string,
  page: { limit: number; offset: number },
  now: Date,
): Promise<{ items: { item: ActionRequestItem; correlationId: string | null }[]; total: number }> {
  const where = eq(actionRequests.agentId, agentId);
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(actionRequests)
      .where(where)
      .orderBy(desc(actionRequests.requestedAt), asc(actionRequests.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(actionRequests).where(where),
  ]);
  const reversed = await reversedByMap(
    db,
    rows.map((row) => row.id),
  );
  return {
    items: rows.map((row) => ({
      item: toActionRequestItem(row, reversed.get(row.id) ?? null, now),
      correlationId: row.correlationId,
    })),
    total: totals[0]?.total ?? 0,
  };
}

export async function getActionRequestForAgent(
  db: ActionReader,
  agentId: string,
  id: string,
  now: Date,
): Promise<AgentActionItem | null> {
  const [row] = await db
    .select()
    .from(actionRequests)
    .where(and(eq(actionRequests.id, id), eq(actionRequests.agentId, agentId)));
  return row ? toAgentActionItem(row, now) : null;
}

// ---- Permission grants ------------------------------------------------------

/**
 * The most recent grant row per (principal, permission) -- live or revoked.
 * `null` means no row was ever written, which for `app` reads as granted.
 */
export async function latestGrantRows(
  db: ActionReader,
  principal: ActionPrincipal,
): Promise<Map<AgentPermission, PermissionGrantRow>> {
  const rows = await db
    .select()
    .from(permissionGrants)
    .where(eq(permissionGrants.principal, principal))
    .orderBy(desc(permissionGrants.grantedAt), desc(permissionGrants.createdAt));
  const latest = new Map<AgentPermission, PermissionGrantRow>();
  for (const row of rows) {
    const permission = row.permission as AgentPermission;
    if (!latest.has(permission)) latest.set(permission, row);
  }
  return latest;
}

/** ADR-078 §3: `app` is granted unless its latest row is revoked; `agent` only when a live row exists. */
export function grantIsLive(
  principal: ActionPrincipal,
  latest: PermissionGrantRow | undefined,
): boolean {
  if (!latest) return principal === "app";
  return latest.revokedAt === null;
}

/**
 * Read-only check used by the service before it writes anything, and by the
 * Agent Gateway before it runs a read tool. The vocabulary is the wider
 * AgentPermission (Checkpoint 10.9): a read permission has no row for `app`
 * and is never asked about for it.
 */
export async function isPermissionGranted(
  db: ActionReader,
  principal: ActionPrincipal,
  permission: AgentPermission,
): Promise<boolean> {
  const [latest] = await db
    .select()
    .from(permissionGrants)
    .where(
      and(eq(permissionGrants.principal, principal), eq(permissionGrants.permission, permission)),
    )
    .orderBy(desc(permissionGrants.grantedAt), desc(permissionGrants.createdAt))
    .limit(1);
  return grantIsLive(principal, latest);
}

async function usageByPermission(
  db: ActionReader,
): Promise<Map<ActionPermission, { count: number; lastUsedAt: Date | null }>> {
  const rows = await db
    .select({
      actionId: actionRequests.actionId,
      total: count(),
      lastUsedAt: max(actionRequests.finishedAt),
    })
    .from(actionRequests)
    .where(eq(actionRequests.status, "completed"))
    .groupBy(actionRequests.actionId);
  const usage = new Map<ActionPermission, { count: number; lastUsedAt: Date | null }>();
  for (const permission of ACTION_PERMISSIONS) {
    const ids = new Set<string>(actionsRequiring(permission));
    let total = 0;
    let lastUsedAt: Date | null = null;
    for (const row of rows) {
      if (!ids.has(row.actionId)) continue;
      total += row.total;
      if (row.lastUsedAt && (!lastUsedAt || row.lastUsedAt > lastUsedAt))
        lastUsedAt = row.lastUsedAt;
    }
    usage.set(permission, { count: total, lastUsedAt });
  }
  return usage;
}

export function toPermissionGrantItem(
  permission: ActionPermission,
  principal: ActionPrincipal,
  latest: PermissionGrantRow | undefined,
  usage: { count: number; lastUsedAt: Date | null },
): PermissionGrantItem {
  const granted = grantIsLive(principal, latest);
  const labels = ACTION_PERMISSION_LABELS[permission];
  return PermissionGrantItemSchema.parse({
    permission,
    principal,
    label: labels.label,
    description: labels.description,
    category: ACTION_REGISTRY[actionsRequiring(permission)[0]!].category,
    granted,
    granted_at: latest ? latest.grantedAt.toISOString() : null,
    revoked_at: latest ? isoOrNull(latest.revokedAt) : null,
    disclosure_version: latest ? latest.disclosureVersion : null,
    needs_reconsent:
      granted &&
      latest !== undefined &&
      latest.disclosureVersion < ACTION_PERMISSION_DISCLOSURE_VERSION,
    usage_count: usage.count,
    last_used_at: isoOrNull(usage.lastUsedAt),
    action_ids: actionsRequiring(permission),
  });
}

export async function listPermissionGrants(
  db: ActionReader,
  principal: ActionPrincipal = "app",
): Promise<PermissionsResponse> {
  const [latest, usage] = await Promise.all([
    latestGrantRows(db, principal),
    usageByPermission(db),
  ]);
  return PermissionsResponseSchema.parse({
    disclosure_version: ACTION_PERMISSION_DISCLOSURE_VERSION,
    items: ACTION_PERMISSIONS.map((permission) =>
      toPermissionGrantItem(
        permission,
        principal,
        latest.get(permission),
        usage.get(permission) ?? { count: 0, lastUsedAt: null },
      ),
    ),
  });
}

/**
 * The `agent` principal's grants across the whole AGENT_PERMISSIONS
 * vocabulary (Checkpoint 10.9, ADR-081 §4). Its own wire shape, not
 * `PermissionGrantItemSchema` -- that one is strict, carries a
 * `tasks|calendar` category and is parsed by the deployed client, so a read
 * permission could never ride on it. `grantIsLive("agent", undefined)` is
 * false: every agent grant ships OFF and is materialised only by the owner's
 * own device-bound PATCH.
 */
export function toAgentPermissionGrantItem(
  permission: AgentPermission,
  latest: PermissionGrantRow | undefined,
): AgentPermissionGrantItem {
  const granted = grantIsLive("agent", latest);
  const labels = isReadPermission(permission)
    ? READ_PERMISSION_LABELS[permission]
    : ACTION_PERMISSION_LABELS[permission];
  const category = isActionPermission(permission)
    ? ACTION_REGISTRY[actionsRequiring(permission)[0]!].category
    : READ_PERMISSION_LABELS[permission].category;
  return AgentPermissionGrantItemSchema.parse({
    permission,
    principal: "agent",
    kind: permissionKind(permission),
    category,
    label: labels.label,
    description: labels.description,
    granted,
    granted_at: latest ? latest.grantedAt.toISOString() : null,
    revoked_at: latest ? isoOrNull(latest.revokedAt) : null,
    disclosure_version: latest ? latest.disclosureVersion : null,
    needs_reconsent:
      granted &&
      latest !== undefined &&
      latest.disclosureVersion < ACTION_PERMISSION_DISCLOSURE_VERSION,
    action_ids: isActionPermission(permission) ? actionsRequiring(permission) : [],
    tool_names: isReadPermission(permission) ? toolsRequiring(permission) : [],
  });
}

export async function listAgentPermissionGrants(
  db: ActionReader,
): Promise<AgentPermissionsResponse> {
  const latest = await latestGrantRows(db, "agent");
  return AgentPermissionsResponseSchema.parse({
    disclosure_version: ACTION_PERMISSION_DISCLOSURE_VERSION,
    items: AGENT_PERMISSIONS.map((permission) =>
      toAgentPermissionGrantItem(permission, latest.get(permission)),
    ),
  });
}

export async function getAgentPermissionGrantItem(
  db: ActionReader,
  permission: AgentPermission,
): Promise<AgentPermissionGrantItem> {
  const latest = await latestGrantRows(db, "agent");
  return toAgentPermissionGrantItem(permission, latest.get(permission));
}

export async function getActionsSummary(db: ActionReader, now: Date): Promise<ActionsSummary> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [[pending], [completed], latest] = await Promise.all([
    db
      .select({ total: count() })
      .from(actionRequests)
      .where(and(eq(actionRequests.status, "pending"), gt(actionRequests.expiresAt, now))),
    db
      .select({ total: count() })
      .from(actionRequests)
      .where(and(eq(actionRequests.status, "completed"), gte(actionRequests.finishedAt, weekAgo))),
    latestGrantRows(db, "app"),
  ]);
  const granted = ACTION_PERMISSIONS.filter((permission) =>
    grantIsLive("app", latest.get(permission)),
  ).length;
  return ActionsSummarySchema.parse({
    pending_total: pending?.total ?? 0,
    completed_last_7_days: completed?.total ?? 0,
    permissions_granted: granted,
    permissions_total: ACTION_PERMISSIONS.length,
  });
}
