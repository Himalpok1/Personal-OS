import type { CalendarTarget } from "@personal-os/schema";
import { Pressable, Text, View } from "react-native";

/**
 * The calendar chip row on the event screens (Checkpoint 9.5), fed by
 * GET /calendar-targets -- only calendars a NEW local event may be written
 * to (sync-enabled, active connection, writable). First chip is "Personal OS
 * only"; the picker renders NOTHING when there are no targets, so an owner
 * with no writable calendar never sees a one-option choice. Google and
 * CalDAV targets look alike here; the selector shape is the server's
 * (event-form-state.ts's toCalendarBody).
 *
 * Hook-free and props-fed (the targets come from useCalendarTargets in the
 * screen) so the hook-free EditEventView/NewEventView can hold it and the
 * tree-walk tests can read it.
 */
export interface CalendarTargetPickerProps {
  targets: readonly CalendarTarget[];
  selected: CalendarTarget | null;
  onChange: (target: CalendarTarget | null) => void;
  label?: string;
  disabled?: boolean;
}

export function calendarTargetKey(target: CalendarTarget): string {
  return `${target.connection_id}:${target.google_calendar_id ?? target.caldav_calendar_url ?? ""}`;
}

const CHIP_ON = "min-h-[44px] items-center justify-center rounded-full bg-blue-600 px-3 py-1";
const CHIP_OFF =
  "min-h-[44px] items-center justify-center rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800";

function chip(props: {
  testID: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      key={props.testID}
      testID={props.testID}
      onPress={props.onPress}
      disabled={props.disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected, disabled: props.disabled }}
      className={`${props.selected ? CHIP_ON : CHIP_OFF} disabled:opacity-50`}
    >
      <Text className={props.selected ? "text-white" : "text-black dark:text-white"}>
        {props.label}
      </Text>
    </Pressable>
  );
}

export function CalendarTargetPicker({
  targets,
  selected,
  onChange,
  label = "Calendar",
  disabled = false,
}: CalendarTargetPickerProps) {
  if (targets.length === 0) return null;
  const selectedKey = selected ? calendarTargetKey(selected) : null;

  return (
    <View className="mb-4" testID="calendar-target-picker">
      <Text className="mb-1 text-sm text-neutral-500">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {chip({
          testID: "calendar-target-none",
          label: "Personal OS only",
          selected: selectedKey === null,
          disabled,
          onPress: () => onChange(null),
        })}
        {targets.map((target) =>
          chip({
            testID: `calendar-target-${calendarTargetKey(target)}`,
            label: target.summary,
            selected: selectedKey === calendarTargetKey(target),
            disabled,
            onPress: () => onChange(target),
          }),
        )}
      </View>
    </View>
  );
}
