import { DatePickerDialog, TimePickerDialog } from "@expo/ui/jetpack-compose";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  combineDateAndTime,
  formatFieldLabel,
  isPastInstant,
  pickerInitialInstant,
  serializePickedInstant,
} from "@/components/datetime-field-state";

/**
 * A real Material 3 date + time picker, replacing the hand-typed ISO-8601
 * TextInputs these fields have used since Phase 2 ("2026-08-20T15:00:00" as
 * placeholder text, with no validation and no timezone).
 *
 * Uses @expo/ui, which was ALREADY an installed dependency and already
 * autolinked with zero import sites -- so this adds no native surface and no
 * new package. The dialog variants are deliberate rather than the inline
 * DateTimePicker: on the Rabbit R1's 480x640 screen an inline Compose picker
 * would dominate the form, whereas a dialog needs no layout budget at all.
 *
 * Date and time are picked in sequence because Material 3 has no combined
 * dialog; combineDateAndTime merges the meaningful half of each.
 *
 * Android-only by construction -- see datetime-field.web.tsx for the web
 * target, which keeps the text input.
 */
export interface DateTimeFieldProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Shown under the field when the chosen instant is already past. */
  warnIfPast?: boolean;
  testID?: string;
}

export function DateTimeField({
  label,
  value,
  onChange,
  warnIfPast = false,
  testID,
}: DateTimeFieldProps) {
  const [pickingDate, setPickingDate] = useState(false);
  const [pickingTime, setPickingTime] = useState(false);
  // Held between the two dialogs. Nothing is committed until BOTH complete,
  // so dismissing the time dialog leaves the previous value untouched.
  const [draftDate, setDraftDate] = useState<Date | null>(null);

  const shown = formatFieldLabel(value);
  const past = warnIfPast && isPastInstant(value);

  return (
    <View className="mb-4">
      <Text className="mb-1 text-sm text-neutral-500">{label}</Text>
      <View className="flex-row items-center gap-2">
        <Pressable
          testID={testID}
          onPress={() => setPickingDate(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={shown ? `${label}: ${shown}. Change` : `Set ${label}`}
          className="min-h-[44px] flex-1 justify-center rounded-lg border border-neutral-300 px-3 dark:border-neutral-700"
        >
          <Text className={shown ? "text-black dark:text-white" : "text-neutral-500"}>
            {shown ?? "Not set"}
          </Text>
        </Pressable>
        {shown ? (
          <Pressable
            onPress={() => onChange(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            className="min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-3"
          >
            <Text className="text-blue-600 dark:text-blue-400">Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {past ? (
        <Text className="mt-1 text-xs text-amber-700 dark:text-amber-500">
          That time has already passed.
        </Text>
      ) : null}

      {pickingDate ? (
        <DatePickerDialog
          initialDate={pickerInitialInstant(value).toISOString()}
          onDateSelected={(date) => {
            setPickingDate(false);
            setDraftDate(date);
            setPickingTime(true);
          }}
          onDismissRequest={() => setPickingDate(false)}
        />
      ) : null}

      {pickingTime ? (
        <TimePickerDialog
          initialDate={pickerInitialInstant(value).toISOString()}
          onDateSelected={(time) => {
            setPickingTime(false);
            const base = draftDate;
            setDraftDate(null);
            if (!base) return;
            onChange(serializePickedInstant(combineDateAndTime(base, time)));
          }}
          onDismissRequest={() => {
            setPickingTime(false);
            setDraftDate(null);
          }}
        />
      ) : null}
    </View>
  );
}
