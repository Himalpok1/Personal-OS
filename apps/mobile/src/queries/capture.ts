import type { CaptureRequest } from "@personal-os/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { enqueueAndAttemptCapture } from "@/outbox/queue";

export type CaptureResult = { status: "sent"; inbox_id: string } | { status: "queued" };

export function useCapture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CaptureRequest): Promise<CaptureResult> => {
      return enqueueAndAttemptCapture(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      // The capture may have been queued rather than sent, which changes the
      // outbox count the FAB badge renders. That badge is deliberately not
      // polled (see components/quick-add-fab.tsx), so this invalidation is how
      // it learns about a new pending item.
      void queryClient.invalidateQueries({ queryKey: ["outbox"] });
    },
  });
}
