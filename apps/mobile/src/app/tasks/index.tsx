import type { Task, TaskStatus } from "@personal-os/schema";
import { describeTaskRepeat } from "@personal-os/core/recurrence/task-presets";
import { confirmDestructive } from "@/components/confirm-destructive";
import { classifyTaskActionError, completionTarget } from "@/components/task-actions-state";
import { useCompleteOccurrence } from "@/queries/occurrences";
import {
  useActivateTask,
  useArchiveTask,
  useCompleteTask,
  useDropTask,
  useReopenTask,
  useTasks,
} from "@/queries/tasks";
import { FLOATING_CLEARANCE, FLOATING_CTA_CLEARANCE_NO_TABBAR } from "@/components/floating-layout";
import { SegmentedControl, type SegmentedOption } from "@/components/calendar/segmented-control";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ScreenFrame,
  SkeletonList,
  useTheme,
} from "@/components/ui";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";

type Filter = "new" | "active" | "done" | "dropped";

const FILTER_STATUS: Record<Filter, TaskStatus[]> = {
  new: ["inbox"],
  active: ["active"],
  done: ["done"],
  dropped: ["dropped"],
};

const FILTERS: readonly SegmentedOption<Filter>[] = (
  ["new", "active", "done", "dropped"] as Filter[]
).map((f) => ({ value: f, label: f[0]!.toUpperCase() + f.slice(1) }));

