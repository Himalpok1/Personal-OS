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
        <Text className="text-base text-black dark:text-white">{task.title}</Text>
        {task.due_at ? (
          <Text className="text-xs text-neutral-500">
            Due {new Date(task.due_at).toLocaleString()}
          </Text>
        ) : null}
        {task.rrule ? <Text className="text-xs text-neutral-400">Recurring</Text> : null}
      </View>
      <View className="flex-row gap-2">
        {task.status === "inbox" ? (
          <Pressable onPress={() => activate.mutate(task.id)} className="rounded bg-blue-100 px-2 py-1 dark:bg-blue-950">
            <Text className="text-xs text-blue-700 dark:text-blue-300">Start</Text>
          </Pressable>
        ) : null}
        {task.status === "active" ? (
          <>
            <Pressable onPress={onComplete} className="rounded bg-green-100 px-2 py-1 dark:bg-green-950">
              <Text className="text-xs text-green-700 dark:text-green-300">Done</Text>
            </Pressable>
            <Pressable onPress={() => drop.mutate(task.id)} className="rounded bg-neutral-100 px-2 py-1 dark:bg-neutral-800">
              <Text className="text-xs text-neutral-600 dark:text-neutral-300">Drop</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable onPress={() => archive.mutate(task.id)} className="rounded bg-neutral-100 px-2 py-1 dark:bg-neutral-800">
          <Text className="text-xs text-neutral-600 dark:text-neutral-300">Archive</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function TasksScreen() {
  const [filter, setFilter] = useState<Filter>("active");
  const { data, isLoading, isError } = useTasks({ status: FILTER_STATUS[filter] });

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View className="flex-row justify-around border-b border-neutral-200 py-2 dark:border-neutral-800">
        {(["new", "active", "done", "dropped"] as Filter[]).map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)}>
            <Text
              className={
                filter === f
                  ? "font-semibold text-blue-600"
                  : "text-neutral-500 dark:text-neutral-400"
              }
            >
              {f[0]!.toUpperCase() + f.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <Text className="p-4 text-neutral-500">Loading...</Text>
      ) : isError ? (
        <Text className="p-4 text-red-600">Couldn&apos;t load tasks.</Text>
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TaskRow task={item} />}
          ListEmptyComponent={
            <Text className="p-4 text-neutral-500">No {filter} tasks.</Text>
          }
        />
      )}

      <Link href="/tasks/new" asChild>
        <Pressable className="m-4 items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700">
          <Text className="font-semibold text-white">New task</Text>
        </Pressable>
      </Link>
    </SafeAreaView>
  );
}
