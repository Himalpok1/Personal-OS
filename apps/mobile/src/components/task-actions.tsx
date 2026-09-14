import type { Task } from "@personal-os/schema";
import { selectNextOccurrence } from "@personal-os/core/recurrence/next-occurrence";
import { describeTaskRepeat } from "@personal-os/core/recurrence/task-presets";
import {
  buildSnoozePatch,
  computeSnoozeTargets,
  type SnoozeChoice,
} from "@personal-os/core/task-snooze";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { confirmDestructive } from "@/components/confirm-destructive";
import { deviceTimezone, formatFieldLabel } from "@/components/datetime-field-state";
import { ReminderActionBanner } from "@/components/reminder-action-banner";
import {
  availableTaskActions,
  canOfferUndo,
  classifySnoozeError,
  classifyTaskActionError,
  describeTaskStatus,
  detailCompletionTarget,
  GENERIC_TASK_ACTION_MESSAGE,
  isTaskOpen,
  localSnoozeLineVisible,
  nextOccurrenceLine,
  noUpcomingOccurrenceLine,
  selectUndoableOccurrence,
  snoozeTarget,
  undoLabel,
  type TaskAction,
} from "@/components/task-actions-state";
import {
  useCompleteOccurrence,
  useOccurrences,
  useReopenOccurrence,
  useSkipOccurrence,
  useSnoozeOccurrence,
} from "@/queries/occurrences";
import {
  useActivateTask,
  useCompleteTask,
  useDropTask,
  useReopenTask,
  useUpdateTask,
} from "@/queries/tasks";

// Task follow-through controls for the detail screen (Checkpoint 9.3, extended
// by 9.4 for recurring tasks): status line, repeat summary and "Next:" line,
// lifecycle actions (Start / Complete / Skip / Drop / Reopen), snooze chips,
// an Undo chip for the last completed or skipped occurrence, the banner for a
// Done/Snooze tapped on a reminder notification, and ONE banner for whatever
// last failed. Every action goes through its dedicated route hook -- never a
// PATCH of `status` (ADR-039's rule). Every decision about what to offer or
// what a failure means lives in components/task-actions-state.ts, where it
// is unit-tested.
//
// A recurring task's actionable instance is its next scheduled OCCURRENCE
// (contract §0): Complete, Skip and Snooze act on that row directly when it
// is known, so the parent's `due_at` -- the series anchor -- is never moved
// by a snooze and the 9.3 POST-then-409-then-occurrence detour is skipped.

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

const ACTION_CLASS: Record<TaskAction | "skip" | "undo", { button: string; text: string }> = {
  start: {
    button: "bg-blue-100 active:bg-blue-200 dark:bg-blue-950",
    text: "text-blue-700 dark:text-blue-300",
  },
  complete: {
    button: "bg-green-100 active:bg-green-200 dark:bg-green-950",
    text: "text-green-700 dark:text-green-300",
  },
  skip: {
    button: "bg-neutral-100 active:bg-neutral-200 dark:bg-neutral-800",
    text: "text-neutral-600 dark:text-neutral-300",
  },
  drop: {
    button: "bg-neutral-100 active:bg-neutral-200 dark:bg-neutral-800",
    text: "text-neutral-600 dark:text-neutral-300",
  },
  reopen: {
    button: "bg-blue-100 active:bg-blue-200 dark:bg-blue-950",
    text: "text-blue-700 dark:text-blue-300",
  },
  undo: {
    button: "bg-blue-100 active:bg-blue-200 dark:bg-blue-950",
    text: "text-blue-700 dark:text-blue-300",
  },
};

const BUTTON_CLASS =
  "min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-4 disabled:opacity-50";
const CHIP_CLASS =
  "min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-neutral-100 px-3 disabled:opacity-50 dark:bg-neutral-800";

