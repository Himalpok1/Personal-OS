import { ChoiceChip } from "@/components/ask/choice-chip";
import { FieldLabel, textFieldClass } from "@/components/ask/text-field";
import { confirmDestructive } from "@/components/confirm-destructive";
import {
  AppText,
  Button,
  Card,
  ErrorState,
  Icon,
  ScreenCentered,
  ScreenFrame,
  SkeletonCard,
} from "@/components/ui";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { PLACEHOLDER_LIGHT, usePlaceholderColor } from "@/components/placeholder-color";
import { FieldLengthCounter } from "@/components/field-length-counter";
import { DateField } from "@/components/date-field";
import { DateTimeField } from "@/components/datetime-field";
import { CalendarTargetPicker } from "@/components/calendar/calendar-target-picker";
import { EventRepeatField } from "@/components/recurrence/event-repeat-field";
import { applyEventStartChange } from "@/components/recurrence/event-repeat-state";
import {
  allDayRangeError,
  applyStartDateChange,
  applyStartsAtChange,
  calendarLabel,
  classifyEventMutationError,
  eventMutationErrorLine,
  eventWhenLabel,
  externalCalendarLabel,
  RANGE_ERROR_COPY,
  syncStatusLine,
  timedRangeError,
  toCalendarBody,
  type AllDayRange,
  type TimedRange,
} from "@/components/events/event-form-state";
import { ApiClientError } from "@personal-os/api-client";
import { useCalendarTargets, useLinkEventToCalendar } from "@/queries/calendar-connections";
import { useProjects } from "@/queries/projects";
import {
  useArchiveEvent,
  useCancelEventOccurrence,
  useDetachEvent,
  useEvent,
  useUpdateEvent,
} from "@/queries/events";
import {
  ENTITY_TITLE_MAX_CHARS,
  EVENT_DESCRIPTION_MAX_CHARS,
  EVENT_LOCATION_MAX_CHARS,
  type CalendarTarget,
  type EventSyncState,
} from "@personal-os/schema";
import { formatInstantWithOffset } from "@personal-os/core/timezone";
import {
  parseRRuleStringToEditorState,
  resolveInstantToLocalUntil,
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
  type SerializedRecurrenceRule,
} from "@personal-os/core/recurrence/editor";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Modal, ScrollView, Switch, TextInput, View } from "react-native";

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

/** A stored instant re-serialized in the event's own zone for the picker, or null. */
function seedInstant(value: string | null | undefined, timezone: string): string | null {
  if (!value) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : formatInstantWithOffset(instant, timezone);
}

const CONTENT_STYLE = (keyboardHeight: number) => ({
  padding: 16,
  paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight,
});

export interface ExternalEventViewProps {
  keyboardHeight?: number;
  title: string;
  /** From eventWhenLabel -- dates for all-day, local start/end for timed. */
  whenLabel: string;
  location: string | null;
  description: string | null;
  /** From externalCalendarLabel: "From <summary> · read-only". */
  calendarLine: string;
  timezone: string;
}

/**
 * The read-only card for an EXTERNAL event (Checkpoint 9.5): one that
 * originated in a connected calendar and synced inward. The server refuses
 * every mutation on it with `409 event_not_owned`, so this view offers none
 * -- no Save, no Delete, no link, no occurrence modal. Everything shown is
 * text in a `<Text>`; a description holding a conference link stays inert.
 */
export function ExternalEventView(props: ExternalEventViewProps) {
  return (
    <ScreenFrame>
      <ScrollView
        className="flex-1"
        contentContainerStyle={CONTENT_STYLE(props.keyboardHeight ?? 0)}
        testID="external-event-view"
      >
        <Card
          padding="sm"
          className="mb-4 flex-row items-center gap-2"
          testID="external-event-banner"
        >
          <Icon name="calendar-lock-outline" size="md" tone="on-surface-variant" />
          <AppText variant="label" tone="secondary" className="flex-1 font-normal">
            {props.calendarLine}
          </AppText>
        </Card>

        <AppText variant="headline" className="mb-1">
          {props.title}
        </AppText>
        <AppText testID="external-event-when" variant="body" className="mb-4">
          {props.whenLabel}
        </AppText>

        {props.location ? (
          <>
            <FieldLabel>Location</FieldLabel>
            <AppText variant="body" className="mb-4">
              {props.location}
            </AppText>
          </>
        ) : null}

        {props.description ? (
          <>
            <FieldLabel>Description</FieldLabel>
            <AppText variant="body" className="mb-4">
              {props.description}
            </AppText>
          </>
        ) : null}

        <FieldLabel>Timezone</FieldLabel>
        <AppText variant="body" className="mb-4">
          {props.timezone}
        </AppText>
      </ScrollView>
    </ScreenFrame>
  );
}

