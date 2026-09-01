import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// Service monitoring queries (Checkpoint 7.6). Perimeter-only, like mail.

const monitorKey = ["monitor"] as const;
const targetsKey = ["monitor", "targets"] as const;
const incidentsKey = (activeOnly: boolean) => ["monitor", "incidents", { activeOnly }] as const;

export function useMonitorOverview() {
  return useQuery({ queryKey: targetsKey, queryFn: () => api.getMonitorOverview() });
}

export function useMonitorIncidents(activeOnly = false) {
  return useQuery({
    queryKey: incidentsKey(activeOnly),
    queryFn: () => api.listMonitorIncidents({ activeOnly, limit: 25 }),
  });
}

/**
 * Marks an incident as seen.
 *
 * Invalidates the whole `monitor` prefix rather than just the incident list: an
 * acknowledgement changes what the TARGET row says too, and leaving the overview
 * stale would show "Not responding" beside an incident the user just
 * acknowledged.
 */
export function useAcknowledgeMonitorIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.acknowledgeMonitorIncident(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: monitorKey });
    },
  });
}
