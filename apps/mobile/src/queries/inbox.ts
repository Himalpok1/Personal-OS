import type { InboxListParams } from "@personal-os/api-client";
import type { InboxConfirmRequest } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export function useInbox(params: InboxListParams = {}) {
  return useQuery({
    queryKey: ["inbox", params],
    queryFn: () => api.listInbox(params),
  });
}

export function useInboxItem(id: string | undefined) {
  return useQuery({
    queryKey: ["inbox", id ?? ""],
    queryFn: () => api.getInboxItem(id!),
    enabled: id !== undefined,
  });
}

export function useConfirmInboxItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: InboxConfirmRequest }) =>
      api.confirmInboxItem(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      // A confirmed item may commit a new task/note, which the relevant
      // list screens should pick up too.
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });
}
