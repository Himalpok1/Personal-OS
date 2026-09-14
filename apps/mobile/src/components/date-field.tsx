import { DatePickerDialog, Host } from "@expo/ui/jetpack-compose";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  formatDateFieldLabel,
  pickerInitialDate,
  serializePickedDate,
} from "@/components/date-field-state";

/**
 * A date-only Material 3 picker (Checkpoint 9.5) for all-day event dates,
 * which are calendar dates and must never pass through an instant. Same
 * construction as components/datetime-field.tsx -- ONLY the date dialog, no
 * time dialog -- and the same rule: the dialog must be a DIRECT child of
 * <Host> (compose-host.test.ts checks this mechanically; see the
 * MissingHostException note in datetime-field.tsx for why nothing else
 * would catch it).
 *
 * Android-only by construction -- see date-field.web.tsx for the web target.
 */
const HOST_STYLE = { position: "absolute", width: 0, height: 0 } as const;

export interface DateFieldProps {
  label: string;
  /** A bare `YYYY-MM-DD`, or null. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** When false, the field cannot be cleared (an end date always exists). */
  clearable?: boolean;
  testID?: string;
}

export function DateField({ label, value, onChange, clearable = true, testID }: DateFieldProps) {
  const [picking, setPicking] = useState(false);
  const shown = formatDateFieldLabel(value);

  return (
    <View className="mb-4">
      <Text className="mb-1 text-sm text-neutral-500">{label}</Text>
      <View className="flex-row items-center gap-2">
        <Pressable
          testID={testID}
          onPress={() => setPicking(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={shown ? `${label}: ${shown}. Change` : `Set ${label}`}
          className="min-h-[44px] flex-1 justify-center rounded-lg border border-neutral-300 px-3 dark:border-neutral-700"
        >
          <Text className={shown ? "text-black dark:text-white" : "text-neutral-500"}>
            {shown ?? "Not set"}
          </Text>
        </Pressable>
        {shown && clearable ? (
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

      {picking ? (
        <Host style={HOST_STYLE}>
          <DatePickerDialog
            initialDate={pickerInitialDate(value).toISOString()}
            onDateSelected={(date) => {
              setPicking(false);
              onChange(serializePickedDate(date));
            }}
            onDismissRequest={() => setPicking(false)}
          />
        </Host>
      ) : null}
    </View>
  );
}
