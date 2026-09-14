import {
  formatRecurrenceSummary,
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
} from "@personal-os/core/recurrence/editor";
import {
  describeTaskRepeat,
  editorStateToPreset,
  EVERY_N_DAYS_MAX,
  EVERY_N_DAYS_MIN,
  presetToEditorState,
  type LocalDate,
  type TaskRepeatPreset,
  type TaskRepeatSelection,
} from "@personal-os/core/recurrence/task-presets";
import { toWallClockComponents } from "@personal-os/core/timezone";

/**
 * Pure logic behind the task "Repeat" field (Checkpoint 9.4), split out from
 * the JSX so it can be unit-tested without a render harness -- the same split
 * as components/datetime-field-state.ts and components/task-actions-state.ts.
 *
 * The field never owns recurrence state of its own: it reads the screen's
 * RecurrenceEditorState, reports which preset that state expresses
 * (editorStateToPreset) and, on every tap, returns a NEW state built by
 * presetToEditorState. Anything the presets cannot express byte-for-byte is
 * `custom`, and every helper here returns such a state UNCHANGED -- the field
 * must never rewrite a rule it did not author (task-presets.ts, semantic 1),
 * and only the explicit "Remove repeat" chip may discard one.
 */

export interface TaskRepeatContext {
  /** The task's due date as the screen holds it (ISO string), or null. */
  dueAt: string | null;
  /** IANA zone to record on a NEW rule and to read `dueAt` in when the state carries none. */
  timezone: string;
  /** Injectable clock for the no-due-date weekly/monthly fallback. */
  now?: Date;
}

export const DEFAULT_EVERY_N_DAYS = EVERY_N_DAYS_MIN;

/** Copy for the amber hint shown when a repeat is chosen but no due date is set. */
export const REPEAT_NO_DUE_DATE_HINT =
  "Starts from the moment you save — set a due date to choose the first time";

/**
 * The zone a rule derives its BY* part in. A loaded task keeps its own
 * `recurrence_timezone` (changing the zone of an existing series is a
 * decision, never a side effect of tapping a chip); a fresh state takes the
 * device's.
 */
export function effectiveTimezone(state: RecurrenceEditorState, ctx: TaskRepeatContext): string {
  return state.timezone ?? ctx.timezone;
}

/**
 * `dueAt` as a local calendar date in `timezone`, or null when there is no
 * due date or it does not parse (these fields have been free-text ISO inputs
 * since Phase 2, so a stored value can be anything at all).
 */
export function dueLocalOf(dueAt: string | null, timezone: string): LocalDate | null {
  if (!dueAt) return null;
  const instant = new Date(dueAt);
  if (Number.isNaN(instant.getTime())) return null;
  const { year, month, day } = toWallClockComponents(instant, timezone);
  return { year, month, day };
}

export function selectionOf(state: RecurrenceEditorState): TaskRepeatSelection {
  return editorStateToPreset(state);
}

function clampInterval(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_EVERY_N_DAYS;
  const whole = Math.trunc(raw);
  if (whole < EVERY_N_DAYS_MIN) return EVERY_N_DAYS_MIN;
  if (whole > EVERY_N_DAYS_MAX) return EVERY_N_DAYS_MAX;
  return whole;
}

function build(
  state: RecurrenceEditorState,
  preset: TaskRepeatPreset,
  ctx: TaskRepeatContext,
  opts: { interval?: number; afterCompletion?: boolean },
): RecurrenceEditorState {
  const timezone = effectiveTimezone(state, ctx);
  return presetToEditorState(preset, {
    dueLocal: dueLocalOf(ctx.dueAt, timezone),
    timezone,
    interval: opts.interval,
    // Weekdays IS a BY* part, which a completion-anchored rule may not
    // carry (task-presets.ts, semantic 3) -- presetToEditorState throws on
    // the combination, so it is never asked for.
    afterCompletion: preset === "weekdays" ? false : (opts.afterCompletion ?? false),
    now: ctx.now,
  });
}

/**
 * Tap on a preset chip. The "after I complete it" toggle and the every-N
 * interval survive a change of preset where they still make sense, so
 * switching Daily → Weekly does not silently drop the anchor the owner set.
 */
export function selectPreset(
  state: RecurrenceEditorState,
  preset: TaskRepeatPreset,
  ctx: TaskRepeatContext,
): RecurrenceEditorState {
  const current = selectionOf(state);
  const afterCompletion = "afterCompletion" in current ? current.afterCompletion : false;
  const interval =
    current.preset === "every_n_days" ? current.interval : DEFAULT_EVERY_N_DAYS;
  return build(state, preset, ctx, { afterCompletion, interval });
}

