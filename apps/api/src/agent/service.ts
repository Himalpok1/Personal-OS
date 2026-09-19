import { generateAgentToken, hashAgentToken } from "@personal-os/core";
import { agentToolCalls, agents, type Db } from "@personal-os/db";
import {
  AGENT_DISCLOSURE_VERSION,
  type Agent,
  type AgentRegister,
  type AgentToolCallStatus,
  type AgentToolErrorClass,
  type AgentUpdate,
  type ReadToolName,
} from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { toAgentItem } from "../read-models/agents.js";

// The Agent Gateway's WRITE side (Checkpoint 10.9, ADR-081 §3, §7). Exactly
// three write verbs exist in the whole gateway and all three live here,
// pinned by Guard 8 (a): INSERT into `agents` (registration), UPDATE of
// `agents` (rename / trust change / revoke) and INSERT into
// `agent_tool_calls` (one audit row per tool call, refusals included). No
// DELETE anywhere: revocation is a timestamp, and the audit rows keep their
// attribution for as long as retention keeps them.
//
// The raw bearer token exists in this process for the duration of ONE
// registration response. It is generated here, hashed here, returned to
// the device-bound owner route once, and never logged, stored or read back
// -- the devices token discipline (ADR-028). Every log line below carries
// ids, tool names, correlation ids, statuses and error classes only.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type AgentWriter = Db | Tx;

export class AgentNotFoundError extends Error {
  constructor() {
    super("agent not found");
    this.name = "AgentNotFoundError";
  }
}

export class AgentRevokedError extends Error {
  constructor() {
    super("agent is revoked");
    this.name = "AgentRevokedError";
  }
}

export interface RegisterAgentResult {
  agent: Agent;
  /** Returned exactly once. Only its sha256 is stored. */
  token: string;
}

export async function registerAgent(
  app: FastifyInstance,
  body: AgentRegister,
  now: Date,
): Promise<RegisterAgentResult> {
  const token = generateAgentToken();
  const [row] = await app.db
    .insert(agents)
    .values({
      name: body.name,
      trustLevel: body.trust_level,
      tokenHash: hashAgentToken(token),
      disclosureVersion: AGENT_DISCLOSURE_VERSION,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error("insert into agents returned no row");
  app.log.info({ agentId: row.id }, "agent.registered");
  return { agent: toAgentItem(row), token };
}

async function loadAgentRow(db: AgentWriter, id: string) {
  const [row] = await db.select().from(agents).where(eq(agents.id, id));
  if (!row) throw new AgentNotFoundError();
  return row;
}

/** Throws `AgentNotFoundError` (404) or `AgentRevokedError` (409): a revoked agent is frozen, never edited. */
export async function updateAgent(
  app: FastifyInstance,
  id: string,
  body: AgentUpdate,
  now: Date,
): Promise<Agent> {
  const existing = await loadAgentRow(app.db, id);
  if (existing.revokedAt) throw new AgentRevokedError();
  const [row] = await app.db
    .update(agents)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.trust_level !== undefined && { trustLevel: body.trust_level }),
      updatedAt: now,
    })
    .where(eq(agents.id, id))
    .returning();
  if (!row) throw new Error("update on agents returned no row for an id that was just found");
  app.log.info({ agentId: row.id }, "agent.updated");
  return toAgentItem(row);
}

/** Idempotent: the first call sets `revoked_at`; a repeat returns the row unchanged. Throws `AgentNotFoundError`. */
export async function revokeAgent(app: FastifyInstance, id: string, now: Date): Promise<Agent> {
  const existing = await loadAgentRow(app.db, id);
  if (existing.revokedAt) return toAgentItem(existing);
  const [row] = await app.db
    .update(agents)
    .set({ revokedAt: now, updatedAt: now })
    .where(eq(agents.id, id))
    .returning();
  if (!row) throw new Error("update on agents returned no row for an id that was just found");
  app.log.info({ agentId: row.id }, "agent.revoked");
  return toAgentItem(row);
}

export interface ToolCallRecord {
  agentId: string;
  correlationId: string;
  toolName: ReadToolName;
  status: AgentToolCallStatus;
  /** Paired with `status` by CHECK: null iff `completed`. */
  errorClass: AgentToolErrorClass | null;
  /** The serialized output's length; 0 for a refusal or a failure. */
  charsReturned: number;
  /** Null while a reserved row awaits its settlement (finishToolCall). */
  durationMs: number | null;
  calledAt: Date;
}

/**
 * One audit row per outcome -- completed, refused or failed. Records THAT a
 * read happened and how much left, never what: no input, no output.
 */
export async function recordToolCall(db: AgentWriter, record: ToolCallRecord): Promise<string> {
  const [row] = await db
    .insert(agentToolCalls)
    .values({
      agentId: record.agentId,
      correlationId: record.correlationId,
      toolName: record.toolName,
      status: record.status,
      errorClass: record.errorClass,
      charsReturned: record.charsReturned,
      durationMs: record.durationMs,
      calledAt: record.calledAt,
    })
    .returning({ id: agentToolCalls.id });
  return row!.id;
}

/**
 * Completes a RESERVED audit row after the tool ran (10.9 adversarial
 * review, finding A): admission inserts the row as `completed` with zero
 * chars under the budget lock, so the call is counted before the tool runs;
 * this settles its real outcome afterwards -- the chars it returned, or the
 * failure class. The only UPDATE the gateway ever makes to the audit table.
 */
export async function finishToolCall(
  db: AgentWriter,
  id: string,
  patch: {
    status: "completed" | "refused" | "failed";
    errorClass: string | null;
    charsReturned: number;
    durationMs: number;
  },
): Promise<void> {
  await db
    .update(agentToolCalls)
    .set({
      status: patch.status,
      errorClass: patch.errorClass,
      charsReturned: patch.charsReturned,
      durationMs: patch.durationMs,
    })
    .where(eq(agentToolCalls.id, id));
}
