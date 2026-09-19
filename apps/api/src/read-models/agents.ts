// The Agent Gateway's READ projection over its own two tables (Checkpoint
// 10.9, ADR-081).
//
// ===========================================================================
// READS ONLY, TWO TABLES ONLY. WRITES LIVE IN apps/api/src/agent/service.ts.
// ===========================================================================
//
// Guard 8 (apps/api/src/ask/ai-egress-guard.test.ts) pins that this file
// carries no write verb and that no AI lane, AI route file, other read model
// or worker file imports it or names `agents`/`agentToolCalls`. It also
// never names `actionRequests` or `permissionGrants`: an agent's PROPOSALS
// are projected by read-models/actions.ts (`listActionRequestsForAgent`),
// its GRANTS by the same file (`listAgentPermissionGrants`), and the
// activity screen merges the two lists in agent/activity.ts -- no single
// query here may join across the Guard 7 / Guard 8 line.
//
// What is computed here rather than stored:
//   - the per-correlation budget (`budgetForCorrelation`): the sum of
//     `chars_returned` and the count of rows that CONSUMED budget -- a
//     `completed` or `failed` call. A `refused` row is audited (the owner
//     sees what the agent tried) but never charged, so a run of refusals
//     cannot exhaust a budget the agent never spent.
//   - the per-agent rolling rate (`callsInLastMinute`): EVERY row in the last
//     60 s, refusals included -- a refusal is still a request the gateway
//     had to answer, which is exactly what a rate limit bounds.
import { agentToolCalls, agents, type Db } from "@personal-os/db";
import {
  AgentSchema,
  AgentToolCallSchema,
  type Agent,
  type AgentToolCall,
} from "@personal-os/schema";
import { and, asc, count, desc, eq, gte, inArray, sum } from "drizzle-orm";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type AgentReader = Db | Tx;

type AgentRow = typeof agents.$inferSelect;
type AgentToolCallRow = typeof agentToolCalls.$inferSelect;

const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** Named fields only -- never a spread -- so `token_hash` can never ride onto the wire. */
export function toAgentItem(row: AgentRow): Agent {
  return AgentSchema.parse({
    id: row.id,
    name: row.name,
    trust_level: row.trustLevel,
    disclosure_version: row.disclosureVersion,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    last_seen_at: isoOrNull(row.lastSeenAt),
    revoked_at: isoOrNull(row.revokedAt),
  });
}

export function toAgentToolCallItem(row: AgentToolCallRow): AgentToolCall {
  return AgentToolCallSchema.parse({
    id: row.id,
    agent_id: row.agentId,
    correlation_id: row.correlationId,
    tool_name: row.toolName,
    status: row.status,
    error_class: row.errorClass,
    chars_returned: row.charsReturned,
    duration_ms: row.durationMs,
    called_at: row.calledAt.toISOString(),
  });
}

/** Every registered agent, revoked ones included -- revocation is a state the owner sees, never a deletion. */
export async function listAgents(db: AgentReader): Promise<Agent[]> {
  const rows = await db.select().from(agents).orderBy(desc(agents.createdAt), asc(agents.id));
  return rows.map(toAgentItem);
}

export async function getAgent(db: AgentReader, id: string): Promise<Agent | null> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id));
  return row ? toAgentItem(row) : null;
}

export async function listToolCallsForAgent(
  db: AgentReader,
  agentId: string,
  page: { limit: number; offset: number },
): Promise<{ items: AgentToolCall[]; total: number }> {
  const where = eq(agentToolCalls.agentId, agentId);
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(agentToolCalls)
      .where(where)
      // Newest first; the tie-break ends in id (the read-model rule).
      .orderBy(desc(agentToolCalls.calledAt), asc(agentToolCalls.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(agentToolCalls).where(where),
  ]);
  return { items: rows.map(toAgentToolCallItem), total: totals[0]?.total ?? 0 };
}

/**
 * What one correlation has already spent. Only `completed` and `failed`
 * rows count: a refusal returned nothing and ran nothing.
 */
export async function budgetForCorrelation(
  db: AgentReader,
  correlationId: string,
): Promise<{ calls: number; chars: number }> {
  const [row] = await db
    .select({ calls: count(), chars: sum(agentToolCalls.charsReturned) })
    .from(agentToolCalls)
    .where(
      and(
        eq(agentToolCalls.correlationId, correlationId),
        inArray(agentToolCalls.status, ["completed", "failed"]),
      ),
    );
  // drizzle's `sum` comes back as a string (numeric) or null on no rows.
  const chars = row?.chars === null || row?.chars === undefined ? 0 : Number(row.chars);
  return { calls: row?.calls ?? 0, chars: Number.isFinite(chars) ? chars : 0 };
}

/** Every call this agent made in the 60 s before `now`, refusals included. */
export async function callsInLastMinute(
  db: AgentReader,
  agentId: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - 60_000);
  const [row] = await db
    .select({ total: count() })
    .from(agentToolCalls)
    .where(and(eq(agentToolCalls.agentId, agentId), gte(agentToolCalls.calledAt, since)));
  return row?.total ?? 0;
}