/**
 * The "Every N days" interval, clamped to [EVERY_N_DAYS_MIN, EVERY_N_DAYS_MAX]
 * (a non-number or a fraction lands on the default). Selects the preset if it
 * is not already the active one, keeping the completion anchor.
 */
export function setInterval(
  state: RecurrenceEditorState,
  raw: number,
  ctx: TaskRepeatContext,
): RecurrenceEditorState {
  const current = selectionOf(state);
  if (current.preset === "custom") return state;
  const afterCompletion = "afterCompletion" in current ? current.afterCompletion : false;
  return build(state, "every_n_days", ctx, { afterCompletion, interval: clampInterval(raw) });
}

/**
 * The "After I complete it" toggle. Refused -- state returned unchanged --
 * for Never (nothing to anchor), Weekdays (semantic 3) and a custom rule
 * (never rewritten here).
 */
export function setAfterCompletion(
  state: RecurrenceEditorState,
  afterCompletion: boolean,
  ctx: TaskRepeatContext,
): RecurrenceEditorState {
  const current = selectionOf(state);
  if (current.preset === "custom" || current.preset === "never" || current.preset === "weekdays") {
    return state;
  }
  const interval = current.preset === "every_n_days" ? current.interval : undefined;
  return build(state, current.preset, ctx, { afterCompletion, interval });
}

/** True when the toggle should be offered for the current selection. */
export function canAnchorOnCompletion(state: RecurrenceEditorState): boolean {
  const current = selectionOf(state);
  return current.preset !== "custom" && current.preset !== "never" && current.preset !== "weekdays";
}

/**
 * Re-derives a due-date-anchored Weekly/Monthly rule after the screen's due
 * date changed, so BYDAY/BYMONTHDAY keep following the date the owner picked.
 * Called by the SCREEN from the due-date field's onChange -- never from an
 * effect on mount, which would rewrite a loaded task's rule before the owner
 * touched anything. Every other selection is returned unchanged: Daily and
 * Every N carry no BY* part, a completion-anchored rule has no date to
 * follow, and a custom rule is never rewritten.
 */
export function applyDueDateChange(
  state: RecurrenceEditorState,
  ctx: TaskRepeatContext,
): RecurrenceEditorState {
  const current = selectionOf(state);
  if (current.preset !== "weekly" && current.preset !== "monthly") return state;
  if (current.afterCompletion) return state;
  return build(state, current.preset, ctx, { afterCompletion: false });
}

/** The "Remove repeat" chip on a custom rule: the one sanctioned way to discard it. */
export function removeRepeat(
  state: RecurrenceEditorState,
  ctx: TaskRepeatContext,
): RecurrenceEditorState {
  return build(state, "never", ctx, {});
}

/**
 * Whether the state expresses a repeat at all. STRUCTURAL -- the same test
 * serializeEditorStateToRRule applies before it builds anything -- and
 * deliberately NOT a call to the serializer: this runs during RENDER (the
 * due-date hint), and the serializer resolves an `until` end date through
 * resolveLocalUntilToInstant, which THROWS on the half-typed "2026-1" the
 * inline advanced editor holds between two keystrokes. A throw in render is
 * the route's error screen, and the owner loses the form. Serialization
 * belongs at submit time, where the screens catch it (app/tasks/[id].tsx,
 * app/tasks/new.tsx).
 */
export function isRepeatEnabled(state: RecurrenceEditorState): boolean {
  if (state.enabled === false) return false;
  return state.isCustom || Boolean(state.rawRrule) || Boolean(state.frequency);
}

/** Whether the amber "set a due date" hint applies. */
export function needsDueDateHint(state: RecurrenceEditorState, dueAt: string | null): boolean {
  return isRepeatEnabled(state) && dueAt === null;
}

/**
 * One line describing the state in the preset vocabulary ("Every 3 days after
 * I complete it"). A custom rule goes through formatRecurrenceSummary directly
 * rather than being serialized first: the advanced editor can hold a
 * half-typed until-date, which the serializer refuses and the summary must not.
 */
export function summaryFor(state: RecurrenceEditorState): string {
  if (selectionOf(state).preset === "custom") return formatRecurrenceSummary(state);
  return describeTaskRepeat(serializeEditorStateToRRule(state));
}
