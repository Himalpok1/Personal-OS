import { confirmDestructive } from "@/components/confirm-destructive";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { DateTimeField } from "@/components/datetime-field";
import { RecurrenceEditor } from "@/components/recurrence/recurrence-editor";
import { TaskActions } from "@/components/task-actions";
import { useProjects } from "@/queries/projects";
import { useArchiveTask, useTask, useUpdateTask } from "@/queries/tasks";
import { ApiClientError } from "@personal-os/api-client";
import {
  parseRRuleStringToEditorState,
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
} from "@personal-os/core/recurrence/editor";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

export default function EditTaskScreen() {
  const keyboardHeight = useKeyboardHeight();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: task, isLoading, isError, error, refetch } = useTask(id);
  const { data: projects } = useProjects();
  const updateTask = useUpdateTask();
  const archiveTask = useArchiveTask();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [remindAt, setRemindAt] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  // Save/Archive failures (Checkpoint 9.3). Previously `updateTask.mutate`
  // had no onError at all, so a failed save left the form exactly as it was
  // with nothing to say why -- and `router.back()` never happened, which was
  // the only hint. The lifecycle actions carry their own banner inside
  // <TaskActions>.
  const [saveError, setSaveError] = useState<string | null>(null);
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
    setDueAt(task.due_at);
    setRemindAt(task.remind_at);
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

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    const status = error instanceof ApiClientError ? error.status : null;
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white px-4 dark:bg-black">
        <Text className="text-red-600">
          {status === 404 ? "This task couldn't be found." : "Couldn't load this task."}
        </Text>
        {/* A 404 is terminal -- refetching the same id repeats the same
            answer -- so the affordance appears only for a failure that could
            actually clear. */}
        {status === 404 ? null : (
          <Pressable
            onPress={() => void refetch()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading this task"
            className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="font-semibold text-white">Retry</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (!task) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  const submit = () => {
    setSaveError(null);
    const serialized = serializeEditorStateToRRule(recurrence);
    updateTask.mutate(
      {
        id: task.id,
        body: {
          title: title.trim() || undefined,
          body: body.trim(),
          due_at: dueAt,
          remind_at: remindAt,
          project_id: projectId ?? null,
          rrule: serialized.rrule,
          recurrence_timezone: serialized.recurrence_timezone,
          recurrence_anchor: serialized.recurrence_anchor,
          recurrence_until: serialized.recurrence_until
            ? serialized.recurrence_until.toISOString()
            : null,
          recurrence_count: serialized.recurrence_count,
        },
      },
      {
        onSuccess: () => router.back(),
        // Never the raw message -- `ApiClientError.message` is the
        // developer-shaped `API error 400: validation_failed`.
        onError: (err) =>
          setSaveError(
            err instanceof ApiClientError && err.code === "validation_failed"
              ? "Couldn't save those changes: something in the form isn't valid."
              : err instanceof ApiClientError && err.status === 404
                ? "This task couldn't be found."
                : "Couldn't save those changes. Please try again.",
          ),
      },
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      // Padding lives entirely in contentContainerStyle (no
      // contentContainerClassName) because NativeWind remaps that class onto
      // this same prop -- see FLOATING_CLEARANCE_PX. The clearance keeps the
      // globally-mounted QuickAdd/PTT buttons off this form's Save/Archive
      // control; the keyboard height gives room to scroll it clear of the IME.
      // Extra room so lower controls can be scrolled clear of the IME --
      // see components/use-keyboard-height.ts for why insets alone don't do it.
      contentContainerStyle={{ padding: 16, paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight }}
      // Without this the first tap on a submit button below a focused field
      // only dismisses the keyboard instead of submitting.
      keyboardShouldPersistTaps="handled"
    >
      {/* Status line + Start/Complete/Drop/Reopen + snooze chips. Sits above
          the form so the one-tap follow-through (the point of 9.3) is reachable
          without scrolling past the editor on a 480x640 screen. */}
      <TaskActions task={task} />

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

      <DateTimeField label="Due date" value={dueAt} onChange={setDueAt} />

      <DateTimeField label="Reminder" value={remindAt} onChange={setRemindAt} warnIfPast />

      <Text className="mb-1 text-sm text-neutral-500">Project</Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {(projects ?? []).map((project) => (
          <Pressable
            key={project.id}
            onPress={() => setProjectId(projectId === project.id ? undefined : project.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: projectId === project.id }}
            className={
              projectId === project.id
                ? "min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-blue-600 px-3 py-1"
                : "min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800"
            }
          >
            <Text className={projectId === project.id ? "text-white" : "text-black dark:text-white"}>
              {project.name}
            </Text>
          </Pressable>
        ))}
      </View>

      {saveError ? (
        <Text className="mb-2 text-red-600" accessibilityRole="alert">
          {saveError}
        </Text>
      ) : null}

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
        onPress={() =>
          confirmDestructive({
        title: "Archive this task?",
        message: "This hides it from your lists. There's currently no way to view or restore it from the app.",
        confirmLabel: "Archive",
        onConfirm: () => {
          setSaveError(null);
          archiveTask.mutate(task.id, {
            onSuccess: () => router.back(),
            onError: () => setSaveError("Couldn't archive this task. Please try again."),
          });
        },
      })
        }
        disabled={archiveTask.isPending}
        className="items-center rounded-lg bg-neutral-100 py-3 dark:bg-neutral-800"
      >
        <Text className="font-semibold text-neutral-600 dark:text-neutral-300">
          {archiveTask.isPending ? "Archiving..." : "Archive task"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
