import type { RecurrenceEditorState } from "@personal-os/core/recurrence/editor";
import {
  EVERY_N_DAYS_MAX,
  EVERY_N_DAYS_MIN,
  type TaskRepeatPreset,
} from "@personal-os/core/recurrence/task-presets";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { RecurrenceEditor } from "@/components/recurrence/recurrence-editor";
import {
  canAnchorOnCompletion,
  needsDueDateHint,
  removeRepeat,
  REPEAT_NO_DUE_DATE_HINT,
  selectionOf,
  selectPreset,
  setAfterCompletion,
  setInterval as setRepeatInterval,
  summaryFor,
  type TaskRepeatContext,
} from "@/components/recurrence/task-repeat-state";

/**
 * The task "Repeat" field (Checkpoint 9.4): one wrapping row of preset chips
 * -- Never · Daily · Weekdays · Weekly · Monthly · Every N days -- an optional
 * "After I complete it" toggle, and a one-line summary. It replaces the full
 * RecurrenceEditor on the task screens, which asked for FREQ/INTERVAL/BYDAY/
 * anchor/end-condition in six separate controls and dominated the Rabbit
 * R1's 480x640 form for a choice that is almost always "daily" or "weekly".
 *
 * The full editor is still reachable: a rule the presets cannot express
 * (an until/count end, a weekday set, a YEARLY rule, anything the parser
 * marked custom) renders as an amber "Custom repeat rule" notice with its
 * summary, an "Edit advanced…" chip that mounts the existing RecurrenceEditor
 * inline, and a "Remove repeat" chip. The chips never rewrite such a rule
 * (task-repeat-state.ts returns it unchanged); only those two chips act on it.
 *
 * Weekly and Monthly derive their weekday / day-of-month from the screen's
 * due date -- and the SCREEN re-derives them when the due date changes, via
 * applyDueDateChange from the due field's onChange, so the two fields agree
 * without an effect that would rewrite a loaded rule on mount.
 *
 * Split as `TaskRepeatFieldView` (props in, callbacks out, no hooks) plus this
 * thin stateful wrapper, following app/events/[id].tsx's EditEventView: the
 * view is what __tests__ walks, and the only state the wrapper owns is UI
 * chrome -- whether the advanced editor is open and the interval box's draft
 * text -- never the recurrence itself.
 */

export interface TaskRepeatFieldProps {
  value: RecurrenceEditorState;
  onChange: (state: RecurrenceEditorState) => void;
  /** The screen's due date, for the hint and for Weekly/Monthly derivation. */
  dueAt: string | null;
  /** The device's IANA zone; a loaded rule keeps its own (see effectiveTimezone). */
  timezone: string;
  disabled?: boolean;
}

export interface TaskRepeatFieldViewProps extends TaskRepeatFieldProps {
  /** What the interval box shows: a draft while typing, else the state's interval. */
  intervalText: string;
  onIntervalTextChange: (text: string) => void;
  onIntervalBlur: () => void;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
}

const PRESET_CHIPS: { preset: TaskRepeatPreset; label: string }[] = [
  { preset: "never", label: "Never" },
  { preset: "daily", label: "Daily" },
  { preset: "weekdays", label: "Weekdays" },
  { preset: "weekly", label: "Weekly" },
  { preset: "monthly", label: "Monthly" },
  { preset: "every_n_days", label: "Every N days" },
];

// The project-chip idiom from app/tasks/new.tsx, so the two chip rows on the
// same form look alike.
const CHIP_ON = "min-h-[44px] items-center justify-center rounded-full bg-blue-600 px-3 py-1";
const CHIP_OFF =
  "min-h-[44px] items-center justify-center rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800";
const CHIP_TEXT_ON = "text-white";
const CHIP_TEXT_OFF = "text-black dark:text-white";

// The amber card classes recurrence-editor.tsx uses for its own custom-rule
// notice, so the two notices read as one kind of thing.
const AMBER_CARD =
  "gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950";
const AMBER_TITLE = "text-sm font-medium text-amber-900 dark:text-amber-200";
const AMBER_BODY = "text-xs text-amber-700 dark:text-amber-300";

// A plain render function rather than a component, so the chips appear in
// the view's element tree as the Pressables they are (the tree-walk tests
// read their accessibility props directly, as recurrence-editor.test.tsx
// does for its own chips).
function chip({
  testID,
  label,
  selected,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  testID: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      key={testID}
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel}
      className={`${selected ? CHIP_ON : CHIP_OFF} disabled:opacity-50`}
    >
      <Text className={selected ? CHIP_TEXT_ON : CHIP_TEXT_OFF}>{label}</Text>
    </Pressable>
  );
}

