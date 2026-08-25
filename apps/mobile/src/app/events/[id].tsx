import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { PLACEHOLDER_LIGHT, usePlaceholderColor } from "@/components/placeholder-color";
import { ApiClientError } from "@personal-os/api-client";
import { GoogleCalendarLinkPicker } from "@/components/calendar/google-calendar-link-picker";
import { RecurrenceEditor } from "@/components/recurrence/recurrence-editor";
import { useLinkableGoogleCalendars, useLinkEventToGoogleCalendar } from "@/queries/calendar-connections";
import { useProjects } from "@/queries/projects";
import {
  useArchiveEvent,
  useCancelEventOccurrence,
  useDetachEvent,
  useEvent,
  useUpdateEvent,
} from "@/queries/events";
import {
  parseRRuleStringToEditorState,
  resolveInstantToLocalUntil,
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
} from "@personal-os/core/recurrence/editor";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

export type EditMode = "standard" | "occurrence";

export function computeOccurrenceTiming(
  event: {
    all_day: boolean;
    starts_at?: string | null;
    ends_at?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    timezone: string;
    recurrence_timezone?: string | null;
  },
  occursAt: string,
) {
  if (event.all_day) {
    // `occursAt` is an ISO instant. All-day recurring occurrences are
    // anchored at LOCAL NOON in the event's recurrence timezone (falling
    // back to the event's own timezone, matching how the API derives
    // EXDATEs -- `parent.recurrenceTimezone ?? parent.timezone` in
    // apps/api/src/routes/events.ts). Slicing the raw instant string would
    // read its UTC calendar date, which is off by a day in any zone whose
    // offset carries local noon across a UTC day boundary (e.g. a positive
    // offset >= 12, such as Pacific/Auckland at UTC+13).
    const tz = event.recurrence_timezone ?? event.timezone;
    const startDate = resolveInstantToLocalUntil(new Date(occursAt), tz);
    let endDate = startDate;
    if (event.start_date && event.end_date) {
      // Pure calendar-date arithmetic performed entirely in UTC-epoch
      // space: `startDate`/`event.start_date`/`event.end_date` are all
      // plain "YYYY-MM-DD" strings (no wall-clock/timezone component), so
      // parsing and re-serializing them via UTC is internally consistent
      // and DST-agnostic -- it only ever preserves a day-count span, it
      // never converts between timezones. The bug this function had was
      // exclusively in how `startDate` itself was derived above, not here.
      //
      // SAFE ONLY under this precondition: `new Date(iso)` +
      // `.toISOString().slice(0, 10)` round-trips correctly IF AND ONLY IF
      // every value that ever enters it is a bare "YYYY-MM-DD" string (which
      // `Date` parses as UTC midnight, then re-serializes as the same UTC
      // date) -- never a full instant carrying a real wall-clock time. All
      // three inputs here (`event.start_date`, `event.end_date`, and the
      // just-computed `startDate`) satisfy that by construction. Do NOT
      // "simplify" this to reuse `formatLocalDate` from `@/utils/local-date`
      // or otherwise feed it a real ISO instant (e.g. a `starts_at`/
      // `occursAt` value) -- that reintroduces exactly the
      // UTC-vs-local-calendar-date bug fixed in `events/new.tsx`'s
      // `deriveAllDaySeedDates` (Checkpoint 5.6), just from the opposite
      // direction (an instant sliced as if it were a bare date, instead of a
      // bare date treated as a local instant).
      const startMs = new Date(event.start_date).getTime();
      const endMs = new Date(event.end_date).getTime();
      const diffDays = Math.max(0, Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)));
      const endObj = new Date(new Date(startDate).getTime() + diffDays * 24 * 60 * 60 * 1000);
      endDate = endObj.toISOString().slice(0, 10);
    }
    return { allDay: true, startDate, endDate, startsAt: "", endsAt: "" };
  } else {
    const occursDate = new Date(occursAt);
    let durationMs = 30 * 60 * 1000;
    if (event.starts_at && event.ends_at) {
      const diff = new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime();
      if (diff > 0) durationMs = diff;
    }
    const occursEndDate = new Date(occursDate.getTime() + durationMs);
    return {
      allDay: false,
      startDate: "",
      endDate: "",
      startsAt: occursDate.toISOString(),
      endsAt: occursEndDate.toISOString(),
    };
  }
}

