import type { CaptureRequest } from "@personal-os/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export function useCapture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CaptureRequest) => api.capture(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}
