import type { MonitorTargetCreate, MonitorTargetUpdate } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// Service monitoring queries (Checkpoint 7.6). CRUD added Checkpoint 8.6D,
// perimeter-only like everything else here -- these hooks are thin wrappers
// over `@personal-os/api-client`'s already-validated monitor methods.

export const monitorKey = ["monitor"] as const;
const targetsKey = ["monitor", "targets"] as const;
/** Exported so `monitor.test.ts` can assert the key shape without a live query. */
export const monitorTargetKey = (id: string) => ["monitor", "targets", id] as const;
const incidentsKey = (activeOnly: boolean) => ["monitor", "incidents", { activeOnly }] as const;

export function useMonitorOverview() {
  return useQuery({ queryKey: targetsKey, queryFn: () => api.getMonitorOverview() });
}

/** One target's full configuration, archived or not -- for the detail/edit screen. */
export function useMonitorTarget(id: string | undefined) {
  return useQuery({
    queryKey: monitorTargetKey(id ?? ""),
    queryFn: () => api.getMonitorTarget(id!),
    enabled: id !== undefined,
  });
}

export function useMonitorIncidents(activeOnly = false) {
  return useQuery({
    queryKey: incidentsKey(activeOnly),
    queryFn: () => api.listMonitorIncidents({ activeOnly, limit: 25 }),
  });
}

/**
 * Every monitor mutation invalidates the WHOLE `["monitor"]` prefix rather
 * than just its own slice, matching `useAcknowledgeMonitorIncident`'s
 * pre-existing reasoning below: creating, editing, enabling, disabling or
 * archiving a target all change what the overview list, this target's own
 * detail screen and Settings' summary card must show, and a narrower
 * invalidation would leave one of those stale. Factored out once so all six
 * mutations below share the identical behavior rather than six copies of the
 * same `queryClient.invalidateQueries` call that could quietly drift.
 */
function useInvalidateMonitor() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: monitorKey });
}

export function useCreateMonitorTarget() {
  const invalidate = useInvalidateMonitor();
  return useMutation({
    mutationFn: (body: MonitorTargetCreate) => api.createMonitorTarget(body),
    onSuccess: invalidate,
  });
}

/**
 * Edits a target's configuration. NEVER `enabled` or archiving -- see
 * `useEnableMonitorTarget`/`useDisableMonitorTarget`/`useArchiveMonitorTarget`.
 * Throws `ApiClientError` with `.code === "target_has_active_incident"` if the
 * patch changes `url`/`kind` while an incident is open on this target, and
 * `.code === "name_already_exists"` on a duplicate name -- see
 * `describeMonitorTargetMutationFailure` in `components/monitor/target-form`.
 */
export function useUpdateMonitorTarget() {
  const invalidate = useInvalidateMonitor();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: MonitorTargetUpdate }) =>
      api.updateMonitorTarget(id, patch),
    onSuccess: invalidate,
  });
}

/** Resumes future probes on the worker's next pass. */
export function useEnableMonitorTarget() {
  const invalidate = useInvalidateMonitor();
  return useMutation({
    mutationFn: (id: string) => api.enableMonitorTarget(id),
    onSuccess: invalidate,
  });
}

/**
 * Stops future probes immediately. Disabling a target that currently has an
 * open incident does NOT resolve it -- the incident stays open until the
 * target is re-enabled and recovers, or someone acknowledges it from the
 * list, because no further check ever runs to confirm recovery. This hook has
 * no opinion about that and always disables; a caller with the fact available
 * (the detail screen reads `active_incident` off the overview cache) should
 * confirm with the user before calling it.
 */
export function useDisableMonitorTarget() {
  const invalidate = useInvalidateMonitor();
  return useMutation({
    mutationFn: (id: string) => api.disableMonitorTarget(id),
    onSuccess: invalidate,
  });
}

/**
 * Archives a target -- the CRUD "delete". Never destroys check/incident
 * history (both remain in the database); only removes the target from the
 * default `getMonitorOverview` list. There is no unarchive call.
 */
export function useArchiveMonitorTarget() {
  const invalidate = useInvalidateMonitor();
  return useMutation({
    mutationFn: (id: string) => api.archiveMonitorTarget(id),
    onSuccess: invalidate,
  });
}

/**
 * Marks an incident as seen.
 *
 * ACKNOWLEDGEMENT IS NOT RESOLUTION -- the incident stays active and the target
 * is still down. The call is idempotent: acknowledging an already-acknowledged
 * incident succeeds and returns the unchanged row rather than failing, because
 * the most likely way a user reaches that state is double-tapping a button that
 * already worked.
 */
export function useAcknowledgeMonitorIncident() {
  const invalidate = useInvalidateMonitor();
  return useMutation({
    mutationFn: (id: string) => api.acknowledgeMonitorIncident(id),
    onSuccess: invalidate,
  });
}