export interface EditEventViewProps {
  /** Measured IME height; optional so hook-free callers (tests) can omit it. */
  keyboardHeight?: number;
  /**
   * WCAG-compliant placeholder colour, computed by the screen via
   * usePlaceholderColor() (a hook, so it can't be read in this hook-free
   * component). Optional so hook-free callers (tests) can omit it; falls
   * back to the light-mode value rather than the old "#888" (~3.6:1, below
   * AA) so an un-styled test render is still accessible.
   */
  placeholderColor?: string;
  modalVisible: boolean;
  onDismissModal: () => void;
  onSelectEditOccurrence: () => void;
  onSelectEditSeries: () => void;
  onCancelOccurrence: () => void;
  isCanceling?: boolean;
  isDetached: boolean;
  editMode: EditMode;
  recurrence: RecurrenceEditorState;
  onRecurrenceChange: (state: RecurrenceEditorState) => void;
  title: string;
  onTitleChange: (val: string) => void;
  description: string;
  onDescriptionChange: (val: string) => void;
  location: string;
  onLocationChange: (val: string) => void;
  allDay: boolean;
  onAllDayChange: (val: boolean) => void;
  startDate: string;
  onStartDateChange: (val: string) => void;
  endDate: string;
  onEndDateChange: (val: string) => void;
  startsAt: string;
  onStartsAtChange: (val: string) => void;
  endsAt: string;
  onEndsAtChange: (val: string) => void;
  timezone: string;
  projects?: Array<{ id: string; name: string }>;
  projectId?: string;
  onProjectIdChange: (id?: string) => void;
  onSubmit: () => void;
  isSubmitting?: boolean;
  onArchive?: () => void;
  isArchiving?: boolean;
  isError?: boolean;
  selectedGoogleCalendarId?: string;
  onGoogleCalendarChange: (googleCalendarId: string | undefined) => void;
  onLinkToGoogleCalendar: () => void;
  isLinkingToGoogleCalendar?: boolean;
  googleCalendarLinkNote?: string | null;
}

