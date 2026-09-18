import type { ActionListParams } from "@personal-os/api-client";
import type { ActionPermission, ActionRequestCreate } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// Agent Foundation & Action Framework hooks (Checkpoint 10.8, ADR-078).
//
// Perimeter-only, like the memory hooks: the action routes install no device
// auth (ADR-078 §5), so no bearer token is threaded here.
//
// The shape the framework fixes: a client PROPOSES (`useCreateActionRequest`
// -> a pending row), and the owner APPROVES or CANCELS. Approval executes
// synchronously inside that request and returns the terminal row -- there is
// no hook that runs anything without an approve call, and the executed
// action changes the task/event read models, so approve, cancel and a
// permission change (a revoke cancels pending work) invalidate the same keys
// a direct task/event write does: `["tasks"]`, `["events"]`, `["agenda"]`,
// `["reminders"]`, `["today"]` -- plus the action domain itself.

export const actionKeys = {
  /** Prefix every action query shares, so one invalidate covers the domain. */
  all: ["actions"] as const,
  list: (params: ActionListParams) => [...actionKeys.all, "list", params] as const,
  summary: () => [...actionKeys.all, "summary"] as const,
  detail: (id: string | null) => [...actionKeys.all, "detail", id] as const,
  permissions: () => [...actionKeys.all, "permissions"] as const,
};

/**
 * The read models an EXECUTED action can change (ADR-078 §2: every handler
 * calls the same service the direct route calls, so the same caches go
 * stale). Exported so a test can pin the set.
 */
export const ACTION_EXECUTION_INVALIDATION_KEYS = [
  ["tasks"],
  ["events"],
  ["agenda"],
  ["reminders"],
  ["occurrences"],
] as const;

// A malformed request id in a route param (a stale deep link) must never
// reach the API -- the same guard queries/memory.ts's coerceMemoryIdParam applies.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function coerceActionIdParam(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

/** `GET /actions` -- newest first; `status` narrows (the Pending tab, the Today card). */
export function useActions(params: ActionListParams = {}) {
  return useQuery({
    queryKey: actionKeys.list(params),
    queryFn: () => api.listActions(params),
  });
}

/** `GET /actions/summary` -- the Settings card's counts. */
export function useActionsSummary() {
  return useQuery({
    queryKey: actionKeys.summary(),
    queryFn: () => api.getActionsSummary(),
  });
}

/** `GET /actions/:id`. `enabled: false` while the id is null or malformed. */
export function useAction(id: string | null) {
  return useQuery({
    queryKey: actionKeys.detail(id),
    queryFn: () => api.getAction(id as string),
    enabled: id !== null,
  });
}

/** `GET /permissions` -- the `app` principal's grants, one item per capability. */
export function usePermissions() {
  return useQuery({
    queryKey: actionKeys.permissions(),
    queryFn: () => api.listPermissions(),
  });
}

/** The action domain plus Today: a new pending row changes the Today card and the Settings chip. */
function useInvalidateActions() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: actionKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["today"] });
  };
}

/** Everything `useInvalidateActions` covers, plus the read models an executed action changes. */
function useInvalidateAfterExecution() {
  const queryClient = useQueryClient();
  const invalidateActions = useInvalidateActions();
  return () => {
    invalidateActions();
    for (const queryKey of ACTION_EXECUTION_INVALIDATION_KEYS) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
}

/** `POST /actions` -- a PENDING request. Nothing runs until the owner approves it. */
export function useCreateActionRequest() {
  const invalidate = useInvalidateActions();
  return useMutation({
    mutationFn: (body: ActionRequestCreate) => api.createActionRequest(body),
    onSuccess: invalidate,
  });
}

/**
 * `POST /actions/:id/approve` -- the owner's tap. The row comes back
 * terminal (`completed` or `failed`); the caller reads its status rather
 * than assuming success.
 */
export function useApproveAction() {
  const invalidate = useInvalidateAfterExecution();
  return useMutation({
    mutationFn: (id: string) => api.approveAction(id),
    onSuccess: invalidate,
  });
}

/** `POST /actions/:id/cancel` -- nothing ran, so only the action caches (and Today) move. */
export function useCancelAction() {
  const invalidate = useInvalidateAfterExecution();
  return useMutation({
    mutationFn: (id: string) => api.cancelAction(id),
    onSuccess: invalidate,
  });
}

/** `PATCH /permissions/:permission` -- a revoke cancels every pending request that needed it. */
export function useUpdatePermission() {
  const invalidate = useInvalidateAfterExecution();
  return useMutation({
    mutationFn: ({ permission, granted }: { permission: ActionPermission; granted: boolean }) =>
      api.updatePermission(permission, { granted }),
    onSuccess: invalidate,
  });
}
