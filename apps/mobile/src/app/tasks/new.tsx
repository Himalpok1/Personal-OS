import { RecurrenceEditor } from "@/components/recurrence/recurrence-editor";
import { useProjects } from "@/queries/projects";
import { useCreateTask } from "@/queries/tasks";
import {
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
} from "@personal-os/core/recurrence/editor";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

export default function NewTaskScreen() {
  const router = useRouter();
  const createTask = useCreateTask();
  const { data: projects } = useProjects();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [recurrence, setRecurrence] = useState<RecurrenceEditorState>({
    enabled: false,
    frequency: "DAILY",
    interval: 1,
    weekdays: [],
    monthDay: null,
    endMode: "never",
    untilDate: null,
    count: null,
    anchor: "due_date",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    isCustom: false,
    rawRrule: null,
  });

  const submit = () => {
    if (!title.trim()) return;
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let recurrenceFields = {};
    if (recurrence.enabled) {
      const serialized = serializeEditorStateToRRule(recurrence);
      recurrenceFields = {
        rrule: serialized.rrule,
        recurrence_timezone: serialized.recurrence_timezone ?? userTimezone,
        recurrence_anchor: serialized.recurrence_anchor,
        recurrence_until: serialized.recurrence_until
          ? serialized.recurrence_until.toISOString()
          : undefined,
        recurrence_count: serialized.recurrence_count ?? undefined,
      };
    }

    createTask.mutate(
      {
        title: title.trim(),
        body: body.trim() || undefined,
        due_at: dueAt.trim() || undefined,
        project_id: projectId,
        timezone: userTimezone,
        ...recurrenceFields,
      },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <ScrollView className="flex-1 bg-white p-4 dark:bg-black">
      <Text className="mb-1 text-sm text-neutral-500">Title</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="What needs doing?"
        placeholderTextColor="#888"
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Notes (optional)</Text>
      <TextInput
        value={body}
        onChangeText={setBody}
        multiline
        placeholder=""
        className="mb-4 min-h-[80px] rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Due date (optional, ISO 8601)</Text>
      <TextInput
        value={dueAt}
        onChangeText={setDueAt}
        placeholder="2026-08-20T15:00:00"
        placeholderTextColor="#888"
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Project (optional)</Text>
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

      <View className="mb-4">
        <Text className="mb-1 text-sm text-neutral-500">Recurrence</Text>
        <RecurrenceEditor value={recurrence} onChange={setRecurrence} isTask={true} />
      </View>

      {createTask.isError ? (
        <Text className="mb-2 text-red-600">Couldn&apos;t create that task.</Text>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={createTask.isPending || !title.trim()}
        className="items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
      >
        <Text className="font-semibold text-white">
          {createTask.isPending ? "Saving..." : "Create task"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
