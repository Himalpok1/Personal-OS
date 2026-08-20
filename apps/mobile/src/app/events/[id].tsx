import { RecurrenceEditor } from "@/components/recurrence/recurrence-editor";
import { useProjects } from "@/queries/projects";
import { useArchiveEvent, useEvent, useUpdateEvent } from "@/queries/events";
import {
  parseRRuleStringToEditorState,
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
} from "@personal-os/core/recurrence/editor";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

export default function EditEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: event, isLoading } = useEvent(id);
  const { data: projects } = useProjects();
  const updateEvent = useUpdateEvent();
  const archiveEvent = useArchiveEvent();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [recurrence, setRecurrence] = useState<RecurrenceEditorState>(() =>
    parseRRuleStringToEditorState(event?.rrule, {
      recurrenceTimezone: event?.recurrence_timezone,
      recurrenceUntil: event?.recurrence_until,
      recurrenceCount: event?.recurrence_count,
      defaultTimezone: event?.timezone,
    }),
  );

  useEffect(() => {
    if (!event) return;
    setTitle(event.title);
    setDescription(event.description ?? "");
    setLocation(event.location ?? "");
    setAllDay(event.all_day);
    setStartDate(event.start_date ?? "");
    setEndDate(event.end_date ?? "");
    setStartsAt(event.starts_at ?? "");
    setEndsAt(event.ends_at ?? "");
    setProjectId(event.project_id ?? undefined);
    setRecurrence(
      parseRRuleStringToEditorState(event.rrule, {
        recurrenceTimezone: event.recurrence_timezone,
        recurrenceUntil: event.recurrence_until,
        recurrenceCount: event.recurrence_count,
        defaultTimezone: event.timezone,
      }),
    );
  }, [event]);

  if (isLoading || !event) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  const submit = () => {
    const serialized = serializeEditorStateToRRule(recurrence);
    updateEvent.mutate({
      id: event.id,
      body: {
        title: title.trim() || undefined,
        description: description.trim(),
        location: location.trim(),
        all_day: allDay,
        ...(allDay
          ? {
              start_date: startDate.trim() || null,
              end_date: endDate.trim() || null,
              starts_at: null,
              ends_at: null,
            }
          : {
              starts_at: startsAt.trim() || null,
              ends_at: endsAt.trim() || null,
              start_date: null,
              end_date: null,
            }),
        project_id: projectId ?? null,
        rrule: serialized.rrule,
        recurrence_timezone: serialized.recurrence_timezone,
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
        <RecurrenceEditor value={recurrence} onChange={setRecurrence} isTask={false} />
      </View>

      <Text className="mb-1 text-sm text-neutral-500">Title</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Description</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        multiline
        className="mb-4 min-h-[80px] rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Location</Text>
      <TextInput
        value={location}
        onChangeText={setLocation}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-black dark:text-white">All-day</Text>
        <Switch value={allDay} onValueChange={setAllDay} />
      </View>

      {allDay ? (
        <>
          <Text className="mb-1 text-sm text-neutral-500">Start date (YYYY-MM-DD)</Text>
          <TextInput
            value={startDate}
            onChangeText={setStartDate}
            placeholder="2026-09-15"
            placeholderTextColor="#888"
            className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
          />

          <Text className="mb-1 text-sm text-neutral-500">End date (YYYY-MM-DD)</Text>
          <TextInput
            value={endDate}
            onChangeText={setEndDate}
            placeholder="2026-09-15"
            placeholderTextColor="#888"
            className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
          />
        </>
      ) : (
        <>
          <Text className="mb-1 text-sm text-neutral-500">Starts at (ISO 8601)</Text>
          <TextInput
            value={startsAt}
            onChangeText={setStartsAt}
            placeholder="2026-09-15T14:00:00"
            placeholderTextColor="#888"
            className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
          />

          <Text className="mb-1 text-sm text-neutral-500">Ends at (ISO 8601)</Text>
          <TextInput
            value={endsAt}
            onChangeText={setEndsAt}
            placeholder="2026-09-15T14:30:00"
            placeholderTextColor="#888"
            className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
          />
        </>
      )}

      <Text className="mb-1 text-sm text-neutral-500">Timezone</Text>
      <Text className="mb-4 text-black dark:text-white">{event.timezone}</Text>

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

      {updateEvent.isError ? (
        <Text className="mb-2 text-red-600">Couldn&apos;t save those changes.</Text>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={updateEvent.isPending}
        className="mb-3 items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
      >
        <Text className="font-semibold text-white">
          {updateEvent.isPending ? "Saving..." : "Save changes"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => archiveEvent.mutate(event.id, { onSuccess: () => router.back() })}
        className="items-center rounded-lg bg-neutral-100 py-3 dark:bg-neutral-800"
      >
        <Text className="font-semibold text-neutral-600 dark:text-neutral-300">
          Archive event
        </Text>
      </Pressable>
    </ScrollView>
  );
}
