import type { Task } from "@personal-os/schema";
import { buildSnoozePatch, computeSnoozeTargets, type SnoozeChoice } from "@personal-os/core/task-snooze";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { confirmDestructive } from "@/components/confirm-destructive";
import { deviceTimezone, formatFieldLabel } from "@/components/datetime-field-state";
import {
  availableTaskActions,
  canSnoozeTask,
  classifyTaskActionError,
  describeTaskStatus,
  GENERIC_TASK_ACTION_MESSAGE,
  type TaskAction,
} from "@/components/task-actions-state";
import { useCompleteOccurrence } from "@/queries/occurrences";
import {
  useActivateTask,
  useCompleteTask,
  useDropTask,
  useReopenTask,
  useUpdateTask,
} from "@/queries/tasks";

// Task follow-through controls for the detail screen (Checkpoint 9.3):
// status line, lifecycle actions (Start / Complete / Drop / Reopen), snooze
// chips, and ONE banner for whatever last failed. Every action goes through
// its dedicated route hook -- never a PATCH of `status` (ADR-039's rule).
// Every decision about what to offer or what a failure means lives in
// components/task-actions-state.ts, where it is unit-tested.

const SNOOZE_CHIPS: { choice: SnoozeChoice; label: string }[] = [
  { choice: "tomorrowMorning", label: "Tomorrow 9am" },
  { choice: "inOneHour", label: "+1 hour" },
  { choice: "nextWeekMorning", label: "Next week" },
];

const ACTION_LABEL: Record<TaskAction, string> = {
  start: "Start",
  complete: "Complete",
  drop: "Drop",
  reopen: "Reopen",
};

const ACTION_CLASS: Record<TaskAction, { button: string; text: string }> = {
  start: {
    button: "bg-blue-100 active:bg-blue-200 dark:bg-blue-950",
    text: "text-blue-700 dark:text-blue-300",
  },
  complete: {
    button: "bg-green-100 active:bg-green-200 dark:bg-green-950",
    text: "text-green-700 dark:text-green-300",
  },
  drop: {
    button: "bg-neutral-100 active:bg-neutral-200 dark:bg-neutral-800",
    text: "text-neutral-600 dark:text-neutral-300",
  },
  reopen: {
    button: "bg-blue-100 active:bg-blue-200 dark:bg-blue-950",
    text: "text-blue-700 dark:text-blue-300",
  },
};

export function TaskActions({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const activate = useActivateTask();
  const complete = useCompleteTask();
  const completeOccurrence = useCompleteOccurrence();
  const drop = useDropTask();
  const reopen = useReopenTask();
  const snooze = useUpdateTask();

  const [error, setError] = useState<string | null>(null);
  const [snoozedUntil, setSnoozedUntil] = useState<string | null>(null);

  const pending =
    activate.isPending ||
    complete.isPending ||
    completeOccurrence.isPending ||
    drop.isPending ||
    reopen.isPending ||
    snooze.isPending;

  // The lifecycle hooks invalidate "tasks"; a status change also moves this
  // task between Today's sections and can retire/spawn an occurrence, so the
  // command-center read model is refreshed here too (same set the Today screen
  // itself invalidates after a completion).
  const afterChange = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ["today"] });
    void queryClient.invalidateQueries({ queryKey: ["occurrences"] });
  };

  const showFailure = (err: unknown) => {
    const failure = classifyTaskActionError(err);
    setError(failure.kind === "message" ? failure.message : GENERIC_TASK_ACTION_MESSAGE);
  };

  const fail = (err: unknown) => {
    const failure = classifyTaskActionError(err);
    if (failure.kind === "use_occurrence") {
      // The server named the open occurrence of this recurring task --
      // completing it is what "Complete" meant. Transparent to the user.
      completeOccurrence.mutate(failure.occurrenceId, {
        onSuccess: afterChange,
        onError: showFailure,
      });
      return;
    }
    setError(failure.message);
  };

  const run = (action: TaskAction) => {
    setError(null);
    setSnoozedUntil(null);
    switch (action) {
      case "start":
        activate.mutate(task.id, { onSuccess: afterChange, onError: fail });
        return;
      case "complete":
        complete.mutate(task.id, { onSuccess: afterChange, onError: fail });
        return;
      case "drop":
        // Same gate the Archive control on this screen already has: Drop
        // closes the task and, for a recurring one, stops the series.
        confirmDestructive({
          title: "Drop this task?",
          message: "It moves to Dropped. You can reopen it later from there.",
          confirmLabel: "Drop",
          onConfirm: () => drop.mutate(task.id, { onSuccess: afterChange, onError: fail }),
        });
        return;
      case "reopen":
        reopen.mutate(task.id, { onSuccess: afterChange, onError: fail });
        return;
    }
  };

  const applySnooze = (choice: SnoozeChoice) => {
    setError(null);
    const target = computeSnoozeTargets(new Date(), deviceTimezone())[choice];
    snooze.mutate(
      { id: task.id, body: buildSnoozePatch(task, target) },
      {
        onSuccess: () => {
          afterChange();
          setSnoozedUntil(target);
        },
        onError: () => setError("Couldn't snooze this task. Please try again."),
      },
    );
  };

  const actions = availableTaskActions(task.status);
  const snoozeLabel = snoozedUntil ? formatFieldLabel(snoozedUntil) : null;

  return (
    <View className="mb-4">
      <Text
        className="mb-2 text-sm text-neutral-500 dark:text-neutral-400"
        accessibilityLabel={`Status: ${describeTaskStatus(task)}`}
      >
        {describeTaskStatus(task)}
      </Text>

      <View className="flex-row flex-wrap gap-2">
        {actions.map((action) => (
          <Pressable
            key={action}
            onPress={() => run(action)}
            disabled={pending}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${ACTION_LABEL[action]} task`}
            className={`min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-4 disabled:opacity-50 ${ACTION_CLASS[action].button}`}
          >
            <Text className={`font-semibold ${ACTION_CLASS[action].text}`}>
              {ACTION_LABEL[action]}
            </Text>
          </Pressable>
        ))}
      </View>

      {canSnoozeTask(task) ? (
        <View className="mt-3">
          <Text className="mb-1 text-sm text-neutral-500 dark:text-neutral-400">Snooze</Text>
          <View className="flex-row flex-wrap gap-2">
            {SNOOZE_CHIPS.map(({ choice, label }) => (
              <Pressable
                key={choice}
                onPress={() => applySnooze(choice)}
                disabled={pending}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Snooze until ${label}`}
                className="min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-neutral-100 px-3 disabled:opacity-50 dark:bg-neutral-800"
              >
                <Text className="text-black dark:text-white">{label}</Text>
              </Pressable>
            ))}
          </View>
          {snoozeLabel ? (
            <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Snoozed until {snoozeLabel}
            </Text>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <Text className="mt-2 text-red-600" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
