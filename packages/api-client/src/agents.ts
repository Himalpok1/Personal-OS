import {
  AgentActivityResponseSchema,
  AgentListResponseSchema,
  AgentPermissionUpdateResponseSchema,
  AgentPermissionsResponseSchema,
  AgentRegisterResponseSchema,
  AgentRegisterSchema,
  AgentSchema,
  AgentUpdateSchema,
  type Agent,
  type AgentActivityItem,
  type AgentActivityQuery,
  type AgentActivityResponse,
  type AgentListResponse,
  type AgentPermission,
  type AgentPermissionGrantItem,
  type AgentPermissionUpdateResponse,
  type AgentPermissionsResponse,
  type AgentRegister,
  type AgentRegisterResponse,
  type AgentToolCall,
  type AgentTrustLevel,
  type AgentUpdate,
  type PermissionUpdate,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

// Checkpoint 10.9 (ADR-081) -- the OWNER's side of the Agent Gateway.
//
// Everything here is what the paired client does on the owner's behalf:
// register an agent (the raw token comes back exactly once), pause or
// promote it, revoke it, read what it did, and grant or revoke the `agent`
// principal's permissions. Every one of these routes is device-bound
// (ADR-082): `token` is the paired device's bearer, never an agent's.
//
// There is deliberately NO client for the agent-facing `/agent/*` routes --
// the client is the owner's; an agent speaks the manifest, not this package.

export type {
  Agent,
  AgentActivityItem,
  AgentActivityQuery,
  AgentActivityResponse,
  AgentListResponse,
  AgentPermission,
  AgentPermissionGrantItem,
  AgentPermissionUpdateResponse,
  AgentPermissionsResponse,
  AgentRegister,
  AgentRegisterResponse,
  AgentToolCall,
  AgentTrustLevel,
  AgentUpdate,
};

export type AgentActivityParams = Partial<AgentActivityQuery>;

function authed(token: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } };
}

export async function listAgents(baseUrl: string, token: string): Promise<AgentListResponse> {
  return await fetchJson(baseUrl, "/agents", AgentListResponseSchema, authed(token));
}

export async function getAgent(baseUrl: string, token: string, id: string): Promise<Agent> {
  return await fetchJson(baseUrl, `/agents/${encodeURIComponent(id)}`, AgentSchema, authed(token));
}

/** 201 with the raw token -- the ONLY time it is ever visible. Store nothing but show it once. */
export async function registerAgent(
  baseUrl: string,
  token: string,
  body: AgentRegister,
): Promise<AgentRegisterResponse> {
  const parsed = AgentRegisterSchema.parse(body);
  return await fetchJson(
    baseUrl,
    "/agents",
    AgentRegisterResponseSchema,
    authed(token, { method: "POST", body: JSON.stringify(parsed) }),
  );
}

export async function updateAgent(
  baseUrl: string,
  token: string,
  id: string,
  body: AgentUpdate,
): Promise<Agent> {
  const parsed = AgentUpdateSchema.parse(body);
  return await fetchJson(
    baseUrl,
    `/agents/${encodeURIComponent(id)}`,
    AgentSchema,
    authed(token, { method: "PATCH", body: JSON.stringify(parsed) }),
  );
}

/** Sets `revoked_at`; the row and every audit row that names it stay. */
export async function revokeAgent(baseUrl: string, token: string, id: string): Promise<Agent> {
  return await fetchJson(
    baseUrl,
    `/agents/${encodeURIComponent(id)}/revoke`,
    AgentSchema,
    authed(token, { method: "POST" }),
  );
}

export async function listAgentActivity(
  baseUrl: string,
  token: string,
  id: string,
  params: AgentActivityParams = {},
): Promise<AgentActivityResponse> {
  return await fetchJson(
    baseUrl,
    `/agents/${encodeURIComponent(id)}/activity${buildQuery(params)}`,
    AgentActivityResponseSchema,
    authed(token),
  );
}

export async function listAgentPermissions(
  baseUrl: string,
  token: string,
): Promise<AgentPermissionsResponse> {
  return await fetchJson(
    baseUrl,
    "/permissions/agent",
    AgentPermissionsResponseSchema,
    authed(token),
  );
}

export async function updateAgentPermission(
  baseUrl: string,
  token: string,
  permission: AgentPermission,
  body: PermissionUpdate,
): Promise<AgentPermissionUpdateResponse> {
  return await fetchJson(
    baseUrl,
    `/permissions/agent/${encodeURIComponent(permission)}`,
    AgentPermissionUpdateResponseSchema,
    authed(token, { method: "PATCH", body: JSON.stringify(body) }),
  );
}
