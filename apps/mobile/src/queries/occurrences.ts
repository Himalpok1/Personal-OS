import type { OccurrenceListQuery } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export function useOccurrences(params: OccurrenceListQuery | undefined) {
  return useQuery({
    queryKey: ["occurrences", params],
    queryFn: () => api.listOccurrences(params!),
    enabled: params !== undefined,
  });
}

function useInvalidateOccurrences() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["occurrences"] });
    // Completing/skipping an occurrence can affect the parent task's
    // displayed state (e.g. lazy-generated successors).
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };
}

export function useCompleteOccurrence() {
  const invalidate = useInvalidateOccurrences();
  return useMutation({
    mutationFn: (id: string) => api.completeOccurrence(id),
    onSuccess: invalidate,
  });
}

export function useSkipOccurrence() {
  const invalidate = useInvalidateOccurrences();
  return useMutation({
    mutationFn: (id: string) => api.skipOccurrence(id),
    onSuccess: invalidate,
  });
}