function TaskRow({ task }: { task: Task }) {
  const router = useRouter();
  const activate = useActivateTask();
  const complete = useCompleteTask();
  const completeOccurrence = useCompleteOccurrence();
  const drop = useDropTask();
  const reopen = useReopenTask();
  const archive = useArchiveTask();
  const [error, setError] = useState<string | null>(null);

  const showFailure = (err: unknown) => {
    const failure = classifyTaskActionError(err);
    if (failure.kind === "message") setError(failure.message);
  };

  // A list row is a `Task`, which carries no occurrence_id, so `completionTarget`
  // always resolves to the task endpoint here; the shared helper keeps the
  // recurring 409 handling identical to Today's (Checkpoint 9.3): complete the
  // named occurrence, or say that none is generated yet. Done stays one tap.
  const onComplete = () => {
    setError(null);
    const target = completionTarget(task);
    if (target.kind === "occurrence") {
      completeOccurrence.mutate(target.occurrenceId, { onError: showFailure });
      return;
    }
    complete.mutate(target.taskId, {
      onError: (err) => {
        const failure = classifyTaskActionError(err);
        if (failure.kind === "use_occurrence") {
          completeOccurrence.mutate(failure.occurrenceId, { onError: showFailure });
          return;
        }
        setError(failure.message);
      },
    });
  };

  // Drop and Archive were the two list-row actions the ledger recorded as
  // unconfirmed ("List-row Archive and Drop still fire without confirmation")
  // -- one fat-finger tap on the Rabbit's 480px row hid an item. Same gate
  // and same copy as the detail screen.
  const onDrop = () =>
    confirmDestructive({
      title: "Drop this task?",
      message: "It moves to Dropped. You can reopen it later from there.",
      confirmLabel: "Drop",
      onConfirm: () => {
        setError(null);
        drop.mutate(task.id, { onError: showFailure });
      },
    });

  const onArchive = () =>
    confirmDestructive({
      title: "Archive this task?",
      message:
        "This hides it from your lists. There's currently no way to view or restore it from the app.",
      confirmLabel: "Archive",
      onConfirm: () => {
        setError(null);
        archive.mutate(task.id, {
          onError: () => setError("Couldn't archive this task. Please try again."),
        });
      },
    });

  // The body and the action buttons are SIBLINGS on an inert card, not
  // nested pressables: the pre-10.3 row stopped each action tap's
  // propagation by hand (under react-native-web a nested Pressable's tap
  // bubbles to the row's own onPress), and siblings need no such guard.
  // Behaviour is unchanged -- the body opens the task, the buttons act.
  return (
    <Card padding="none" className="mb-3">
      <Pressable
        onPress={() => router.push(`/tasks/${task.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Open task: ${task.title}`}
        hitSlop={4}
        className="p-4 active:opacity-70"
      >
        <AppText variant="body-strong" numberOfLines={2}>
          {task.title}
        </AppText>
        {/* A recurring task's `due_at` is the SERIES ANCHOR (contract §0) --
            always persisted since 9.4, never advanced -- so on a rule that
            has been running for a month it would read as a due date a month
            overdue, forever. The repeat line below is the honest summary;
            the actual next instance lives on the detail screen's "Next:"
            line (components/task-actions.tsx). */}
        {task.due_at && !task.rrule ? (
          <AppText variant="caption" tone="secondary" className="mt-0.5">
            Due {new Date(task.due_at).toLocaleString()}
          </AppText>
        ) : null}
        {task.rrule ? (
          <AppText variant="caption" tone="secondary" numberOfLines={1} className="mt-0.5">
            Repeats · {describeTaskRepeat(task)}
          </AppText>
        ) : null}
        {error ? (
          <AppText variant="caption" tone="danger" className="mt-1">
            {error}
          </AppText>
        ) : null}
      </Pressable>
      <View className="flex-row flex-wrap gap-2 px-4 pb-3">
        {task.status === "inbox" ? (
          <Button
            label="Start"
            onPress={() => activate.mutate(task.id)}
            variant="tonal"
            size="sm"
            icon="play-outline"
            disabled={activate.isPending}
            accessibilityLabel={`Start task: ${task.title}`}
          />
        ) : null}
        {task.status === "active" ? (
          <>
            <Button
              label="Done"
              onPress={onComplete}
              variant="tonal"
              size="sm"
              icon="check"
              disabled={complete.isPending || completeOccurrence.isPending}
              accessibilityLabel={`Complete task: ${task.title}`}
            />
            <Button
              label="Drop"
              onPress={onDrop}
              variant="danger"
              size="sm"
              disabled={drop.isPending}
              accessibilityLabel={`Drop task: ${task.title}`}
            />
          </>
        ) : null}
        {task.status === "done" || task.status === "dropped" ? (
          <Button
            label="Reopen"
            onPress={() => {
              setError(null);
              reopen.mutate(task.id, { onError: showFailure });
            }}
            variant="outline"
            size="sm"
            icon="restore"
            disabled={reopen.isPending}
            accessibilityLabel="Reopen task"
          />
        ) : null}
        <Button
          label="Archive"
          onPress={onArchive}
          variant="ghost"
          size="sm"
          icon="archive-arrow-down-outline"
          disabled={archive.isPending}
          accessibilityLabel={`Archive task: ${task.title}`}
        />
      </View>
    </Card>
  );
}

export default function TasksScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("active");
  const { data, isLoading, isError, isRefetching, refetch } = useTasks({
    status: FILTER_STATUS[filter],
  });
  const { colors } = useTheme();

  return (
    <ScreenFrame>
      <View className="px-4 pt-3">
        <SegmentedControl value={filter} options={FILTERS} onChange={setFilter} />
      </View>

      {isLoading ? (
        <SkeletonList className="px-4 pt-2" />
      ) : isError ? (
        <ErrorState
          size="screen"
          message="Couldn't load tasks."
          onRetry={() => void refetch()}
          retryAccessibilityLabel="Retry loading tasks"
        />
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TaskRow task={item} />}
          contentContainerClassName={`${FLOATING_CLEARANCE} flex-grow px-4 pt-4`}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListEmptyComponent={
            <EmptyState
              size="screen"
              icon="checkbox-marked-circle-outline"
              title={`No ${filter} tasks.`}
            />
          }
        />
      )}

      <View className={`mx-4 mt-4 ${FLOATING_CTA_CLEARANCE_NO_TABBAR}`}>
        <Button
          label="New task"
          onPress={() => router.push("/tasks/new")}
          variant="primary"
          // Navigation, not an action: no haptic (components/ui/haptics.ts).
          haptic={false}
          icon="plus"
          block
          accessibilityLabel="New task"
        />
      </View>
    </ScreenFrame>
  );
}
