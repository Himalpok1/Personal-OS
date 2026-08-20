import { RecurrenceEditor } from "@/components/recurrence/recurrence-editor";
import { useProjects } from "@/queries/projects";
import { useCreateEvent } from "@/queries/events";
import {
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
} from "@personal-os/core/recurrence/editor";
import type { EventCreate } from "@personal-os/schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

// Pre-fill query-param shape, for a later "tap a day/slot on the calendar"
// flow (built by a different screen-assembly step, not this file) to
// navigate here with, e.g.:
//   router.push(`/events/new?date=2026-09-15&allDay=true`)                       // month-grid day tap
//   router.push(`/events/new?startsAt=2026-09-15T14:00:00-05:00&endsAt=2026-09-15T14:30:00-05:00`) // week-grid slot tap
//
// - date     -- "YYYY-MM-DD". Prefills the all-day start/end date fields
//               directly; also used to derive the date portion of a timed
//               event if startsAt/endsAt aren't given.
// - startsAt -- full ISO 8601 datetime (offset optional, same shape the API
//               itself accepts -- see FlexibleDatetimeSchema). Prefills the
//               timed start field and implies allDay: false unless
//               allDay=true is also explicitly passed.
// - endsAt   -- full ISO 8601 datetime, same shape as startsAt.
// - allDay   -- "true" | "false". Sets the initial state of the All-day
//               toggle. Defaults to "false" (timed event) when omitted,
//               UNLESS only `date` is given with no startsAt/endsAt, in
//               which case it's more useful to default to "true" (a bare
//               day tap on a month grid reads as "create an all-day event
//               on this day").
type NewEventParams = {
  date?: string;
  startsAt?: string;
  endsAt?: string;
  allDay?: string;
};

export default function NewEventScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<NewEventParams>();
  const createEvent = useCreateEvent();
  const { data: projects } = useProjects();

  const [allDay, setAllDay] = useState(
    () => params.allDay === "true" || (Boolean(params.date) && !params.startsAt && !params.endsAt),
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState(
    () => params.date ?? params.startsAt?.slice(0, 10) ?? "",
  );
  const [endDate, setEndDate] = useState(
    () => params.date ?? params.endsAt?.slice(0, 10) ?? params.startsAt?.slice(0, 10) ?? "",
  );
  const [startsAt, setStartsAt] = useState(() => params.startsAt ?? "");
  const [endsAt, setEndsAt] = useState(() => params.endsAt ?? "");
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
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let recurrenceFields: Partial<EventCreate> = {};
    if (recurrence.enabled) {
      const serialized = serializeEditorStateToRRule(recurrence);
      recurrenceFields = {
        rrule: serialized.rrule,
        recurrence_timezone: serialized.recurrence_timezone ?? timezone,
        recurrence_until: serialized.recurrence_until
          ? serialized.recurrence_until.toISOString()
          : undefined,
        recurrence_count: serialized.recurrence_count ?? undefined,
      };
    }
    const body: EventCreate = {
      title: title.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      timezone,
      project_id: projectId,
      all_day: allDay,
      ...(allDay
        ? {
            start_date: startDate.trim() || undefined,
            end_date: endDate.trim() || startDate.trim() || undefined,
          }
        : {
            starts_at: startsAt.trim() || undefined,
            ends_at: endsAt.trim() || undefined,
          }),
      ...recurrenceFields,
    };
    createEvent.mutate(body, { onSuccess: () => router.back() });
  };

  return (
    <ScrollView className="flex-1 bg-white p-4 dark:bg-black">
      <Text className="mb-1 text-sm text-neutral-500">Title</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="What's the event?"
        placeholderTextColor="#888"
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Description (optional)</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        multiline
        className="mb-4 min-h-[80px] rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Location (optional)</Text>
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
        <RecurrenceEditor value={recurrence} onChange={setRecurrence} isTask={false} />
      </View>

      {createEvent.isError ? (
        <Text className="mb-2 text-red-600">Couldn&apos;t create that event.</Text>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={createEvent.isPending || !title.trim()}
        className="items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
      >
        <Text className="font-semibold text-white">
          {createEvent.isPending ? "Saving..." : "Create event"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
