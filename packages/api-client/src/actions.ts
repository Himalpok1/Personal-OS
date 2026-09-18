import {
  ActionListResponseSchema,
  ActionRequestItemSchema,
  ActionsSummarySchema,
  PermissionUpdateResponseSchema,
  PermissionsResponseSchema,
  type ActionListQuery,
  type ActionListResponse,
  type ActionPermission,
  type ActionRequestCreate,
  type ActionRequestItem,
  type ActionsSummary,
  type PermissionGrantItem,
  type PermissionUpdate,
  type PermissionUpdateResponse,
  type PermissionsResponse,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

// Checkpoint 10.8 (ADR-078) -- the Action Framework.
//
// A client PROPOSES an action (POST /actions -> a pending request), and the
// owner APPROVES or CANCELS it. Approval executes synchronously inside that
// request and returns the terminal row (completed or failed) -- there is no
// method that executes without an approve call, and `principal` is never
// client-supplied (always `app`). Permissions are the owner's grants to the
// `app` principal; a revoke cancels the pending requests that needed it.

export type {
  ActionListQuery,
  ActionListResponse,
  ActionPermission,
  ActionRequestCreate,
  ActionRequestItem,
  ActionsSummary,
  PermissionGrantItem,
  PermissionUpdate,
  PermissionUpdateResponse,
  PermissionsResponse,
};

export type ActionListParams = Partial<ActionListQuery>;

export async function listActions(
  baseUrl: string,
  params: ActionListParams = {},
): Promise<ActionListResponse> {
  return await fetchJson(baseUrl, `/actions${buildQuery(params)}`, ActionListResponseSchema);
}

export async function getActionsSummary(baseUrl: string): Promise<ActionsSummary> {
  return await fetchJson(baseUrl, "/actions/summary", ActionsSummarySchema);
}

export async function getAction(baseUrl: string, id: string): Promise<ActionRequestItem> {
  return await fetchJson(baseUrl, `/actions/${encodeURIComponent(id)}`, ActionRequestItemSchema);
}

/** Creates a PENDING request (201), or returns the existing one for a repeated `client_uuid` (200). */
export async function createActionRequest(
  baseUrl: string,
  body: ActionRequestCreate,
): Promise<ActionRequestItem> {
  return await fetchJson(baseUrl, "/actions", ActionRequestItemSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * The owner's approval. Executes inside this request and returns the row in
 * its terminal state -- `completed`, or `failed` with an `error_class`.
 */
export async function approveAction(baseUrl: string, id: string): Promise<ActionRequestItem> {
  return await fetchJson(
    baseUrl,
    `/actions/${encodeURIComponent(id)}/approve`,
    ActionRequestItemSchema,
    {
      method: "POST",
    },
  );
}

export async function cancelAction(baseUrl: string, id: string): Promise<ActionRequestItem> {
  return await fetchJson(
    baseUrl,
    `/actions/${encodeURIComponent(id)}/cancel`,
    ActionRequestItemSchema,
    {
      method: "POST",
    },
  );
}

export async function listPermissions(baseUrl: string): Promise<PermissionsResponse> {
  return await fetchJson(baseUrl, "/permissions", PermissionsResponseSchema);
}

export async function updatePermission(
  baseUrl: string,
  permission: ActionPermission,
  body: PermissionUpdate,
): Promise<PermissionUpdateResponse> {
  return await fetchJson(
    baseUrl,
    `/permissions/${encodeURIComponent(permission)}`,
    PermissionUpdateResponseSchema,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}
