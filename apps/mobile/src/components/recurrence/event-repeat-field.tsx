import type { RecurrenceEditorState } from "@personal-os/core/recurrence/editor";
import { TaskRepeatField } from "@/components/recurrence/task-repeat-field";
import { eventStartInstant, type EventStart } from "@/components/recurrence/event-repeat-state";

/**
 * The event "Repeat" field (Checkpoint 9.5): the task field's chip row --
 * Never · Daily · Weekdays · Weekly · Monthly · Every N days, with the
 * amber custom-rule notice and "Edit advanced…" mounting the Phase 4
 * RecurrenceEditor (isTask=false) for anything the presets cannot say --
 * minus the completion anchor and the no-due-date hint, neither of which
 * means anything for an event. Weekly/Monthly derive from the START; the
 * SCREEN re-derives them on a start change via applyEventStartChange.
 */
export interface EventRepeatFieldProps {
  value: RecurrenceEditorState;
  onChange: (state: RecurrenceEditorState) => void;
  start: EventStart;
  /** The device's IANA zone; a loaded rule keeps its own. */
  timezone: string;
  disabled?: boolean;
}

export function EventRepeatField({
  value,
  onChange,
  start,
  timezone,
  disabled,
}: EventRepeatFieldProps) {
  return (
    <TaskRepeatField
      kind="event"
      value={value}
      onChange={onChange}
      dueAt={eventStartInstant(start, timezone)}
      timezone={timezone}
      disabled={disabled}
    />
  );
}
