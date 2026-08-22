import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { deviceTimezone } from "./today";

export interface UseAgendaParams {
  from: string;
  to: string;
  projectId?: string;
}

export function useAgenda({ from, to, projectId }: UseAgendaParams) {
  return useQuery({
    queryKey: ["agenda", { from, to, projectId }],
    queryFn: () =>
      api.getAgenda({
        tz: deviceTimezone(),
        from,
        to,
        ...(projectId ? { project_id: projectId } : {}),
      }),
  });
}

// Completing/skipping/rescheduling a task or occurrence from the Agenda must
// refresh this read model too -- the task/occurrence hooks already
// invalidate their own domains ("tasks" / ["occurrences", "tasks"]); this is
// the additional invalidation Agenda's own mutation call sites need, same
// shape as useToday's useInvalidateAfterCompletion in (tabs)/index.tsx.
export function useInvalidateAgenda() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["agenda"] });
  };
}
