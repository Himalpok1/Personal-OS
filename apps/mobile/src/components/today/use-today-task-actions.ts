import {
  buildSnoozePatch,
  computeSnoozeTargets,
  type SnoozeChoice,
} from "@personal-os/core/task-snooze";
import type { TodayTaskItem } from "@personal-os/schema";
import { useQueryClient } from "@tanstack/react-query";
import {
  classifySnoozeError,
  classifyTaskActionError,
  completionTarget,
} from "@/components/task-actions-state";
import { useCompleteOccurrence, useSnoozeOccurrence } from "@/queries/occurrences";
import { useCompleteTask, useUpdateTask } from "@/queries/tasks";
import { deviceTimezone } from "@/queries/today";
import { canSnoozeTodayTask } from "./today-task-actions-state";

// The two quick actions a Today task row offers (Checkpoint 10.6, ADR-076
// §2/§4), extracted from Today's own `TaskRow` so the Focus Now rows and
// the explanation sheet run the SAME mutations rather than a copy.
//
// Completion rule (Checkpoint 9.3): a row that carries `occurrence_id` IS
// the materialized occurrence of a recurring task, so it completes that
// occurrence directly -- one round trip, instead of the old
// POST /tasks/:id/complete -> 409 -> POST /occurrences/:id/complete detour.
// A row without one is a one-off task and goes through the task endpoint;
// the recurring 409s that path can still return are classified in
// components/task-actions-state.ts (use the named occurrence, or explain
// that none is generated yet).
//
// Snooze rule (Checkpoints 9.3/9.4, task-actions.tsx's `applySnooze`): an
// occurrence row snoozes that ONE instance (`occurrences.snoozed_until`,
// never the rule); a one-off task PATCHes its own `due_at` (and `remind_at`
// only when it already has one). A recurring PARENT row -- which Today never
// buckets since 9.4 -- has no target and is refused with `canSnooze` false
// rather than re-pointing its series anchor. The snooze instants are
// computed in the tap handler from the device zone (a handler, not a
// render, so the clock read is allowed).
//
// Completing from Today must refresh this read model plus everything the
// completion can move. The task/occurrence hooks already invalidate their
// own domains ("tasks" / ["occurrences", "tasks"]); this adds "today" so
// the command center refetches too.

export type TaskActionCallbacks = {
  onSuccess?: () => void;
  /** A user-readable failure line (already classified). */
  onError?: (message: string) => void;
};

export function useInvalidateAfterCompletion() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["today"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["occurrences"] });
  };
}

export function useTodayTaskActions() {
  const complete = useCompleteTask();
  const completeOccurrence = useCompleteOccurrence();
  const snoozeOccurrence = useSnoozeOccurrence();
  const updateTask = useUpdateTask();
  const invalidate = useInvalidateAfterCompletion();
  const pending =
    complete.isPending ||
    completeOccurrence.isPending ||
    snoozeOccurrence.isPending ||
    updateTask.isPending;

  const completeItem = (item: TodayTaskItem, callbacks: TaskActionCallbacks = {}) => {
    const onSuccess = () => {
      invalidate();
      callbacks.onSuccess?.();
    };
    const showFailure = (err: unknown) => {
      const failure = classifyTaskActionError(err);
      if (failure.kind === "message") callbacks.onError?.(failure.message);
    };
    const target = completionTarget(item);
    if (target.kind === "occurrence") {
      completeOccurrence.mutate(target.occurrenceId, { onSuccess, onError: showFailure });
      return;
    }
    complete.mutate(target.taskId, {
      onSuccess,
      onError: (err) => {
        const failure = classifyTaskActionError(err);
        if (failure.kind === "use_occurrence") {
          completeOccurrence.mutate(failure.occurrenceId, { onSuccess, onError: showFailure });
          return;
        }
        callbacks.onError?.(failure.message);
      },
    });
  };

  const snoozeItem = (
    item: TodayTaskItem,
    choice: SnoozeChoice,
    callbacks: TaskActionCallbacks = {},
  ) => {
    if (!canSnoozeTodayTask(item)) return;
    const until = computeSnoozeTargets(new Date(), deviceTimezone())[choice];
    const onSuccess = () => {
      invalidate();
      callbacks.onSuccess?.();
    };
    const onError = (err: unknown) => callbacks.onError?.(classifySnoozeError(err));
    if (item.occurrence_id != null) {
      snoozeOccurrence.mutate({ id: item.occurrence_id, body: { until } }, { onSuccess, onError });
      return;
    }
    updateTask.mutate({ id: item.id, body: buildSnoozePatch(item, until) }, { onSuccess, onError });
  };

  return { complete: completeItem, snooze: snoozeItem, pending };
}
