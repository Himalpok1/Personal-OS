import { useProjects } from "@/queries/projects";
import { useArchiveTask, useTask, useUpdateTask } from "@/queries/tasks";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

export default function EditTaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: task, isLoading } = useTask(id);
  const { data: projects } = useProjects();
  const updateTask = useUpdateTask();
  const archiveTask = useArchiveTask();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setBody(task.body ?? "");
    setDueAt(task.due_at ?? "");
    setProjectId(task.project_id ?? undefined);
  }, [task]);

  if (isLoading || !task) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  const submit = () => {
    updateTask.mutate({
      id: task.id,
      body: {
        title: title.trim() || undefined,
        body: body.trim(),
        due_at: dueAt.trim() || null,
        project_id: projectId ?? null,
      },
    });
  };

  return (
    <ScrollView className="flex-1 bg-white p-4 dark:bg-black">
      {task.rrule ? (
        <View className="mb-4 rounded-lg bg-neutral-100 p-3 dark:bg-neutral-900">
          <Text className="text-xs text-neutral-500">
            Recurring ({task.recurrence_anchor}): {task.rrule}
          </Text>
          <Text className="text-xs text-neutral-400">
            Recurrence can&apos;t be edited here yet -- capture a new instruction to change it.
          </Text>
        </View>
      ) : null}

      <Text className="mb-1 text-sm text-neutral-500">Title</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Notes</Text>
      <TextInput
        value={body}
        onChangeText={setBody}
        multiline
        className="mb-4 min-h-[80px] rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Due date (ISO 8601)</Text>
      <TextInput
        value={dueAt}
        onChangeText={setDueAt}
        placeholder="2026-08-20T15:00:00"
        placeholderTextColor="#888"
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Project</Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {(projects ?? []).map((project) => (
          <Pressable
            key={project.id}
            onPress={() => setProjectId(projectId === project.id ? undefined : project.id)}
            className={
              projectId === project.id
                ? "rounded-full bg-blue-600 px-3 py-1"
                : "rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800"
            }
          >
            <Text className={projectId === project.id ? "text-white" : "text-black dark:text-white"}>
              {project.name}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={submit}
        disabled={updateTask.isPending}
        className="mb-3 items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
      >
        <Text className="font-semibold text-white">
          {updateTask.isPending ? "Saving..." : "Save changes"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => archiveTask.mutate(task.id, { onSuccess: () => router.back() })}
        className="items-center rounded-lg bg-neutral-100 py-3 dark:bg-neutral-800"
      >
        <Text className="font-semibold text-neutral-600 dark:text-neutral-300">
          Archive task
        </Text>
      </Pressable>
    </ScrollView>
  );
}
