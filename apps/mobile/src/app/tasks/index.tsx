import type { Task, TaskStatus } from "@personal-os/schema";
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
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, SafeAreaView, Text, View } from "react-native";

type Filter = "new" | "active" | "done" | "dropped";

const FILTER_STATUS: Record<Filter, TaskStatus[]> = {
  new: ["inbox"],
  active: ["active"],
  done: ["done"],
  dropped: ["dropped"],
};

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

  return (
    <Pressable
      onPress={() => router.push(`/tasks/${task.id}`)}
      className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800"
    >
      <View className="flex-1 pr-2">
        <Text className="text-base text-black dark:text-white" numberOfLines={2}>
          {task.title}
        </Text>
        {task.due_at ? (
          <Text className="text-xs text-neutral-500">
            Due {new Date(task.due_at).toLocaleString()}
          </Text>
        ) : null}
        {task.rrule ? (
          <Text className="text-xs text-neutral-500 dark:text-neutral-400">Recurring</Text>
        ) : null}
        {error ? (
          <Text className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</Text>
        ) : null}
      </View>
      {/* Each action Pressable stops propagation so it does not ALSO trigger
          the row's navigate-to-detail onPress. Same precedent as
          components/calendar/day-cell.tsx: on native the touch responder
          already grants to the inner view, but Pressable maps to bubbling DOM
          events under react-native-web, where this app also ships. */}
      <View className="flex-row gap-2">
        {task.status === "inbox" ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              activate.mutate(task.id);
            }}
            hitSlop={8}
            disabled={activate.isPending}
            className="min-h-[44px] items-center justify-center rounded bg-blue-100 px-2 disabled:opacity-50 dark:bg-blue-950"
          >
            <Text className="text-xs text-blue-700 dark:text-blue-300">Start</Text>
          </Pressable>
        ) : null}
        {task.status === "active" ? (
          <>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onComplete();
              }}
              hitSlop={8}
              disabled={complete.isPending || completeOccurrence.isPending}
              className="min-h-[44px] items-center justify-center rounded bg-green-100 px-2 disabled:opacity-50 dark:bg-green-950"
            >
              <Text className="text-xs text-green-700 dark:text-green-300">Done</Text>
            </Pressable>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onDrop();
              }}
              hitSlop={8}
              disabled={drop.isPending}
              className="min-h-[44px] items-center justify-center rounded bg-neutral-100 px-2 disabled:opacity-50 dark:bg-neutral-800"
            >
              <Text className="text-xs text-neutral-600 dark:text-neutral-300">Drop</Text>
            </Pressable>
          </>
        ) : null}
        {task.status === "done" || task.status === "dropped" ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              setError(null);
              reopen.mutate(task.id, { onError: showFailure });
            }}
            hitSlop={8}
            disabled={reopen.isPending}
            accessibilityRole="button"
            accessibilityLabel="Reopen task"
            className="min-h-[44px] items-center justify-center rounded bg-blue-100 px-2 disabled:opacity-50 dark:bg-blue-950"
          >
            <Text className="text-xs text-blue-700 dark:text-blue-300">Reopen</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          hitSlop={8}
          disabled={archive.isPending}
          className="min-h-[44px] items-center justify-center rounded bg-neutral-100 px-2 disabled:opacity-50 dark:bg-neutral-800"
        >
          <Text className="text-xs text-neutral-600 dark:text-neutral-300">Archive</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function TasksScreen() {
  const [filter, setFilter] = useState<Filter>("active");
  const { data, isLoading, isError, refetch } = useTasks({ status: FILTER_STATUS[filter] });

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View className="flex-row justify-around border-b border-neutral-200 dark:border-neutral-800">
        {(["new", "active", "done", "dropped"] as Filter[]).map((f) => {
          const isActive = filter === f;
          const label = f[0]!.toUpperCase() + f.slice(1);
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={label}
              className="min-h-[44px] min-w-[44px] items-center justify-center"
            >
              <Text
                className={
                  isActive ? "font-semibold text-blue-600" : "text-neutral-500 dark:text-neutral-400"
                }
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <Text className="p-4 text-neutral-500">Loading...</Text>
      ) : isError ? (
        <View className="flex-1 items-center justify-center gap-3 p-4">
          <Text className="text-red-600">Couldn&apos;t load tasks.</Text>
          <Pressable
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading tasks"
            hitSlop={8}
            className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="font-semibold text-white">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TaskRow task={item} />}
          contentContainerClassName={FLOATING_CLEARANCE}
          ListEmptyComponent={
            <Text className="p-4 text-neutral-500">No {filter} tasks.</Text>
          }
        />
      )}

      <Link href="/tasks/new" asChild>
        <Pressable className={`mx-4 mt-4 items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700 ${FLOATING_CTA_CLEARANCE_NO_TABBAR}`}>
          <Text className="font-semibold text-white">New task</Text>
        </Pressable>
      </Link>
    </SafeAreaView>
  );
}
