import { Text, TextInput, View } from "react-native";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { formatFieldLabel, isPastInstant } from "@/components/datetime-field-state";
import type { DateTimeFieldProps } from "@/components/datetime-field";

/**
 * Web fallback. @expo/ui's DatePickerDialog is Jetpack Compose and exists on
 * Android only -- there is no DatePicker in @expo/ui's `universal` build.
 *
 * Rather than ship a half-working picker, web keeps the ISO text input this
 * field has always been, which is honest: the web target is a desktop
 * dashboard where typing a date is not the friction the Rabbit R1 has. Metro
 * resolves this file first for web, so @expo/ui/jetpack-compose never enters
 * the web bundle graph at all.
 */
export function DateTimeField({ label, value, onChange, warnIfPast = false }: DateTimeFieldProps) {
  const placeholderColor = usePlaceholderColor();
  const past = warnIfPast && isPastInstant(value);

  return (
    <View className="mb-4">
      <Text className="mb-1 text-sm text-neutral-500">{label} (ISO 8601)</Text>
      <TextInput
        value={value ?? ""}
        onChangeText={(next) => onChange(next.trim() === "" ? null : next)}
        placeholder="2026-09-15T14:00:00"
        placeholderTextColor={placeholderColor}
        accessibilityLabel={label}
        className="min-h-[44px] rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />
      {value && !formatFieldLabel(value) ? (
        <Text className="mt-1 text-xs text-amber-700 dark:text-amber-500">
          That is not a date we can read.
        </Text>
      ) : null}
      {past ? (
        <Text className="mt-1 text-xs text-amber-700 dark:text-amber-500">
          That time has already passed.
        </Text>
      ) : null}
    </View>
  );
}
