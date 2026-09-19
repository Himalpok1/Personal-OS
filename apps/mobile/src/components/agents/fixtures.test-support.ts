import type {
  ActionRequestItem,
  Agent,
  AgentActivityItem,
  AgentPermissionGrantItem,
  AgentToolCall,
} from "@personal-os/schema";
import { createEventRequest } from "@/components/actions/fixtures.test-support";

// Shared fixture builders for the agent component tests (Checkpoint 10.9).
// Not a test file itself (no `.test.` in the name, so vitest never collects
// it) and never imported by application code.

export const AGENT_ID = "11111111-1111-4111-8111-111111111111";
export const REVOKED_AGENT_ID = "22222222-2222-4222-8222-222222222222";
export const CORRELATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
export const CORRELATION_B = "aaaaaaaa-0000-4000-8000-000000000002";
export const TOOL_CALL_ID = "33333333-3333-4333-8333-333333333333";

export function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: AGENT_ID,
    name: "Ray",
    trust_level: "propose",
    disclosure_version: "2026-09-18",
    created_at: "2026-09-17T10:00:00Z",
    updated_at: "2026-09-17T10:00:00Z",
    last_seen_at: "2026-09-18T14:00:00Z",
    revoked_at: null,
    ...overrides,
  };
}

export function revokedAgent(overrides: Partial<Agent> = {}): Agent {
  return agent({
    id: REVOKED_AGENT_ID,
    name: "Old helper",
    trust_level: "read",
    revoked_at: "2026-09-18T09:00:00Z",
    ...overrides,
  });
}

/** An agent-sourced request: `source_ref` is the agent's id, `reason` the agent's own words. */
export function agentRequest(overrides: Partial<ActionRequestItem> = {}): ActionRequestItem {
  return createEventRequest({
    source: "agent",
    source_ref: AGENT_ID,
    reason: "You have a free hour before the lecture and this is due tonight",
    ...overrides,
  });
}

export function toolCall(overrides: Partial<AgentToolCall> = {}): AgentToolCall {
  return {
    id: TOOL_CALL_ID,
    agent_id: AGENT_ID,
    correlation_id: CORRELATION_A,
    tool_name: "get_today_context",
    status: "completed",
    error_class: null,
    chars_returned: 1200,
    duration_ms: 40,
    called_at: "2026-09-18T14:00:00Z",
    ...overrides,
  };
}

export function toolCallActivity(overrides: Partial<AgentToolCall> = {}): AgentActivityItem {
  const call = toolCall(overrides);
  return {
    kind: "tool_call",
    at: call.called_at,
    correlation_id: call.correlation_id,
    tool_call: call,
  };
}

export function requestActivity(
  overrides: Partial<ActionRequestItem> = {},
  correlationId: string | null = CORRELATION_A,
): AgentActivityItem {
  const request = agentRequest(overrides);
  return {
    kind: "action_request",
    at: request.requested_at,
    correlation_id: correlationId,
    request,
  };
}

export function readGrant(
  overrides: Partial<AgentPermissionGrantItem> = {},
): AgentPermissionGrantItem {
  return {
    permission: "context.read",
    principal: "agent",
    kind: "read",
    category: "context",
    label: "Today, calendar & tasks",
    description:
      "Search by title and read your schedule, task list and today's overview — titles, times and ids, never a note or task body.",
    granted: true,
    granted_at: "2026-09-17T10:00:00Z",
    revoked_at: null,
    disclosure_version: "2026-09-17",
    needs_reconsent: false,
    action_ids: [],
    tool_names: [
      "search_personal_items",
      "get_today_context",
      "get_calendar_context",
      "get_task_context",
    ],
    ...overrides,
  };
}

export function writeGrant(
  overrides: Partial<AgentPermissionGrantItem> = {},
): AgentPermissionGrantItem {
  return {
    permission: "tasks.write",
    principal: "agent",
    kind: "write",
    category: "tasks",
    label: "Tasks",
    description: "Create, complete, reopen and archive tasks — only after you approve each one.",
    granted: false,
    granted_at: null,
    revoked_at: null,
    disclosure_version: null,
    needs_reconsent: false,
    action_ids: ["create_task", "archive_task", "complete_task", "reopen_task"],
    tool_names: [],
    ...overrides,
  };
}
