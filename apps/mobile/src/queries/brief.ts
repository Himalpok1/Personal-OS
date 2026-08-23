import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { deviceTimezone } from "./today";

// GET /briefs/current?tz= -- read-only lookup of today's persisted brief.
// api.getCurrentBrief already normalizes the server's 404 (no brief
// generated yet for this (brief_date, timezone)) to null -- see
// packages/api-client/src/brief.ts -- so this hook never surfaces "no
// brief yet" as an error state.
export function useCurrentBrief() {
  return useQuery({
    queryKey: ["brief", "current"],
    queryFn: () => api.getCurrentBrief(deviceTimezone()),
  });
}

// POST /briefs (ADR-041: manual/on-demand only, never scheduled). The brief
// carries its own metadata into /today's response, so a successful
// generation invalidates "today" alongside "brief" -- same cross-domain
// invalidation shape useStartReview uses for reviews vs. today.
export function useGenerateBrief() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.generateBrief(deviceTimezone()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["brief"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
    },
  });
}
