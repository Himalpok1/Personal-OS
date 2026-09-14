import type { RecurrenceEditorState } from "@personal-os/core/recurrence/editor";
import { resolveWallClockToInstant } from "@personal-os/core/timezone";
import { isLocalDate } from "@/components/date-field-state";
import { parseLocalDate } from "@/utils/local-date";
import {
  applyDueDateChange,
  type TaskRepeatContext,
} from "@/components/recurrence/task-repeat-state";

/**
 * The event "Repeat" field's pure logic (Checkpoint 9.5). It is the task
 * field's logic (task-repeat-state.ts) with one translation in front: a
 * task's Weekly/Monthly rule follows its DUE instant, an event's follows its
 * START, and an all-day event's start is a bare calendar date rather than an
 * instant. Everything else -- preset selection, the interval clamp, the
 * custom-rule rule, the summary -- is shared, not copied.
 */

export interface EventStart {
  allDay: boolean;
  /** Bare `YYYY-MM-DD`; read only when allDay. */
  startDate: string | null;
  /** ISO instant (with or without offset); read only when timed. */
  startsAt: string | null;
}

/**
 * The instant the repeat logic reads the event's start as, in `timezone`.
 *
 * All-day: local NOON of `startDate` in the rule's zone -- the same anchor
 * ADR-042 uses for all-day recurrence, and, unlike `new Date("YYYY-MM-DD")`
 * (UTC midnight, the previous local day anywhere west of Greenwich), on the
 * intended calendar day at every offset. Timed: the start as given. Null
 * when the start is absent or unreadable, which task-repeat-state.ts then
 * treats as "no date yet" (Weekly/Monthly fall back to today).
 */
export function eventStartInstant(start: EventStart, timezone: string): string | null {
  if (start.allDay) {
    if (!isLocalDate(start.startDate)) return null;
    const date = parseLocalDate(start.startDate);
    return resolveWallClockToInstant(
      {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: 12,
        minute: 0,
        second: 0,
      },
      timezone,
    ).toISOString();
  }
  if (!start.startsAt) return null;
  const instant = new Date(start.startsAt);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

export function eventRepeatContext(start: EventStart, timezone: string): TaskRepeatContext {
  return { dueAt: eventStartInstant(start, timezone), timezone };
}

/**
 * Re-derives Weekly BYDAY / Monthly BYMONTHDAY after the start changed --
 * called by the screen from the start field's onChange, never from an effect
 * (task-repeat-state.ts's applyDueDateChange, and its reasoning, verbatim).
 */
export function applyEventStartChange(
  state: RecurrenceEditorState,
  start: EventStart,
  timezone: string,
): RecurrenceEditorState {
  return applyDueDateChange(state, eventRepeatContext(start, timezone));
}
