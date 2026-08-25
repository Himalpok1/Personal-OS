import { ApiClientError } from "@personal-os/api-client";
import type { Task, TaskStatus } from "@personal-os/schema";
import { useCompleteOccurrence } from "@/queries/occurrences";
import {
  useActivateTask,
  useArchiveTask,
  useCompleteTask,
  useDropTask,
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
  const archive = useArchiveTask();

  const onComplete = () => {
    complete.mutate(task.id, {
      onError: (err) => {
        if (err instanceof ApiClientError && err.status === 409) {
          const occurrenceId = (err.body as { occurrence_id?: string | null })?.occurrence_id;
          if (occurrenceId) completeOccurrence.mutate(occurrenceId);
        }
      },
    });
  };

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
                drop.mutate(task.id);
              }}
              hitSlop={8}
              disabled={drop.isPending}
              className="min-h-[44px] items-center justify-center rounded bg-neutral-100 px-2 disabled:opacity-50 dark:bg-neutral-800"
            >
              <Text className="text-xs text-neutral-600 dark:text-neutral-300">Drop</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            archive.mutate(task.id);
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
            hitSlop={8}
            accessibilityRole="button"
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
