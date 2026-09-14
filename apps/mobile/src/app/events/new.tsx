import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { PLACEHOLDER_LIGHT, usePlaceholderColor } from "@/components/placeholder-color";
import { DateField } from "@/components/date-field";
import { DateTimeField } from "@/components/datetime-field";
import { deviceTimezone } from "@/components/datetime-field-state";
import { CalendarTargetPicker } from "@/components/calendar/calendar-target-picker";
import { EventRepeatField } from "@/components/recurrence/event-repeat-field";
import { applyEventStartChange } from "@/components/recurrence/event-repeat-state";
import {
  allDayRangeError,
  applyStartDateChange,
  applyStartsAtChange,
  buildEventCreateBody,
  classifyEventMutationError,
  defaultEndFor,
  eventMutationErrorCopy,
  initialClientUuidState,
  markAttemptFailed,
  nextClientUuidAfterEdit,
  RANGE_ERROR_COPY,
  timedRangeError,
  type AllDayRange,
  type TimedRange,
} from "@/components/events/event-form-state";
import { useCalendarTargets } from "@/queries/calendar-connections";
import { coerceProjectIdParam, useProjects } from "@/queries/projects";
import { useCreateEvent } from "@/queries/events";
import { deriveAllDaySeedDates } from "@/utils/all-day-seed";
import { formatInstantWithOffset } from "@personal-os/core/timezone";
import {
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
  type SerializedRecurrenceRule,
} from "@personal-os/core/recurrence/editor";
import type { CalendarTarget } from "@personal-os/schema";
import { randomUUID } from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

// Pre-fill query-param shape, used by the calendar tab's day/slot taps:
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
// - projectId -- preselects a project chip (project detail "+ Event").
type NewEventParams = {
  date?: string;
  startsAt?: string;
  endsAt?: string;
  allDay?: string;
  projectId?: string;
};

/** A pre-fill instant re-serialized in the device zone, or null if unreadable. */
function seedInstant(value: string | undefined, timezone: string): string | null {
  if (!value) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : formatInstantWithOffset(instant, timezone);
}

export interface NewEventViewProps {
  keyboardHeight?: number;
  placeholderColor?: string;
  timezone: string;
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  location: string;
  onLocationChange: (value: string) => void;
  allDay: boolean;
  onAllDayChange: (value: boolean) => void;
  timed: TimedRange;
  onStartsAtChange: (value: string | null) => void;
  onEndsAtChange: (value: string | null) => void;
  allDayRange: AllDayRange;
  onStartDateChange: (value: string | null) => void;
  onEndDateChange: (value: string | null) => void;
  recurrence: RecurrenceEditorState;
  onRecurrenceChange: (state: RecurrenceEditorState) => void;
  calendarTargets: readonly CalendarTarget[];
  /** GET /calendar-targets failed: the picker cannot be offered, creation can. */
  calendarTargetsError?: boolean;
  calendar: CalendarTarget | null;
  onCalendarChange: (target: CalendarTarget | null) => void;
  projects?: { id: string; name: string }[];
  projectId?: string;
  onProjectIdChange: (id?: string) => void;
  formError: string | null;
  onSubmit: () => void;
  isSubmitting?: boolean;
}

