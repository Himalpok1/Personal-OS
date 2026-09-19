import type { Db } from "@personal-os/db";
import {
  AgentActivityResponseSchema,
  type AgentActivityItem,
  type AgentActivityQuery,
  type AgentActivityResponse,
} from "@personal-os/schema";
import { listActionRequestsByAgentForOwner } from "../read-models/actions.js";
import { listToolCallsForAgent } from "../read-models/agents.js";

// GET /agents/:id/activity (Checkpoint 10.9, ADR-081 §7): what one agent
// did, newest first, for the OWNER.
//
// ===========================================================================
// A TWO-LIST MERGE, ON PURPOSE.
// ===========================================================================
//
// An agent's reads live in `agent_tool_calls` (read-models/agents.ts) and
// its proposals in `action_requests` (read-models/actions.ts), and Guards 7
// and 8 pin that no single file names both tables -- the action read model
// may not import the agent read model, and vice versa. So no one SQL
// statement can produce this timeline. Instead each side is fetched
// separately, each already sorted newest-first and each with an honest
// total, and the two are merged here by `at` descending and sliced to the
// page. Correctness of the merge: both lists are fetched to depth
// `offset + limit`, so every row that could land inside the requested page
// of the merged order is present in one of them.
//
// The action side carries the FULL owner-facing `ActionRequestItem` (the
// reason, the frozen input summary, the reversal pointer) -- this is the
// owner reading, not the agent -- projected by the same `toActionRequestItem`
// the Action Center uses, filtered to this agent's rows. `correlation_id` on
// each line is what the client groups on ("Read: Today · Calendar →
// Proposed: … → Approved"); the strict item shape cannot carry it, so the
// read model returns it beside the item.

export async function listAgentActivity(
  db: Db,
  agentId: string,
  query: AgentActivityQuery,
  now: Date,
): Promise<AgentActivityResponse> {
  const depth = query.offset + query.limit;
  const [calls, requests] = await Promise.all([
    listToolCallsForAgent(db, agentId, { limit: depth, offset: 0 }),
    listActionRequestsByAgentForOwner(db, agentId, { limit: depth, offset: 0 }, now),
  ]);

  const merged: AgentActivityItem[] = [
    ...calls.items.map((call): AgentActivityItem => ({
      kind: "tool_call",
      at: call.called_at,
      correlation_id: call.correlation_id,
      tool_call: call,
    })),
    ...requests.items.map(({ item, correlationId }): AgentActivityItem => ({
      kind: "action_request",
      at: item.requested_at,
      correlation_id: correlationId,
      request: item,
    })),
  ];
  // Newest first; a tie breaks tool calls before requests (a read precedes
  // the proposal it informed), then by id so the page is byte-identical
  // across identical requests.
  merged.sort((a, b) => {
    const byAt = b.at.localeCompare(a.at);
    if (byAt !== 0) return byAt;
    if (a.kind !== b.kind) return a.kind === "tool_call" ? -1 : 1;
    return idOf(a).localeCompare(idOf(b));
  });

  return AgentActivityResponseSchema.parse({
    items: merged.slice(query.offset, query.offset + query.limit),
    limit: query.limit,
    offset: query.offset,
    total: calls.total + requests.total,
  });
}

function idOf(item: AgentActivityItem): string {
  return item.kind === "tool_call" ? item.tool_call.id : item.request.id;
}