export function TaskActions({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const activate = useActivateTask();
  const complete = useCompleteTask();
  const completeOccurrence = useCompleteOccurrence();
  const skipOccurrence = useSkipOccurrence();
  const snoozeOccurrence = useSnoozeOccurrence();
  const reopenOccurrence = useReopenOccurrence();
  const drop = useDropTask();
  const reopen = useReopenTask();
  const snooze = useUpdateTask();

  // The occurrence queries run only for a recurring task; `undefined` keeps
  // the hook disabled for a one-off (queries/occurrences.ts). Scheduled rows
  // are what "Next:" and the direct actions need, ascending so the earliest
  // is on page 1 (a 90-day window of a daily rule fits the 200 limit). Done
  // and skipped rows feed the Undo chip and are asked for DESCENDING: on a
  // long-lived series the terminal rows outnumber the limit, and ascending
  // would page the LATEST one -- the only one Undo wants -- off the end.
  const recurring = task.rrule !== null;
  const occurrenceQuery = (status: "scheduled" | "done" | "skipped", order: "asc" | "desc") =>
    recurring
      ? ({ parent_type: "task", parent_id: task.id, status, order, limit: 200, offset: 0 } as const)
      : undefined;
  const scheduled = useOccurrences(occurrenceQuery("scheduled", "asc"));
  const done = useOccurrences(occurrenceQuery("done", "desc"));
  const skipped = useOccurrences(occurrenceQuery("skipped", "desc"));

  const [error, setError] = useState<string | null>(null);
  const [snoozedUntil, setSnoozedUntil] = useState<string | null>(null);

  const pending =
    activate.isPending ||
    complete.isPending ||
    completeOccurrence.isPending ||
    skipOccurrence.isPending ||
    snoozeOccurrence.isPending ||
    reopenOccurrence.isPending ||
    drop.isPending ||
    reopen.isPending ||
    snooze.isPending;

  // One clock per render, so the "Next:" line and the Undo window cannot
  // disagree with each other (the frozen read-model rule, applied locally).
  const now = new Date();
  const next = recurring ? selectNextOccurrence(scheduled.data?.items ?? [], now) : null;
  const nextLine = nextOccurrenceLine(next);
  const noUpcomingLine = noUpcomingOccurrenceLine({
    rrule: task.rrule,
    scheduledLoaded: scheduled.isSuccess,
    scheduledCount: scheduled.data?.items.length ?? 0,
  });
  // Undo only on an open parent (task-actions-state.ts's canOfferUndo): on a
  // done or dropped one the route can only answer 409.
  const undoable = canOfferUndo(task)
    ? selectUndoableOccurrence([...(done.data?.items ?? []), ...(skipped.data?.items ?? [])], now)
    : null;

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

  const runComplete = () => {
    const target = detailCompletionTarget(task, next);
    if (target.kind === "occurrence") {
      completeOccurrence.mutate(target.occurrenceId, { onSuccess: afterChange, onError: fail });
      return;
    }
    complete.mutate(target.taskId, { onSuccess: afterChange, onError: fail });
  };

  const run = (action: TaskAction) => {
    setError(null);
    setSnoozedUntil(null);
    switch (action) {
      case "start":
        activate.mutate(task.id, { onSuccess: afterChange, onError: fail });
        return;
      case "complete":
        runComplete();
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

  // Skip is the recurring task's "not this time": the occurrence closes as
  // skipped and the successor follows the same rule as a completion.
  const runSkip = () => {
    if (next === null) return;
    setError(null);
    setSnoozedUntil(null);
    skipOccurrence.mutate(next.id, { onSuccess: afterChange, onError: showFailure });
  };

  const runUndo = () => {
    if (undoable === null) return;
    setError(null);
    setSnoozedUntil(null);
    reopenOccurrence.mutate(undoable.id, { onSuccess: afterChange, onError: showFailure });
  };

  const applySnooze = (choice: SnoozeChoice) => {
    setError(null);
    const target = snoozeTarget(task, next);
    if (target === null) return;
    const until = computeSnoozeTargets(new Date(), deviceTimezone())[choice];
    const onSuccess = () => {
      afterChange();
      setSnoozedUntil(until);
    };
    const onError = (err: unknown) => setError(classifySnoozeError(err));
    if (target.kind === "occurrence") {
      snoozeOccurrence.mutate({ id: target.occurrenceId, body: { until } }, { onSuccess, onError });
      return;
    }
    snooze.mutate(
      { id: target.taskId, body: buildSnoozePatch(task, until) },
      { onSuccess, onError },
    );
  };

  const actions = availableTaskActions(task.status);
  // For a recurring task the chips wait on the scheduled-occurrence query:
  // shown disabled while it loads (so the row does not pop in), hidden only
  // when there is genuinely no occurrence to snooze.
  const snoozeAvailable = snoozeTarget(task, next) !== null;
  const showSnooze =
    snoozeAvailable || (recurring && scheduled.isLoading && isTaskOpen(task.status));
  const canSkip = recurring && next !== null && actions.includes("complete");
  // The local "Snoozed until" line yields to the Next line once the refetch
  // shows the snooze there (task-actions-state.ts's localSnoozeLineVisible).
  const snoozeLabel = localSnoozeLineVisible({ snoozedUntil, recurring, next })
    ? formatFieldLabel(snoozedUntil!)
    : null;

  return (
    <View className="mb-4">
      <ReminderActionBanner taskId={task.id} />

      <Text
        className="mb-2 text-sm text-neutral-500 dark:text-neutral-400"
        accessibilityLabel={`Status: ${describeTaskStatus(task)}`}
      >
        {describeTaskStatus(task)}
      </Text>

      {recurring ? (
        <Text
          testID="task-repeat-line"
          className="mb-2 text-sm text-neutral-500 dark:text-neutral-400"
          numberOfLines={1}
        >
          ⟲ {describeTaskRepeat(task)}
        </Text>
      ) : null}

      {nextLine ? (
        <Text
          testID="task-next-line"
          className={
            nextLine.overdue
              ? "mb-2 text-sm text-red-600 dark:text-red-400"
              : "mb-2 text-sm text-neutral-700 dark:text-neutral-300"
          }
        >
          {nextLine.text}
        </Text>
      ) : noUpcomingLine ? (
        <Text testID="task-no-upcoming-line" className="mb-2 text-sm text-amber-700 dark:text-amber-300">
          {noUpcomingLine}
        </Text>
      ) : null}

      <View className="flex-row flex-wrap gap-2">
        {actions.map((action) => (
          <Pressable
            key={action}
            onPress={() => run(action)}
            disabled={pending}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${ACTION_LABEL[action]} task`}
            className={`${BUTTON_CLASS} ${ACTION_CLASS[action].button}`}
          >
            <Text className={`font-semibold ${ACTION_CLASS[action].text}`}>
              {ACTION_LABEL[action]}
            </Text>
          </Pressable>
        ))}
        {canSkip ? (
          <Pressable
            testID="task-skip"
            onPress={runSkip}
            disabled={pending}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Skip this occurrence"
            className={`${BUTTON_CLASS} ${ACTION_CLASS.skip.button}`}
          >
            <Text className={`font-semibold ${ACTION_CLASS.skip.text}`}>Skip</Text>
          </Pressable>
        ) : null}
      </View>

      {showSnooze ? (
        <View className="mt-3">
          <Text className="mb-1 text-sm text-neutral-500 dark:text-neutral-400">Snooze</Text>
          <View className="flex-row flex-wrap gap-2">
            {SNOOZE_CHIPS.map(({ choice, label }) => (
              <Pressable
                key={choice}
                onPress={() => applySnooze(choice)}
                disabled={pending || !snoozeAvailable}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Snooze until ${label}`}
                className={CHIP_CLASS}
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

      {undoable ? (
        <View className="mt-3 flex-row flex-wrap gap-2">
          <Pressable
            testID="task-undo"
            onPress={runUndo}
            disabled={pending}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${undoLabel(undoable.action)} on the last occurrence`}
            className={`${CHIP_CLASS} ${ACTION_CLASS.undo.button}`}
          >
            <Text className={`font-semibold ${ACTION_CLASS.undo.text}`}>
              {undoLabel(undoable.action)}
            </Text>
          </Pressable>
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
