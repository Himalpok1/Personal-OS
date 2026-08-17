import { ApiClientError } from "@personal-os/api-client";
import type { CaptureRequest } from "@personal-os/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { enqueueCapture } from "@/outbox/queue";
import { api } from "./client";

export type CaptureResult = { status: "sent"; inbox_id: string } | { status: "queued" };

export function useCapture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CaptureRequest): Promise<CaptureResult> => {
      try {
        const response = await api.capture(body);
        return { status: "sent", inbox_id: response.inbox_id };
      } catch (err) {
        // ApiClientError means the server responded (e.g. a validation
        // 400) -- retrying via the outbox wouldn't fix that, so it's a
        // real failure. Anything else means fetch itself never got a
        // response (offline), which is exactly what the capture-only
        // outbox exists for (see docs/ARCHITECTURE.md's "Offline: outbox
        // pattern only").
        if (err instanceof ApiClientError) throw err;
        await enqueueCapture(body);
        return { status: "queued" };
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}
