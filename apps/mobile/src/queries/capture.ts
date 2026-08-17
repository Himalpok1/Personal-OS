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
    },
  });
}