export interface EditEventViewProps {
  /** Measured IME height; optional so hook-free callers (tests) can omit it. */
  keyboardHeight?: number;
  /**
   * WCAG-compliant placeholder colour, computed by the screen via
   * usePlaceholderColor() (a hook, so it can't be read in this hook-free
   * component). Optional so hook-free callers (tests) can omit it.
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
  timed: TimedRange;
  onStartsAtChange: (val: string | null) => void;
  onEndsAtChange: (val: string | null) => void;
  allDayRange: AllDayRange;
  onStartDateChange: (val: string | null) => void;
  onEndDateChange: (val: string | null) => void;
  timezone: string;
  projects?: { id: string; name: string }[];
  projectId?: string;
  onProjectIdChange: (id?: string) => void;
  onSubmit: () => void;
  isSubmitting?: boolean;
  onDelete?: () => void;
  isDeleting?: boolean;
  /** One classified line for any failed mutation (event-form-state.ts). */
  errorMessage?: string | null;
  /** The event's outbound link, immutable here; null = not linked. */
  sync: EventSyncState | null;
  /** GET /calendar-targets -- for the calendar label and the link picker. */
  calendarTargets: readonly CalendarTarget[];
  /** Link picker state, offered only while `sync` is null. */
  linkTarget: CalendarTarget | null;
  onLinkTargetChange: (target: CalendarTarget | null) => void;
  onLink: () => void;
  isLinking?: boolean;
  linkNote?: string | null;
  /** GET /calendar-targets failed: no link picker can be offered; editing goes on. */
  calendarTargetsError?: boolean;
}

