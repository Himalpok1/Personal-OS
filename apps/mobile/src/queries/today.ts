import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

// Intl can be absent on stripped Hermes builds and resolvedOptions().timeZone
// can be undefined on odd web runtimes -- either way the server needs some
// valid IANA zone, so "UTC" is the guarded fallback.
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function useToday() {
  return useQuery({
    queryKey: ["today"],
    queryFn: () => api.getToday(deviceTimezone()),
  });
}