export function NewEventView(props: NewEventViewProps) {
  // Hook-free, like app/events/[id].tsx's EditEventView: the tests call it
  // as a plain function and walk the tree. The stateful fields it holds
  // (DateTimeField, DateField, EventRepeatField) are elements, not calls.
  const keyboardHeight = props.keyboardHeight ?? 0;
  const placeholderColor = props.placeholderColor ?? PLACEHOLDER_LIGHT;

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      // Padding lives entirely in contentContainerStyle (no
      // contentContainerClassName) because NativeWind remaps that class onto
      // this same prop -- see FLOATING_CLEARANCE_PX. The clearance keeps the
      // globally-mounted QuickAdd/PTT buttons off this form's Create control;
      // the keyboard height gives room to scroll it clear of the IME.
      contentContainerStyle={{ padding: 16, paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight }}
      // Without this the first tap on a submit button below a focused field
      // only dismisses the keyboard instead of submitting.
      keyboardShouldPersistTaps="handled"
    >
      <Text className="mb-1 text-sm text-neutral-500">Title</Text>
      <TextInput
        testID="event-title-input"
        value={props.title}
        onChangeText={props.onTitleChange}
        placeholder="What's the event?"
        placeholderTextColor={placeholderColor}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <CalendarTargetPicker
        targets={props.calendarTargets}
        selected={props.calendar}
        onChange={props.onCalendarChange}
      />
      {/* An erroring targets query must never hide the fact that no calendar
          can be chosen -- the event is still created, in Personal OS only. */}
      {props.calendarTargetsError && props.calendarTargets.length === 0 ? (
        <Text testID="calendar-targets-error" className="mb-4 text-xs text-neutral-500">
          {"Couldn't load calendars — this event will stay in Personal OS only"}
        </Text>
      ) : null}

      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-black dark:text-white">All-day</Text>
        <Switch
          testID="event-all-day-switch"
          value={props.allDay}
          onValueChange={props.onAllDayChange}
        />
      </View>

      {props.allDay ? (
        <>
          <DateField
            testID="event-start-date"
            label="Start date"
            value={props.allDayRange.startDate}
            onChange={props.onStartDateChange}
          />
          <DateField
            testID="event-end-date"
            label="End date"
            value={props.allDayRange.endDate}
            onChange={props.onEndDateChange}
            clearable={false}
          />
        </>
      ) : (
        <>
          <DateTimeField
            testID="event-starts-at"
            label="Starts"
            value={props.timed.startsAt}
            onChange={props.onStartsAtChange}
          />
          <DateTimeField
            testID="event-ends-at"
            label="Ends"
            value={props.timed.endsAt}
            onChange={props.onEndsAtChange}
          />
        </>
      )}

      <EventRepeatField
        value={props.recurrence}
        onChange={props.onRecurrenceChange}
        start={{
          allDay: props.allDay,
          startDate: props.allDayRange.startDate,
          startsAt: props.timed.startsAt,
        }}
        timezone={props.timezone}
      />

      <Text className="mb-1 text-sm text-neutral-500">Location (optional)</Text>
      <TextInput
        value={props.location}
        onChangeText={props.onLocationChange}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Notes (optional)</Text>
      <TextInput
        value={props.description}
        onChangeText={props.onDescriptionChange}
        multiline
        className="mb-4 min-h-[80px] rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Project (optional)</Text>
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

      {props.formError ? (
        <Text testID="event-form-error" className="mb-2 text-red-600" accessibilityRole="alert">
          {props.formError}
        </Text>
      ) : null}

      <Pressable
        testID="create-event-button"
        onPress={props.onSubmit}
        disabled={props.isSubmitting || !props.title.trim()}
        className="items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
      >
        <Text className="font-semibold text-white">
          {props.isSubmitting ? "Saving..." : "Create event"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

export default function NewEventScreen() {
  const keyboardHeight = useKeyboardHeight();
  const placeholderColor = usePlaceholderColor();
  const router = useRouter();
  const params = useLocalSearchParams<NewEventParams>();
  const createEvent = useCreateEvent();
  const { targets: calendarTargets, isError: calendarTargetsError } = useCalendarTargets();
  const { data: projects } = useProjects();
  const timezone = deviceTimezone();

  // ONE idempotency key per composer session, minted before the first
  // attempt and sent on every attempt (the capture composer's rule): a retry
  // after an ambiguous response gets the existing row back from POST /events
  // rather than a second event. A fresh uuid per tap would defeat that. The
  // one exception is an EDIT after a failed attempt -- a new intent, which
  // must not be answered with the row the failed attempt may have committed
  // (event-form-state.ts, nextClientUuidAfterEdit).
  const [idempotency, setIdempotency] = useState(() => initialClientUuidState(randomUUID));
  const noteEdit = () => setIdempotency((state) => nextClientUuidAfterEdit(state, randomUUID));
  // Every field setter passes through here so no edit can miss the rule.
  const edited =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      noteEdit();
      set(value);
    };

  const [allDay, setAllDay] = useState(
    () => params.allDay === "true" || (Boolean(params.date) && !params.startsAt && !params.endsAt),
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [allDayRange, setAllDayRange] = useState<AllDayRange>(() => {
    const seed = deriveAllDaySeedDates(params);
    return { startDate: seed.startDate || null, endDate: seed.endDate || null };
  });
  const [timed, setTimed] = useState<TimedRange>(() => {
    const startsAt = seedInstant(params.startsAt, timezone);
    const endsAt = seedInstant(params.endsAt, timezone);
    return { startsAt, endsAt: endsAt ?? (startsAt ? defaultEndFor(startsAt, timezone) : null) };
  });
  const [calendar, setCalendar] = useState<CalendarTarget | null>(null);
  // A client-side refusal (dates, an unserializable repeat rule) or a
  // classified server failure; both render in the same line.
  const [formError, setFormError] = useState<string | null>(null);
  // Preselected via /events/new?projectId=<uuid> (project detail "+ Event").
  const [projectId, setProjectId] = useState<string | undefined>(() =>
    coerceProjectIdParam(params.projectId),
  );
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
    timezone,
    isCustom: false,
    rawRrule: null,
  });

  // A Weekly/Monthly repeat follows the START's weekday / day of month, so
  // the repeat state is re-derived from the start field's own onChange --
  // never from an effect (components/recurrence/event-repeat-state.ts).
  const onStartsAtChange = (value: string | null) => {
    noteEdit();
    const next = applyStartsAtChange(timed, value, timezone);
    setTimed(next);
    setRecurrence((state) =>
      applyEventStartChange(
        state,
        { allDay: false, startDate: null, startsAt: next.startsAt },
        timezone,
      ),
    );
  };
  const onStartDateChange = (value: string | null) => {
    noteEdit();
    const next = applyStartDateChange(allDayRange, value);
    setAllDayRange(next);
    setRecurrence((state) =>
      applyEventStartChange(
        state,
        { allDay: true, startDate: next.startDate, startsAt: null },
        timezone,
      ),
    );
  };

  const submit = () => {
    if (!title.trim()) return;
    setFormError(null);
    const rangeError = allDay ? allDayRangeError(allDayRange) : timedRangeError(timed);
    if (rangeError) {
      setFormError(RANGE_ERROR_COPY[rangeError]);
      return;
    }
    let serialized: SerializedRecurrenceRule | null = null;
    if (recurrence.enabled) {
      // The serializer throws on what the inline advanced editor can hold
      // (a half-typed until date); that is a validation outcome for the
      // banner, not an unhandled throw from a Create tap.
      try {
        serialized = serializeEditorStateToRRule(recurrence);
      } catch {
        setFormError("That repeat rule isn't supported.");
        return;
      }
    }
    const body = buildEventCreateBody(
      { title, description, location, allDay, timed, allDayRange, projectId, calendar },
      { clientUuid: idempotency.clientUuid, timezone, recurrence: serialized },
    );
    createEvent.mutate(body, {
      onSuccess: () => router.back(),
      onError: (error) => {
        setIdempotency(markAttemptFailed);
        setFormError(
          eventMutationErrorCopy(classifyEventMutationError(error), "create that event"),
        );
      },
    });
  };

  return (
    <NewEventView
      keyboardHeight={keyboardHeight}
      placeholderColor={placeholderColor}
      timezone={timezone}
      title={title}
      onTitleChange={edited(setTitle)}
      description={description}
      onDescriptionChange={edited(setDescription)}
      location={location}
      onLocationChange={edited(setLocation)}
      allDay={allDay}
      onAllDayChange={edited(setAllDay)}
      timed={timed}
      onStartsAtChange={onStartsAtChange}
      onEndsAtChange={edited((value: string | null) =>
        setTimed((range) => ({ ...range, endsAt: value })),
      )}
      allDayRange={allDayRange}
      onStartDateChange={onStartDateChange}
      onEndDateChange={edited((value: string | null) =>
        setAllDayRange((range) => ({ ...range, endDate: value })),
      )}
      recurrence={recurrence}
      onRecurrenceChange={edited(setRecurrence)}
      calendarTargets={calendarTargets}
      calendarTargetsError={calendarTargetsError}
      calendar={calendar}
      onCalendarChange={edited(setCalendar)}
      projects={projects}
      projectId={projectId}
      onProjectIdChange={edited(setProjectId)}
      formError={formError}
      onSubmit={submit}
      isSubmitting={createEvent.isPending}
    />
  );
}
