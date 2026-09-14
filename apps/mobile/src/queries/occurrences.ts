import type { OccurrenceListQuery, OccurrenceSnooze } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { occurrenceReminderKey } from "@/notifications/reminder-actions";
import { cancelRemindersForKey } from "@/notifications/scheduler";
import { api } from "./client";

export function useOccurrences(params: OccurrenceListQuery | undefined) {
  return useQuery({
    queryKey: ["occurrences", params],
    queryFn: () => api.listOccurrences(params!),
    enabled: params !== undefined,
  });
}

/**
 * Checkpoint 9.4. Every occurrence mutation FIRST cancels the on-device
 * alarm scheduled for that occurrence's reminder (key `occ:<id>`, the same
 * label the reminders feed uses), awaited, and only then invalidates the
 * read models -- so the alarm for an instance the owner just completed,
 * skipped or snoozed cannot fire in the window before the next reconcile
 * pass rebuilds the schedule from the fresh feed. A snooze or reopen that
 * makes the instance due again is restored by that pass, under its new
 * instant.
 */
function useInvalidateOccurrences() {
  const queryClient = useQueryClient();
  return async (occurrenceId: string) => {
    await cancelRemindersForKey(occurrenceReminderKey(occurrenceId)).catch((error: unknown) => {
      console.warn("Failed to cancel the local reminder for a mutated occurrence", error);
    });
    void queryClient.invalidateQueries({ queryKey: ["occurrences"] });
    // Completing/skipping an occurrence can affect the parent task's
    // displayed state (e.g. lazy-generated successors).
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["today"] });
    void queryClient.invalidateQueries({ queryKey: ["reminders"] });
  };
}

export function useCompleteOccurrence() {
  const invalidate = useInvalidateOccurrences();
  return useMutation({
    mutationFn: (id: string) => api.completeOccurrence(id),
    onSuccess: (_result, id) => invalidate(id),
  });
}

export function useSkipOccurrence() {
  const invalidate = useInvalidateOccurrences();
  return useMutation({
    mutationFn: (id: string) => api.skipOccurrence(id),
    onSuccess: (_result, id) => invalidate(id),
  });
}

// Checkpoint 9.4. Snooze one instance of a recurring task: the rule and the
// parent are untouched, so the invalidation set is the same as complete/skip.
export function useSnoozeOccurrence() {
  const invalidate = useInvalidateOccurrences();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: OccurrenceSnooze }) =>
      api.snoozeOccurrence(id, body),
    onSuccess: (_result, { id }) => invalidate(id),
  });
}

// done|skipped -> scheduled ("undo complete"); a completion-anchored parent's
// open successor is withdrawn server-side in the same transaction.
export function useReopenOccurrence() {
  const invalidate = useInvalidateOccurrences();
  return useMutation({
    mutationFn: (id: string) => api.reopenOccurrence(id),
    onSuccess: (_result, id) => invalidate(id),
  });
}