export function EditEventView(props: EditEventViewProps) {
  // Deliberately NO hooks in this component: events-screen.test.tsx invokes it
  // directly as a plain function (no renderer, no dispatcher), so a hook call
  // here throws "Cannot read properties of null (reading 'useState')".
  // keyboardHeight is therefore passed in by the screen below.
  const keyboardHeight = props.keyboardHeight ?? 0;
  const placeholderColor = props.placeholderColor ?? PLACEHOLDER_LIGHT;
  const showRecurrenceEditor = !props.isDetached && props.editMode !== "occurrence";

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
      <Modal
        visible={props.modalVisible}
        transparent
        animationType="fade"
        onRequestClose={props.onDismissModal}
        testID="recurring-action-modal"
      >
        <View className="flex-1 items-center justify-center bg-black/50 p-4">
          <View className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg dark:bg-neutral-900">
            <Text className="mb-2 text-lg font-semibold text-black dark:text-white">
              Recurring Event
            </Text>
            <Text className="mb-5 text-sm text-neutral-600 dark:text-neutral-400">
              Would you like to edit only this occurrence or the entire recurring series?
            </Text>

            <Pressable
              testID="edit-occurrence-button"
              onPress={props.onSelectEditOccurrence}
              className="mb-2.5 items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
            >
              <Text className="font-semibold text-white">Edit this occurrence</Text>
            </Pressable>

            <Pressable
              testID="edit-series-button"
              onPress={props.onSelectEditSeries}
              className="mb-2.5 items-center rounded-lg bg-neutral-100 py-3 active:bg-neutral-200 dark:bg-neutral-800 dark:active:bg-neutral-700"
            >
              <Text className="font-semibold text-black dark:text-white">Edit entire series</Text>
            </Pressable>

            <Pressable
              testID="cancel-occurrence-button"
              onPress={props.onCancelOccurrence}
              disabled={props.isCanceling}
              className="mb-2.5 items-center rounded-lg bg-red-50 py-3 active:bg-red-100 dark:bg-red-950/40 dark:active:bg-red-900/60"
            >
              <Text className="font-semibold text-red-600 dark:text-red-400">
                {props.isCanceling ? "Canceling..." : "Cancel this occurrence"}
              </Text>
            </Pressable>

            <Pressable
              testID="dismiss-modal-button"
              onPress={props.onDismissModal}
              className="items-center py-2"
            >
              <Text className="text-sm text-neutral-500">Dismiss</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {props.isDetached ? (
        <View
          testID="detached-event-banner"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40"
        >
          <Text className="text-sm font-medium text-amber-800 dark:text-amber-200">
            This is a modified occurrence of a recurring event.
          </Text>
        </View>
      ) : null}

      {showRecurrenceEditor ? (
        <View className="mb-4" testID="recurrence-section">
          <Text className="mb-1 text-sm text-neutral-500">Recurrence</Text>
          <RecurrenceEditor
            value={props.recurrence}
            onChange={props.onRecurrenceChange}
            isTask={false}
          />
        </View>
      ) : null}

      <Text className="mb-1 text-sm text-neutral-500">Title</Text>
      <TextInput
        value={props.title}
        onChangeText={props.onTitleChange}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Description</Text>
      <TextInput
        value={props.description}
        onChangeText={props.onDescriptionChange}
        multiline
        className="mb-4 min-h-[80px] rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Location</Text>
      <TextInput
        value={props.location}
        onChangeText={props.onLocationChange}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-black dark:text-white">All-day</Text>
        <Switch value={props.allDay} onValueChange={props.onAllDayChange} />
      </View>

      {props.allDay ? (
        <>
          <Text className="mb-1 text-sm text-neutral-500">Start date (YYYY-MM-DD)</Text>
          <TextInput
            value={props.startDate}
            onChangeText={props.onStartDateChange}
            placeholder="2026-09-15"
            placeholderTextColor={placeholderColor}
            className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
          />

          <Text className="mb-1 text-sm text-neutral-500">End date (YYYY-MM-DD)</Text>
          <TextInput
            value={props.endDate}
            onChangeText={props.onEndDateChange}
            placeholder="2026-09-15"
            placeholderTextColor={placeholderColor}
            className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
          />
        </>
      ) : (
        <>
          <Text className="mb-1 text-sm text-neutral-500">Starts at (ISO 8601)</Text>
          <TextInput
            value={props.startsAt}
            onChangeText={props.onStartsAtChange}
            placeholder="2026-09-15T14:00:00"
            placeholderTextColor={placeholderColor}
            className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
          />

          <Text className="mb-1 text-sm text-neutral-500">Ends at (ISO 8601)</Text>
          <TextInput
            value={props.endsAt}
            onChangeText={props.onEndsAtChange}
            placeholder="2026-09-15T14:30:00"
            placeholderTextColor={placeholderColor}
            className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
          />
        </>
      )}

      <Text className="mb-1 text-sm text-neutral-500">Timezone</Text>
      <Text className="mb-4 text-black dark:text-white">{props.timezone}</Text>

      <Text className="mb-1 text-sm text-neutral-500">Project</Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {(props.projects ?? []).map((project) => (
          <Pressable
            key={project.id}
            onPress={() =>
              props.onProjectIdChange(props.projectId === project.id ? undefined : project.id)
            }
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: props.projectId === project.id }}
            className={
              props.projectId === project.id
                ? "min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-blue-600 px-3 py-1"
                : "min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800"
            }
          >
            <Text
              className={
                props.projectId === project.id ? "text-white" : "text-black dark:text-white"
              }
            >
              {project.name}
            </Text>
          </Pressable>
        ))}
      </View>

      <GoogleCalendarLinkPicker
        selectedGoogleCalendarId={props.selectedGoogleCalendarId}
        onChange={props.onGoogleCalendarChange}
        alreadyLinkedNote={props.googleCalendarLinkNote ?? undefined}
      />
      {props.selectedGoogleCalendarId ? (
        <Pressable
          testID="link-google-calendar-button"
          onPress={props.onLinkToGoogleCalendar}
          disabled={props.isLinkingToGoogleCalendar}
          className="mb-4 rounded-lg bg-neutral-100 py-3 dark:bg-neutral-800"
        >
          <Text className="text-center font-semibold text-black dark:text-white">
            {props.isLinkingToGoogleCalendar ? "Linking…" : "Link to Google Calendar"}
          </Text>
        </Pressable>
      ) : null}

      {props.isError ? (
        <Text className="mb-2 text-red-600">Couldn&apos;t save those changes.</Text>
      ) : null}

      <Pressable
        testID="save-event-button"
        onPress={props.onSubmit}
        disabled={props.isSubmitting}
        className="mb-3 items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
      >
        <Text className="font-semibold text-white">
          {props.isSubmitting ? "Saving..." : "Save changes"}
        </Text>
      </Pressable>

      {props.onArchive ? (
        <Pressable
          testID="archive-event-button"
          onPress={props.onArchive}
          disabled={props.isArchiving}
          className="items-center rounded-lg bg-neutral-100 py-3 dark:bg-neutral-800"
        >
          <Text className="font-semibold text-neutral-600 dark:text-neutral-300">
            {props.isArchiving ? "Archiving..." : "Archive event"}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

export default function EditEventScreen() {
  const keyboardHeight = useKeyboardHeight();
  const placeholderColor = usePlaceholderColor();
  const { id, occursAt } = useLocalSearchParams<{ id: string; occursAt?: string }>();
  const router = useRouter();
  const { data: event, isLoading, isError, error, refetch } = useEvent(id);
  const { data: projects } = useProjects();
  const updateEvent = useUpdateEvent();
  const archiveEvent = useArchiveEvent();
  const detachEvent = useDetachEvent();
  const cancelEventOccurrence = useCancelEventOccurrence();
  const linkToGoogleCalendar = useLinkEventToGoogleCalendar();
  const { connectionId: googleConnectionId } = useLinkableGoogleCalendars();
  const [selectedGoogleCalendarId, setSelectedGoogleCalendarId] = useState<string | undefined>(
    undefined,
  );
  const [googleCalendarLinkNote, setGoogleCalendarLinkNote] = useState<string | null>(null);

  const isDetached = event?.parent_event_id != null;
  const isRecurring = Boolean(event?.rrule);

  const [editMode, setEditMode] = useState<EditMode>("standard");
  const [modalVisible, setModalVisible] = useState(() => Boolean(occursAt && isRecurring));

  const [title, setTitle] = useState(() => event?.title ?? "");
  const [description, setDescription] = useState(() => event?.description ?? "");
  const [location, setLocation] = useState(() => event?.location ?? "");
  const [allDay, setAllDay] = useState(() => event?.all_day ?? false);
  const [startDate, setStartDate] = useState(() => event?.start_date ?? "");
  const [endDate, setEndDate] = useState(() => event?.end_date ?? "");
  const [startsAt, setStartsAt] = useState(() => event?.starts_at ?? "");
  const [endsAt, setEndsAt] = useState(() => event?.ends_at ?? "");
  const [projectId, setProjectId] = useState<string | undefined>(() => event?.project_id ?? undefined);
  const [recurrence, setRecurrence] = useState<RecurrenceEditorState>(() =>
    parseRRuleStringToEditorState(event?.rrule, {
      recurrenceTimezone: event?.recurrence_timezone,
      recurrenceUntil: event?.recurrence_until,
      recurrenceCount: event?.recurrence_count,
      defaultTimezone: event?.timezone,
    }),
  );

  useEffect(() => {
    if (event && occursAt && isRecurring) {
      setModalVisible(true);
    }
  }, [event, occursAt, isRecurring]);

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
          {status === 404 ? "This event couldn't be found." : "Couldn't load this event."}
        </Text>
        {/* A 404 is terminal -- refetching the same id repeats the same
            answer -- so the affordance appears only for a failure that could
            actually clear. */}
        {status === 404 ? null : (
          <Pressable
            onPress={() => void refetch()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading this event"
            className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="font-semibold text-white">Retry</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (!event) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  const handleSelectEditOccurrence = () => {
    setModalVisible(false);
    setEditMode("occurrence");

    if (!occursAt) return;
    const timing = computeOccurrenceTiming(event, occursAt);
    if (timing.allDay) {
      setStartDate(timing.startDate);
      setEndDate(timing.endDate);
    } else {
      setStartsAt(timing.startsAt);
      setEndsAt(timing.endsAt);
    }
  };

  const handleSelectEditSeries = () => {
    setModalVisible(false);
    setEditMode("standard");
  };

  const handleLinkToGoogleCalendar = () => {
    if (!selectedGoogleCalendarId || !googleConnectionId) return;
    setGoogleCalendarLinkNote(null);
    linkToGoogleCalendar.mutate(
      {
        eventId: event.id,
        body: {
          connection_id: googleConnectionId,
          google_calendar_id: selectedGoogleCalendarId,
        },
      },
      {
        onSuccess: () => setGoogleCalendarLinkNote("Now syncing to Google Calendar."),
        onError: (err) => {
          // 409 already_linked -- the route's documented idempotent case
          // (see LinkEventToGoogleCalendarRequestSchema's comment /
          // apps/api's link-google-calendar route). Not an error, just an
          // inline note.
          if (err instanceof ApiClientError && err.status === 409) {
            setGoogleCalendarLinkNote("Already syncing to Google.");
            return;
          }
          // Never the raw message: `ApiClientError.message` is the
          // developer-shaped `API error 400: validation_failed`, and a future
          // route change could put provider text behind it.
          setGoogleCalendarLinkNote(
            err instanceof ApiClientError && err.code === "validation_failed"
              ? "Couldn't link to Google Calendar: that calendar isn't valid for this event."
              : "Couldn't link to Google Calendar. Please try again.",
          );
        },
      },
    );
  };

  const handleCancelOccurrence = () => {
    if (!occursAt) return;
    cancelEventOccurrence.mutate(
      {
        id: event.id,
        body: { original_start_at: occursAt },
      },
      {
        onSuccess: () => {
          setModalVisible(false);
          router.back();
        },
      },
    );
  };

  const isSubmitting =
    updateEvent.isPending || detachEvent.isPending || cancelEventOccurrence.isPending;

  const submit = () => {
    if (editMode === "occurrence" && occursAt) {
      detachEvent.mutate(
        {
          id: event.id,
          body: {
            original_start_at: occursAt,
            title: title.trim() || undefined,
            description: description.trim() || null,
            location: location.trim() || null,
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
          },
        },
        {
          onSuccess: () => router.back(),
        },
      );
      return;
    }

    const serialized = isDetached ? null : serializeEditorStateToRRule(recurrence);
    updateEvent.mutate(
      {
        id: event.id,
        body: {
          title: title.trim() || undefined,
          description: description.trim() || null,
          location: location.trim() || null,
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
          ...(!isDetached && serialized
            ? {
                rrule: serialized.rrule,
                recurrence_timezone: serialized.recurrence_timezone,
                recurrence_until: serialized.recurrence_until
                  ? serialized.recurrence_until.toISOString()
                  : null,
                recurrence_count: serialized.recurrence_count,
              }
            : {}),
        },
      },
      {
        onSuccess: () => router.back(),
      },
    );
  };

  const confirmArchive = () =>
    Alert.alert(
      "Archive this event?",
      "This hides it from your lists. There's currently no way to view or restore it from the app.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: () => archiveEvent.mutate(event.id, { onSuccess: () => router.back() }),
        },
      ],
    );

  return (
    <EditEventView
      keyboardHeight={keyboardHeight}
      placeholderColor={placeholderColor}
      modalVisible={modalVisible}
      onDismissModal={() => setModalVisible(false)}
      onSelectEditOccurrence={handleSelectEditOccurrence}
      onSelectEditSeries={handleSelectEditSeries}
      onCancelOccurrence={handleCancelOccurrence}
      isCanceling={cancelEventOccurrence.isPending}
      isDetached={isDetached}
      editMode={editMode}
      recurrence={recurrence}
      onRecurrenceChange={setRecurrence}
      title={title}
      onTitleChange={setTitle}
      description={description}
      onDescriptionChange={setDescription}
      location={location}
      onLocationChange={setLocation}
      allDay={allDay}
      onAllDayChange={setAllDay}
      startDate={startDate}
      onStartDateChange={setStartDate}
      endDate={endDate}
      onEndDateChange={setEndDate}
      startsAt={startsAt}
      onStartsAtChange={setStartsAt}
      endsAt={endsAt}
      onEndsAtChange={setEndsAt}
      timezone={event.timezone}
      projects={projects}
      projectId={projectId}
      onProjectIdChange={setProjectId}
      onSubmit={submit}
      isSubmitting={isSubmitting}
      onArchive={confirmArchive}
      isArchiving={archiveEvent.isPending}
      isError={updateEvent.isError || detachEvent.isError || cancelEventOccurrence.isError}
      selectedGoogleCalendarId={selectedGoogleCalendarId}
      onGoogleCalendarChange={setSelectedGoogleCalendarId}
      onLinkToGoogleCalendar={handleLinkToGoogleCalendar}
      isLinkingToGoogleCalendar={linkToGoogleCalendar.isPending}
      googleCalendarLinkNote={googleCalendarLinkNote}
    />
  );
}