export function EditEventView(props: EditEventViewProps) {
  // Deliberately NO hooks in this component: events-screen.test.tsx invokes it
  // directly as a plain function (no renderer, no dispatcher), so a hook call
  // here throws "Cannot read properties of null (reading 'useState')".
  // keyboardHeight is therefore passed in by the screen below; the picker
  // fields and the repeat field are ELEMENTS in the tree, never called.
  const keyboardHeight = props.keyboardHeight ?? 0;
  const placeholderColor = props.placeholderColor ?? PLACEHOLDER_LIGHT;
  const showRecurrenceEditor = !props.isDetached && props.editMode !== "occurrence";
  const statusLine = syncStatusLine(props.sync);
  // A LOCAL series linked to a calendar cannot detach an occurrence yet
  // (POST /events/:id/detach → 409 linked_series_detach_unsupported: the
  // child could not be pushed), so the modal offers only the series edit
  // and the cancel.
  const canEditOccurrence = props.sync === null;

  return (
    <ScreenFrame>
      <ScrollView
        className="flex-1"
        // Padding lives entirely in contentContainerStyle (no
        // contentContainerClassName) because NativeWind remaps that class onto
        // this same prop -- see FLOATING_CLEARANCE_PX. The clearance keeps the
        // globally-mounted QuickAdd/PTT buttons off this form's Save/Delete
        // control; the keyboard height gives room to scroll it clear of the IME.
        contentContainerStyle={CONTENT_STYLE(keyboardHeight)}
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
          {/* The scrim is the one colour here that is not a token: a modal
              backdrop is the same translucent black in both schemes. */}
          <View className="flex-1 items-center justify-center bg-black/50 p-4">
            <Card padding="lg" elevation="raised" className="w-full max-w-sm">
              <AppText variant="title" className="mb-2">
                Recurring Event
              </AppText>
              <AppText variant="body" tone="secondary" className="mb-5">
                {canEditOccurrence
                  ? "Would you like to edit only this occurrence or the entire recurring series?"
                  : "This series is synced to a calendar, so single occurrences can't be edited yet. Edit the whole series or cancel this occurrence."}
              </AppText>

              {canEditOccurrence ? (
                <Button
                  testID="edit-occurrence-button"
                  label="Edit this occurrence"
                  onPress={props.onSelectEditOccurrence}
                  variant="primary"
                  block
                  className="mb-2.5"
                />
              ) : null}

              <Button
                testID="edit-series-button"
                label="Edit entire series"
                onPress={props.onSelectEditSeries}
                variant="tonal"
                block
                className="mb-2.5"
              />

              <Button
                testID="cancel-occurrence-button"
                label={props.isCanceling ? "Canceling..." : "Cancel this occurrence"}
                onPress={props.onCancelOccurrence}
                disabled={props.isCanceling}
                variant="danger"
                block
                className="mb-2.5"
              />

              <Button
                testID="dismiss-modal-button"
                label="Dismiss"
                onPress={props.onDismissModal}
                variant="ghost"
                block
              />
            </Card>
          </View>
        </Modal>

        {props.isDetached ? (
          <Card
            padding="sm"
            className="mb-4 flex-row items-center gap-2"
            testID="detached-event-banner"
          >
            <Icon name="calendar-edit-outline" size="md" tone="warning" />
            <AppText variant="label" tone="warning" className="flex-1">
              This is a modified occurrence of a recurring event.
            </AppText>
          </Card>
        ) : null}

        <FieldLabel>Title</FieldLabel>
        <TextInput
          value={props.title}
          onChangeText={props.onTitleChange}
          placeholderTextColor={placeholderColor}
          // The server's own bound (packages/schema/src/text-bounds.ts), so an
          // over-long paste is stopped here rather than refused as a 400.
          maxLength={ENTITY_TITLE_MAX_CHARS}
          accessibilityLabel="Title"
          className={textFieldClass({ extra: "mb-4" })}
        />
        <FieldLengthCounter length={props.title.length} maxLength={ENTITY_TITLE_MAX_CHARS} />

        {/* The calendar is create-only (PATCH rejects `calendar`), so a linked
            event shows where it goes and a status line; an unlinked one may
            still be linked once, through the same targets list the create
            screen offers. */}
        <View className="mb-4" testID="event-calendar-section">
          <FieldLabel>Calendar</FieldLabel>
          <AppText testID="event-calendar-label" variant="body">
            {calendarLabel(props.sync, props.calendarTargets)}
          </AppText>
          {statusLine ? (
            <AppText testID="event-sync-status" variant="caption" tone="warning" className="mt-1">
              {statusLine}
            </AppText>
          ) : null}
        </View>

        {props.sync === null ? (
          <>
            <CalendarTargetPicker
              label="Link to a calendar (optional)"
              targets={props.calendarTargets}
              selected={props.linkTarget}
              onChange={props.onLinkTargetChange}
            />
            {props.linkTarget ? (
              <Button
                testID="link-calendar-button"
                label={props.isLinking ? "Linking…" : "Link to calendar"}
                onPress={props.onLink}
                disabled={props.isLinking}
                variant="tonal"
                icon="link-variant"
                block
                className="mb-4"
              />
            ) : null}
            {props.linkNote ? (
              <AppText
                testID="link-calendar-note"
                variant="caption"
                tone="muted"
                className="-mt-2 mb-4"
              >
                {props.linkNote}
              </AppText>
            ) : null}
            {props.calendarTargetsError && props.calendarTargets.length === 0 ? (
              <AppText
                testID="calendar-targets-error"
                variant="caption"
                tone="muted"
                className="mb-4"
              >
                {"Couldn't load calendars — this event will stay in Personal OS only"}
              </AppText>
            ) : null}
          </>
        ) : null}

        <View className="mb-4 flex-row items-center justify-between gap-3">
          <AppText variant="body" className="flex-1">
            All-day
          </AppText>
          <Switch
            value={props.allDay}
            onValueChange={props.onAllDayChange}
            accessibilityLabel="All-day"
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

        {showRecurrenceEditor ? (
          <View testID="recurrence-section">
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
          </View>
        ) : null}

        <FieldLabel>Location</FieldLabel>
        <TextInput
          value={props.location}
          onChangeText={props.onLocationChange}
          maxLength={EVENT_LOCATION_MAX_CHARS}
          accessibilityLabel="Location"
          className={textFieldClass({ extra: "mb-4" })}
        />
        <FieldLengthCounter length={props.location.length} maxLength={EVENT_LOCATION_MAX_CHARS} />

        <FieldLabel>Notes</FieldLabel>
        <TextInput
          value={props.description}
          onChangeText={props.onDescriptionChange}
          multiline
          textAlignVertical="top"
          maxLength={EVENT_DESCRIPTION_MAX_CHARS}
          accessibilityLabel="Notes"
          className={textFieldClass({ multiline: true, extra: "mb-4 min-h-[80px]" })}
        />
        <FieldLengthCounter
          length={props.description.length}
          maxLength={EVENT_DESCRIPTION_MAX_CHARS}
        />

        <FieldLabel>Timezone</FieldLabel>
        <AppText variant="body" className="mb-4">
          {props.timezone}
        </AppText>

        <FieldLabel>Project</FieldLabel>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {(props.projects ?? []).map((project) => (
            <ChoiceChip
              key={project.id}
              label={project.name}
              selected={props.projectId === project.id}
              onPress={() =>
                props.onProjectIdChange(props.projectId === project.id ? undefined : project.id)
              }
              accessibilityLabel={`Project: ${project.name}`}
            />
          ))}
        </View>

        {props.errorMessage ? (
          <AppText
            testID="event-error"
            variant="caption"
            tone="danger"
            className="mb-2"
            accessibilityRole="alert"
          >
            {props.errorMessage}
          </AppText>
        ) : null}

        <Button
          testID="save-event-button"
          label={props.isSubmitting ? "Saving..." : "Save changes"}
          onPress={props.onSubmit}
          disabled={props.isSubmitting}
          variant="primary"
          icon="content-save-outline"
          block
          className="mb-3"
        />

        {props.onDelete ? (
          <Button
            testID="archive-event-button"
            label={props.isDeleting ? "Deleting..." : "Delete event"}
            onPress={props.onDelete}
            disabled={props.isDeleting}
            variant="danger"
            icon="trash-can-outline"
            block
          />
        ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

export default function EditEventScreen() {
  const keyboardHeight = useKeyboardHeight();
  const placeholderColor = usePlaceholderColor();
  const { id, occursAt } = useLocalSearchParams<{ id: string; occursAt?: string }>();
  const router = useRouter();
  const { data: event, isLoading, isError, error, refetch } = useEvent(id);
  const { data: projects } = useProjects();
  const { targets: calendarTargets, isError: calendarTargetsError } = useCalendarTargets();
  const updateEvent = useUpdateEvent();
  const archiveEvent = useArchiveEvent();
  const detachEvent = useDetachEvent();
  const cancelEventOccurrence = useCancelEventOccurrence();
  const linkEvent = useLinkEventToCalendar();
  const [linkTarget, setLinkTarget] = useState<CalendarTarget | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  // One classified line for any failed mutation (Checkpoint 9.5) -- before,
  // a 409 event_not_owned, a 404 and a 503 were all "Couldn't save".
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isDetached = event?.parent_event_id != null;
  const isRecurring = Boolean(event?.rrule);
  // An external event is read-only, full stop: no occurrence modal either.
  const isExternal = event?.origin === "external";

  const [editMode, setEditMode] = useState<EditMode>("standard");
  const [modalVisible, setModalVisible] = useState(() =>
    Boolean(occursAt && isRecurring && event?.origin === "local"),
  );

  const [title, setTitle] = useState(() => event?.title ?? "");
  const [description, setDescription] = useState(() => event?.description ?? "");
  const [location, setLocation] = useState(() => event?.location ?? "");
  const [allDay, setAllDay] = useState(() => event?.all_day ?? false);
  const [allDayRange, setAllDayRange] = useState<AllDayRange>(() => ({
    startDate: event?.start_date ?? null,
    endDate: event?.end_date ?? null,
  }));
  // Timed fields are seeded in the EVENT's zone (formatInstantWithOffset),
  // never as the raw UTC string the API stores, so the picker opens on the
  // wall clock the owner set.
  const [timed, setTimed] = useState<TimedRange>(() => ({
    startsAt: seedInstant(event?.starts_at, event?.timezone ?? "UTC"),
    endsAt: seedInstant(event?.ends_at, event?.timezone ?? "UTC"),
  }));
  const [projectId, setProjectId] = useState<string | undefined>(
    () => event?.project_id ?? undefined,
  );
  const [recurrence, setRecurrence] = useState<RecurrenceEditorState>(() =>
    parseRRuleStringToEditorState(event?.rrule, {
      recurrenceTimezone: event?.recurrence_timezone,
      recurrenceUntil: event?.recurrence_until,
      recurrenceCount: event?.recurrence_count,
      defaultTimezone: event?.timezone,
    }),
  );

  useEffect(() => {
    if (event && occursAt && isRecurring && event.origin === "local") {
      setModalVisible(true);
    }
  }, [event, occursAt, isRecurring]);

  useEffect(() => {
    if (!event) return;
    setTitle(event.title);
    setDescription(event.description ?? "");
    setLocation(event.location ?? "");
    setAllDay(event.all_day);
    setAllDayRange({ startDate: event.start_date ?? null, endDate: event.end_date ?? null });
    setTimed({
      startsAt: seedInstant(event.starts_at, event.timezone),
      endsAt: seedInstant(event.ends_at, event.timezone),
    });
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

  if (isLoading || (!isError && !event)) {
    return (
      <ScreenFrame>
        <View className="px-4 pt-4">
          <SkeletonCard lines={6} />
        </View>
      </ScreenFrame>
    );
  }

  if (isError || !event) {
    const status = error instanceof ApiClientError ? error.status : null;
    return (
      <ScreenCentered>
        <ErrorState
          title={status === 404 ? "Not found" : "Something went wrong"}
          message={status === 404 ? "This event couldn't be found." : "Couldn't load this event."}
          // A 404 is terminal -- refetching the same id repeats the same
          // answer -- so the affordance appears only for a failure that could
          // actually clear.
          onRetry={status === 404 ? undefined : () => void refetch()}
          retryAccessibilityLabel="Retry loading this event"
        />
      </ScreenCentered>
    );
  }

  if (isExternal) {
    return (
      <ExternalEventView
        keyboardHeight={keyboardHeight}
        title={event.title}
        whenLabel={eventWhenLabel(event, occursAt)}
        location={event.location}
        description={event.description}
        calendarLine={externalCalendarLabel(event.sync, calendarTargets)}
        timezone={event.timezone}
      />
    );
  }

  // A refused field (a server 400 or the api-client's pre-request parse)
  // names the field and its bound; see event-form-state.ts.
  const failWith = (verb: string) => (err: unknown) =>
    setErrorMessage(eventMutationErrorLine(err, verb));

  const handleSelectEditOccurrence = () => {
    setModalVisible(false);
    // The modal hides this option for a linked series; guard the screen too.
    if (event.sync !== null) return;
    setEditMode("occurrence");

    if (!occursAt) return;
    const timing = computeOccurrenceTiming(event, occursAt);
    if (timing.allDay) {
      setAllDayRange({ startDate: timing.startDate, endDate: timing.endDate });
    } else {
      setTimed({
        startsAt: seedInstant(timing.startsAt, event.timezone),
        endsAt: seedInstant(timing.endsAt, event.timezone),
      });
    }
  };

  const handleSelectEditSeries = () => {
    setModalVisible(false);
    setEditMode("standard");
  };

  // A Weekly/Monthly repeat follows the START's weekday / day of month, so
  // the repeat state is re-derived from the start field's own onChange --
  // never from an effect, which would rewrite the loaded rule on mount.
  const onStartsAtChange = (value: string | null) => {
    const next = applyStartsAtChange(timed, value, event.timezone);
    setTimed(next);
    setRecurrence((state) =>
      applyEventStartChange(
        state,
        { allDay: false, startDate: null, startsAt: next.startsAt },
        event.timezone,
      ),
    );
  };
  const onStartDateChange = (value: string | null) => {
    const next = applyStartDateChange(allDayRange, value);
    setAllDayRange(next);
    setRecurrence((state) =>
      applyEventStartChange(
        state,
        { allDay: true, startDate: next.startDate, startsAt: null },
        event.timezone,
      ),
    );
  };

  const handleLink = () => {
    if (!linkTarget) return;
    setLinkNote(null);
    setErrorMessage(null);
    linkEvent.mutate(
      { eventId: event.id, body: toCalendarBody(linkTarget) },
      {
        onSuccess: () => setLinkNote("Now syncing to the calendar."),
        onError: (err) => {
          // 409 already_linked is the route's documented idempotent case;
          // 409 event_not_owned is the ownership refusal. Never the raw
          // message (developer-shaped, could carry provider text).
          if (classifyEventMutationError(err) === "not_owned") {
            failWith("link this event")(err);
            return;
          }
          if (err instanceof ApiClientError && err.status === 409) {
            setLinkNote("Already syncing to a calendar.");
            return;
          }
          setLinkNote(
            err instanceof ApiClientError && err.code === "validation_failed"
              ? "Couldn't link: that calendar isn't valid for this event."
              : "Couldn't link to the calendar. Please try again.",
          );
        },
      },
    );
  };

  const handleCancelOccurrence = () => {
    if (!occursAt) return;
    // Confirmed like Delete on this same screen: cancelling an occurrence
    // exdates it from the series with no in-app way back, and the button sits
    // one tap from two non-destructive options in the same modal (6.7A, AY8).
    confirmDestructive({
      title: "Cancel this occurrence?",
      message:
        "This removes just this occurrence from the series. There's currently no way to restore it from the app.",
      cancelLabel: "Keep it",
      confirmLabel: "Cancel occurrence",
      onConfirm: () =>
        cancelEventOccurrence.mutate(
          { id: event.id, body: { original_start_at: occursAt } },
          {
            onSuccess: () => {
              setModalVisible(false);
              router.back();
            },
            onError: (err) => {
              setModalVisible(false);
              failWith("cancel this occurrence")(err);
            },
          },
        ),
    });
  };

  const isSubmitting =
    updateEvent.isPending || detachEvent.isPending || cancelEventOccurrence.isPending;

  const submit = () => {
    setErrorMessage(null);
    const rangeError = allDay ? allDayRangeError(allDayRange) : timedRangeError(timed);
    if (rangeError) {
      setErrorMessage(RANGE_ERROR_COPY[rangeError]);
      return;
    }
    const timing = allDay
      ? {
          start_date: allDayRange.startDate,
          end_date: allDayRange.endDate ?? allDayRange.startDate,
          starts_at: null,
          ends_at: null,
        }
      : {
          starts_at: timed.startsAt,
          ends_at: timed.endsAt,
          start_date: null,
          end_date: null,
        };

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
            ...timing,
            project_id: projectId ?? null,
          },
        },
        { onSuccess: () => router.back(), onError: failWith("save this occurrence") },
      );
      return;
    }

    // The serializer throws on what the inline advanced editor can hold (a
    // half-typed until date); that is a validation outcome for the line,
    // not an unhandled throw from a Save tap.
    let serialized: SerializedRecurrenceRule | null = null;
    if (!isDetached) {
      try {
        serialized = serializeEditorStateToRRule(recurrence);
      } catch {
        setErrorMessage("That repeat rule isn't supported.");
        return;
      }
    }
    updateEvent.mutate(
      {
        id: event.id,
        body: {
          title: title.trim() || undefined,
          description: description.trim() || null,
          location: location.trim() || null,
          all_day: allDay,
          ...timing,
          project_id: projectId ?? null,
          ...(serialized
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
      { onSuccess: () => router.back(), onError: failWith("save those changes") },
    );
  };

  const confirmDelete = () =>
    confirmDestructive({
      title: "Delete this event?",
      message: event.sync
        ? "This removes it from Personal OS and from the linked calendar. There's currently no way to restore it from the app."
        : "This hides it from your lists. There's currently no way to view or restore it from the app.",
      confirmLabel: "Delete",
      onConfirm: () =>
        archiveEvent.mutate(event.id, {
          onSuccess: () => router.back(),
          onError: failWith("delete this event"),
        }),
    });

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
      timed={timed}
      onStartsAtChange={onStartsAtChange}
      onEndsAtChange={(value) => setTimed((range) => ({ ...range, endsAt: value }))}
      allDayRange={allDayRange}
      onStartDateChange={onStartDateChange}
      onEndDateChange={(value) => setAllDayRange((range) => ({ ...range, endDate: value }))}
      timezone={event.timezone}
      projects={projects}
      projectId={projectId}
      onProjectIdChange={setProjectId}
      onSubmit={submit}
      isSubmitting={isSubmitting}
      onDelete={confirmDelete}
      isDeleting={archiveEvent.isPending}
      errorMessage={errorMessage}
      sync={event.sync}
      calendarTargets={calendarTargets}
      linkTarget={linkTarget}
      onLinkTargetChange={setLinkTarget}
      onLink={handleLink}
      isLinking={linkEvent.isPending}
      linkNote={linkNote}
      calendarTargetsError={calendarTargetsError}
    />
  );
}