export function TaskRepeatFieldView({
  value,
  onChange,
  dueAt,
  timezone,
  disabled = false,
  intervalText,
  onIntervalTextChange,
  onIntervalBlur,
  advancedOpen,
  onToggleAdvanced,
}: TaskRepeatFieldViewProps) {
  const ctx: TaskRepeatContext = { dueAt, timezone };
  const selection = selectionOf(value);
  const isCustom = selection.preset === "custom";
  const afterCompletion = "afterCompletion" in selection && selection.afterCompletion;
  const summary = summaryFor(value);

  return (
    <View className="mb-4" testID="task-repeat-field">
      <Text className="mb-1 text-sm text-neutral-500">Repeat</Text>

      {isCustom ? (
        <View testID="repeat-custom-notice" className={AMBER_CARD}>
          <Text className={AMBER_TITLE}>Custom repeat rule</Text>
          <Text testID="repeat-summary" className={AMBER_BODY}>
            {summary}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {chip({
              testID: "repeat-edit-advanced",
              label: advancedOpen ? "Hide advanced" : "Edit advanced…",
              selected: advancedOpen,
              disabled,
              onPress: onToggleAdvanced,
            })}
            {chip({
              testID: "repeat-remove",
              label: "Remove repeat",
              selected: false,
              disabled,
              onPress: () => onChange(removeRepeat(value, ctx)),
            })}
          </View>
        </View>
      ) : (
        <>
          <View className="flex-row flex-wrap gap-2">
            {PRESET_CHIPS.map(({ preset, label }) =>
              chip({
                testID: `repeat-preset-${preset}`,
                label,
                selected: selection.preset === preset,
                disabled,
                onPress: () => onChange(selectPreset(value, preset, ctx)),
              }),
            )}
          </View>

          {selection.preset === "every_n_days" ? (
            <View className="mt-2 flex-row items-center gap-2">
              <Text className="text-sm text-neutral-600 dark:text-neutral-300">Every</Text>
              <TextInput
                testID="repeat-interval-input"
                editable={!disabled}
                keyboardType="number-pad"
                value={intervalText}
                onChangeText={onIntervalTextChange}
                onBlur={onIntervalBlur}
                accessibilityLabel={`Repeat every how many days (${EVERY_N_DAYS_MIN} to ${EVERY_N_DAYS_MAX})`}
                className="min-h-[44px] w-16 rounded-lg border border-neutral-300 bg-white p-2 text-center text-sm font-semibold text-black dark:border-neutral-700 dark:bg-black dark:text-white"
              />
              <Text className="text-sm text-neutral-600 dark:text-neutral-300">days</Text>
            </View>
          ) : null}

          {canAnchorOnCompletion(value) ? (
            <View className="mt-2 flex-row flex-wrap gap-2">
              {chip({
                testID: "repeat-after-completion",
                label: "After I complete it",
                selected: afterCompletion,
                disabled,
                onPress: () => onChange(setAfterCompletion(value, !afterCompletion, ctx)),
                accessibilityLabel: "Repeat after I complete it, instead of on a fixed schedule",
              })}
            </View>
          ) : null}

          {selection.preset !== "never" ? (
            <Text
              testID="repeat-summary"
              className="mt-2 text-sm text-neutral-700 dark:text-neutral-300"
            >
              {summary}
            </Text>
          ) : null}
        </>
      )}

      {needsDueDateHint(value, dueAt) ? (
        <View testID="repeat-due-hint" className={`mt-2 ${AMBER_CARD}`}>
          <Text className={AMBER_BODY}>{REPEAT_NO_DUE_DATE_HINT}</Text>
        </View>
      ) : null}

      {isCustom && advancedOpen ? (
        <View testID="repeat-advanced-editor" className="mt-2">
          {/* The existing editor, unchanged: it already preserves rawRrule
              until the owner explicitly replaces the rule, so mounting it
              here never clobbers anything. */}
          <RecurrenceEditor value={value} onChange={onChange} isTask disabled={disabled} />
        </View>
      ) : null}
    </View>
  );
}

export function TaskRepeatField(props: TaskRepeatFieldProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Draft text for the interval box. Committing the CLAMPED integer on every
  // keystroke while showing the raw text lets the owner clear the box and
  // type "3" without the field snapping back to "2" between the two taps;
  // blur discards the draft and the clamped value shows.
  const [intervalDraft, setIntervalDraft] = useState<string | null>(null);

  const selection = selectionOf(props.value);
  const intervalText =
    intervalDraft ??
    String(selection.preset === "every_n_days" ? selection.interval : EVERY_N_DAYS_MIN);

  const onIntervalTextChange = (text: string) => {
    setIntervalDraft(text);
    const digits = text.replace(/[^0-9]/g, "");
    if (digits === "") return;
    props.onChange(
      setRepeatInterval(props.value, Number(digits), {
        dueAt: props.dueAt,
        timezone: props.timezone,
      }),
    );
  };

  return (
    <TaskRepeatFieldView
      {...props}
      intervalText={intervalText}
      onIntervalTextChange={onIntervalTextChange}
      onIntervalBlur={() => setIntervalDraft(null)}
      advancedOpen={advancedOpen}
      onToggleAdvanced={() => setAdvancedOpen((open) => !open)}
    />
  );
}
