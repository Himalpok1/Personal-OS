import { useQuery } from "@tanstack/react-query";
import { Platform } from "react-native";
import { api } from "./client";

/**
 * The stable key every mutation that can make a reminder stale invalidates
 * (queries/tasks.ts, queries/occurrences.ts, and the notification lifecycle
 * after an action). Keep it exactly `["reminders"]`: other lanes match on it.
 */
export const REMINDERS_QUERY_KEY = ["reminders"] as const;

/**
 * `GET /reminders` (Checkpoint 9.4): the server-derived list the primary
 * device schedules local notifications from -- one item per one-off task
 * with a reminder and one per open occurrence of a recurring task, with the
 * occurrence's reminder instant derived server-side in the series' own zone
 * and `snoozed_until` already applied. Replaces the pre-9.4 paging of
 * `listTasks`, which could only ever see the parent's single `remind_at`.
 *
 * Native only: on web nothing schedules local alarms (scheduler.ts no-ops),
 * so the fetch would be wasted. `enabled` is gated exactly like the device
 * query in use-reminder-reconciliation.ts; the caller adds its own pairing
 * condition on top.
 */
export function useReminders(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: REMINDERS_QUERY_KEY,
    queryFn: () => api.listReminders(),
    enabled: (options.enabled ?? true) && Platform.OS !== "web",
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
