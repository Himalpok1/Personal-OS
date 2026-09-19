import type { AgentActivityParams } from "@personal-os/api-client";
import type { AgentPermission, AgentRegister, AgentUpdate } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { actionKeys } from "./actions";
import { api } from "./client";
import { requireDeviceToken, toastIfNotPaired, useDeviceToken } from "./device-token";

// Agent Gateway hooks -- the OWNER's side (Checkpoint 10.9, ADR-081 §9,
// ADR-082).
//
// Every read and every write here is DEVICE-BOUND: the paired device's
// bearer rides on each call (`api.listAgents(token)` and so on), the reads
// are `enabled: false` without one, and the mutations refuse before any
// network call with the not-paired error the toast names. There is no hook
// for the agent-facing `/agent/*` routes: the client is the owner's, and an
// agent's token is shown exactly once (`useRegisterAgent`'s response) and
// never stored by this app.
//
// A revoke or a permission change invalidates the agent domain AND the
// action domain: a revoke cancels nothing server-side, but the Action
// Center's rows attribute agent proposals by agent id, so a revoked agent
// must read as revoked there too, and a revoked write permission cancels the
// pending agent requests that needed it.

export const agentKeys = {
  /** Prefix every agent query shares, so one invalidate covers the domain. */
  all: ["agents"] as const,
  list: () => [...agentKeys.all, "list"] as const,
  detail: (id: string | null) => [...agentKeys.all, "detail", id] as const,
  activity: (id: string | null, params: AgentActivityParams) =>
    [...agentKeys.all, "activity", id, params] as const,
  permissions: () => [...agentKeys.all, "permissions"] as const,
};

// A malformed agent id in a route param (a stale deep link) must never reach
// the API -- the same guard queries/actions.ts's coerceActionIdParam applies.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function coerceAgentIdParam(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

/** `GET /agents` -- every registered agent, revoked ones included. */
export function useAgents() {
  const token = useDeviceToken();
  return useQuery({
    queryKey: agentKeys.list(),
    queryFn: () => api.listAgents(token as string),
    enabled: token !== null,
  });
}

/** `GET /agents/:id`. `enabled: false` while the id is null or malformed, or the device is unpaired. */
export function useAgent(id: string | null) {
  const token = useDeviceToken();
  return useQuery({
    queryKey: agentKeys.detail(id),
    queryFn: () => api.getAgent(token as string, id as string),
    enabled: token !== null && id !== null,
  });
}

/** `GET /agents/:id/activity` -- tool calls and action requests, newest first. */
export function useAgentActivity(id: string | null, params: AgentActivityParams = {}) {
  const token = useDeviceToken();
  return useQuery({
    queryKey: agentKeys.activity(id, params),
    queryFn: () => api.listAgentActivity(token as string, id as string, params),
    enabled: token !== null && id !== null,
  });
}

/** `GET /permissions/agent` -- the `agent` principal's grants, read and write, one item per capability. */
export function useAgentPermissions() {
  const token = useDeviceToken();
  return useQuery({
    queryKey: agentKeys.permissions(),
    queryFn: () => api.listAgentPermissions(token as string),
    enabled: token !== null,
  });
}

function useInvalidateAgents() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: agentKeys.all });
  };
}

/** The agent domain plus the action domain (attribution and cancelled-by-revoke rows). */
function useInvalidateAgentsAndActions() {
  const queryClient = useQueryClient();
  const invalidateAgents = useInvalidateAgents();
  return () => {
    invalidateAgents();
    void queryClient.invalidateQueries({ queryKey: actionKeys.all });
  };
}

/**
 * `POST /agents` -- the response is the ONLY time the raw token is visible.
 * The caller shows it once and keeps nothing; this hook caches nothing of it
 * (the mutation result lives only as long as the screen holds it).
 */
export function useRegisterAgent() {
  const token = useDeviceToken();
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (body: AgentRegister) => api.registerAgent(requireDeviceToken(token), body),
    onSuccess: invalidate,
    onError: toastIfNotPaired,
  });
}

/** `PATCH /agents/:id` -- a rename or a trust-level change. */
export function useUpdateAgent() {
  const token = useDeviceToken();
  const invalidate = useInvalidateAgentsAndActions();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AgentUpdate }) =>
      api.updateAgent(requireDeviceToken(token), id, body),
    onSuccess: invalidate,
    onError: toastIfNotPaired,
  });
}

/** `POST /agents/:id/revoke` -- the token stops working; the row and its history stay. The caller confirms first. */
export function useRevokeAgent() {
  const token = useDeviceToken();
  const invalidate = useInvalidateAgentsAndActions();
  return useMutation({
    mutationFn: (id: string) => api.revokeAgent(requireDeviceToken(token), id),
    onSuccess: invalidate,
    onError: toastIfNotPaired,
  });
}

/** `PATCH /permissions/agent/:permission` -- a revoke of a write permission cancels the pending agent requests that needed it. */
export function useUpdateAgentPermission() {
  const token = useDeviceToken();
  const invalidate = useInvalidateAgentsAndActions();
  return useMutation({
    mutationFn: ({ permission, granted }: { permission: AgentPermission; granted: boolean }) =>
      api.updateAgentPermission(requireDeviceToken(token), permission, { granted }),
    onSuccess: invalidate,
    onError: toastIfNotPaired,
  });
}
