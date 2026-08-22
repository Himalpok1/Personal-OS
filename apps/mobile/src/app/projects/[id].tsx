import { ApiClientError } from "@personal-os/api-client";
import type { ProjectDetailEvent, ProjectUpdate } from "@personal-os/schema";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useCompleteOccurrence } from "@/queries/occurrences";
import {
  useArchiveProject,
  useCompleteProject,
  usePauseProject,
  useProjectDetail,
  useReopenProject,
  useResumeProject,
  useUnarchiveProject,
  useUpdateProject,
} from "@/queries/projects";
import { useCompleteTask } from "@/queries/tasks";

const STATUS_PILL = {
  active: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  paused: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
} as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatShortDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTargetDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, month! - 1, day ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function eventStartLabel(event: ProjectDetailEvent): string | null {
  if (event.all_day) return event.start_date ? formatTargetDate(event.start_date) : null;
  return event.starts_at ? `Starts ${formatShortDateTime(event.starts_at)}` : null;
}

function ActionButton({
  label,
  onPress,
  disabled,
  className,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-1 items-center rounded-lg py-2.5 active:opacity-80 disabled:opacity-50 ${className ?? "bg-neutral-100 dark:bg-neutral-800"}`}
    >
      <Text className="font-semibold text-neutral-700 dark:text-neutral-200">{label}</Text>
    </Pressable>
  );
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useProjectDetail(id);
  const updateProject = useUpdateProject();
  const pauseProject = usePauseProject();
  const resumeProject = useResumeProject();
  const completeProject = useCompleteProject();
  const reopenProject = useReopenProject();
  const archiveProject = useArchiveProject();
  const unarchiveProject = useUnarchiveProject();
  const completeTask = useCompleteTask();
  const completeOccurrence = useCompleteOccurrence();

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [targetDate, setTargetDate] = useState("");

  useEffect(() => {
    if (data) {
      setName(data.project.name);
      setGoal(data.project.goal ?? "");
      setTargetDate(data.project.target_date ?? "");
    }
  }, [data]);

  if (isError) {
    const status = error instanceof ApiClientError ? error.status : null;
    return (
      <View className="flex-1 items-center justify-center bg-white px-4 dark:bg-black">
        <Text className="text-red-600">
          {status === 404 ? "Project not found." : "Couldn't load project."}
        </Text>
      </View>
    );
  }

  if (isLoading || !data) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  const { project, computed, tasks, notes, events } = data;

  // Task writes change this project's computed strip (counts/next action) and
  // Today's read model; occurrences matter for the recurring fallback path.
  const invalidateAfterTaskWrite = () => {
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: ["today"] });
    void queryClient.invalidateQueries({ queryKey: ["occurrences"] });
  };

  const onCompleteTask = (taskId: string) => {
    completeTask.mutate(taskId, {
      onSuccess: invalidateAfterTaskWrite,
      onError: (err) => {
        if (err instanceof ApiClientError && err.status === 409) {
          const occurrenceId = (err.body as { occurrence_id?: string | null })?.occurrence_id;
          if (occurrenceId) {
            completeOccurrence.mutate(occurrenceId, { onSuccess: invalidateAfterTaskWrite });
          }
        }
      },
    });
  };

  const commitMetadata = (body: ProjectUpdate) => updateProject.mutate({ id: project.id, body });

  const lifecyclePending =
    pauseProject.isPending ||
    resumeProject.isPending ||
    completeProject.isPending ||
    reopenProject.isPending;
  const lifecycleError = [pauseProject, resumeProject, completeProject, reopenProject].find(
    (m) => m.isError,
  )?.error;
  const archiveError = archiveProject.isError
    ? archiveProject.error
    : unarchiveProject.isError
      ? unarchiveProject.error
      : null;

  const openTasks = tasks.items.filter((t) => t.status === "inbox" || t.status === "active");
  const closedTasks = tasks.items.filter((t) => t.status === "done" || t.status === "dropped");

  return (
    <ScrollView className="flex-1 bg-white p-4 dark:bg-black">
      <View className="mb-4 flex-row items-center gap-2">
        <View className="h-4 w-4 rounded-full" style={{ backgroundColor: project.color ?? "#999" }} />
        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed && trimmed !== project.name) commitMetadata({ name: trimmed });
          }}
          className="flex-1 rounded-lg border border-neutral-300 p-2 text-lg font-semibold text-black dark:border-neutral-700 dark:text-white"
        />
        <View className={`rounded px-2 py-0.5 ${STATUS_PILL[project.status]}`}>
          <Text className="text-[10px] uppercase">{project.status}</Text>
        </View>
      </View>

      <Text className="mb-1 text-sm text-neutral-500">Goal</Text>
      <TextInput
        value={goal}
        onChangeText={setGoal}
        multiline
        placeholder="What does done look like?"
        placeholderTextColor="#888"
        onBlur={() => {
          const trimmed = goal.trim();
          if (trimmed !== (project.goal ?? "")) commitMetadata({ goal: trimmed || null });
        }}
        className="mb-2 min-h-[48px] rounded-lg border border-neutral-300 p-2 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Target date (YYYY-MM-DD)</Text>
      <TextInput
        value={targetDate}
        onChangeText={setTargetDate}
        placeholder="2026-12-31"
        placeholderTextColor="#888"
        onBlur={() => {
          const value = targetDate.trim();
          if (value === project.target_date) return;
          if (!value || DATE_PATTERN.test(value)) commitMetadata({ target_date: value || null });
        }}
        className="mb-4 rounded-lg border border-neutral-300 p-2 text-black dark:border-neutral-700 dark:text-white"
      />

      <View className="flex-row gap-2">
        {project.status === "active" ? (
          <>
            <ActionButton
              label="Pause"
              disabled={lifecyclePending}
              onPress={() => pauseProject.mutate(project.id)}
              className="bg-amber-100 dark:bg-amber-900"
            />
            <ActionButton
              label="Complete"
              disabled={lifecyclePending}
              onPress={() => completeProject.mutate(project.id)}
              className="bg-green-100 dark:bg-green-900"
            />
          </>
        ) : null}
        {project.status === "paused" ? (
          <>
            <ActionButton
              label="Resume"
              disabled={lifecyclePending}
              onPress={() => resumeProject.mutate(project.id)}
              className="bg-green-100 dark:bg-green-900"
            />
            <ActionButton
              label="Complete"
              disabled={lifecyclePending}
              onPress={() => completeProject.mutate(project.id)}
              className="bg-blue-100 dark:bg-blue-900"
            />
          </>
        ) : null}
        {project.status === "completed" ? (
          <ActionButton
            label="Reopen"
            disabled={lifecyclePending}
            onPress={() => reopenProject.mutate(project.id)}
            className="bg-blue-100 dark:bg-blue-900"
          />
        ) : null}
        {project.archived_at ? (
          <ActionButton
            label="Unarchive"
            disabled={unarchiveProject.isPending}
            onPress={() => unarchiveProject.mutate(project.id)}
          />
        ) : (
          <ActionButton
            label="Archive"
            disabled={archiveProject.isPending}
            onPress={() => archiveProject.mutate(project.id)}
          />
        )}
      </View>
      {lifecycleError ? <Text className="mt-2 text-red-600">{lifecycleError.message}</Text> : null}
      {archiveError ? <Text className="mt-2 text-red-600">{archiveError.message}</Text> : null}

      <View className="mt-4 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
        <Text className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Next action
        </Text>
        {computed.next_action ? (
          <>
            <Pressable
              onPress={() => router.push(`/tasks/${computed.next_action!.task_id}`)}
              className="mt-1"
            >
              <Text className="text-base font-medium text-black dark:text-white">
                {computed.next_action.title}
              </Text>
            </Pressable>
            <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {computed.next_action.due_at
                ? `Due ${formatShortDateTime(computed.next_action.due_at)}`
                : "No due date"}
              {computed.next_action.priority !== null
                ? ` · Priority ${computed.next_action.priority}`
                : ""}
            </Text>
          </>
        ) : (
          <Text className="mt-1 text-sm text-neutral-400">No next action</Text>
        )}
        <View className="mt-2 flex-row items-center gap-2">
          {computed.stalled ? (
            <View className="rounded bg-amber-100 px-2 py-0.5 dark:bg-amber-900">
              <Text className="text-[10px] uppercase text-amber-700 dark:text-amber-300">
                Stalled
              </Text>
            </View>
          ) : null}
          <Text className="text-xs text-neutral-500 dark:text-neutral-400">
            {computed.counts.open} open · {computed.counts.done} done ·{" "}
            {computed.counts.overdue} overdue
          </Text>
        </View>
        {computed.last_activity_at ? (
          <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Last activity {formatShortDateTime(computed.last_activity_at)}
          </Text>
        ) : null}
      </View>

      <View className="mb-2 mt-5 flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-neutral-500">Tasks ({tasks.total})</Text>
        <Pressable
          onPress={() => router.push(`/tasks/new?projectId=${project.id}`)}
          className="px-2 py-1.5"
        >
          <Text className="text-sm font-semibold text-blue-600">+ Task</Text>
        </Pressable>
      </View>
      {tasks.items.length === 0 ? (
        <Text className="text-neutral-400">No tasks in this project.</Text>
      ) : (
        <>
          {openTasks.map((task) => (
            <View
              key={task.id}
              className="flex-row items-center border-b border-neutral-200 py-2 dark:border-neutral-800"
            >
              <Pressable
                onPress={() => onCompleteTask(task.id)}
                disabled={completeTask.isPending || completeOccurrence.isPending}
                className="mr-3 h-6 w-6 items-center justify-center rounded-full border-2 border-neutral-400 dark:border-neutral-500"
                accessibilityLabel={`Mark "${task.title}" done`}
              />
              <Pressable onPress={() => router.push(`/tasks/${task.id}`)} className="flex-1">
                <Text className="text-black dark:text-white">{task.title}</Text>
                {task.due_at ? (
                  <Text className="text-xs text-neutral-500">
                    Due {formatShortDateTime(task.due_at)}
                  </Text>
                ) : null}
                {task.rrule ? <Text className="text-xs text-neutral-400">↻ Recurring</Text> : null}
              </Pressable>
            </View>
          ))}
          {closedTasks.map((task) => (
            <Pressable
              key={task.id}
              onPress={() => router.push(`/tasks/${task.id}`)}
              className="border-b border-neutral-200 py-2 opacity-50 dark:border-neutral-800"
            >
              <Text className="line-through text-black dark:text-white">{task.title}</Text>
              <Text className="text-xs text-neutral-500">
                {task.status === "done"
                  ? task.completed_at
                    ? `Done ${formatShortDateTime(task.completed_at)}`
                    : "Done"
                  : "Dropped"}
              </Text>
            </Pressable>
          ))}
          {tasks.total > tasks.items.length ? (
            <Text className="py-2 text-xs text-neutral-500">
              &gt;{tasks.total - tasks.items.length} more
            </Text>
          ) : null}
        </>
      )}

      <View className="mb-2 mt-5 flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-neutral-500">Notes ({notes.total})</Text>
        <Pressable
          onPress={() => router.push(`/notes/new?projectId=${project.id}`)}
          className="px-2 py-1.5"
        >
          <Text className="text-sm font-semibold text-blue-600">+ Note</Text>
        </Pressable>
      </View>
      {(notes.items ?? []).map((note) => (
        <Pressable
          key={note.id}
          onPress={() => router.push(`/notes/${note.id}`)}
          className="border-b border-neutral-200 py-2 dark:border-neutral-800"
        >
          <Text className="text-black dark:text-white">{note.title}</Text>
        </Pressable>
      ))}
      {notes.items.length === 0 ? (
        <Text className="text-neutral-400">No notes in this project.</Text>
      ) : notes.total > notes.items.length ? (
        <Text className="py-2 text-xs text-neutral-500">
          &gt;{notes.total - notes.items.length} more
        </Text>
      ) : null}

      <View className="mb-2 mt-5 flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-neutral-500">Events ({events.total})</Text>
        <Pressable
          onPress={() => router.push(`/events/new?projectId=${project.id}`)}
          className="px-2 py-1.5"
        >
          <Text className="text-sm font-semibold text-blue-600">+ Event</Text>
        </Pressable>
      </View>
      {(events.items ?? []).map((event) => {
        const start = eventStartLabel(event);
        return (
          <Pressable
            key={event.id}
            onPress={() => router.push(`/events/${event.id}`)}
            className="border-b border-neutral-200 py-2 dark:border-neutral-800"
          >
            <Text className="text-black dark:text-white">
              {event.title}
              {event.rrule ? " ↻" : ""}
            </Text>
            {start ? (
              <Text className="text-xs text-neutral-500">{start}</Text>
            ) : null}
          </Pressable>
        );
      })}
      {events.items.length === 0 ? (
        <Text className="text-neutral-400">No events in this project.</Text>
      ) : events.total > events.items.length ? (
        <Text className="py-2 text-xs text-neutral-500">
          &gt;{events.total - events.items.length} more
        </Text>
      ) : null}
    </ScrollView>
  );
}
