import { RecurrenceEditor } from "@/components/recurrence/recurrence-editor";
import { useProjects } from "@/queries/projects";
import { useArchiveTask, useTask, useUpdateTask } from "@/queries/tasks";
import {
  parseRRuleStringToEditorState,
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
} from "@personal-os/core/recurrence/editor";
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
  const [recurrence, setRecurrence] = useState<RecurrenceEditorState>(() =>
    parseRRuleStringToEditorState(task?.rrule, {
      recurrenceTimezone: task?.recurrence_timezone,
      recurrenceUntil: task?.recurrence_until,
      recurrenceCount: task?.recurrence_count,
      recurrenceAnchor: task?.recurrence_anchor,
      defaultTimezone: task?.timezone,
    }),
  );

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setBody(task.body ?? "");
    setDueAt(task.due_at ?? "");
    setProjectId(task.project_id ?? undefined);
    setRecurrence(
      parseRRuleStringToEditorState(task.rrule, {
        recurrenceTimezone: task.recurrence_timezone,
        recurrenceUntil: task.recurrence_until,
        recurrenceCount: task.recurrence_count,
        recurrenceAnchor: task.recurrence_anchor,
        defaultTimezone: task.timezone,
      }),
    );
  }, [task]);

  if (isLoading || !task) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  const submit = () => {
    const serialized = serializeEditorStateToRRule(recurrence);
    updateTask.mutate({
      id: task.id,
      body: {
        title: title.trim() || undefined,
        body: body.trim(),
        due_at: dueAt.trim() || null,
        project_id: projectId ?? null,
        rrule: serialized.rrule,
        recurrence_timezone: serialized.recurrence_timezone,
        recurrence_anchor: serialized.recurrence_anchor,
        recurrence_until: serialized.recurrence_until
          ? serialized.recurrence_until.toISOString()
          : null,
        recurrence_count: serialized.recurrence_count,
      },
    });
  };

  return (
    <ScrollView className="flex-1 bg-white p-4 dark:bg-black">
      <View className="mb-4">
        <Text className="mb-1 text-sm text-neutral-500">Recurrence</Text>
        <RecurrenceEditor value={recurrence} onChange={setRecurrence} isTask={true} />
      </View>

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
