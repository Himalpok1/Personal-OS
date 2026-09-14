import { Text, TextInput, View } from "react-native";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { formatDateFieldLabel } from "@/components/date-field-state";
import type { DateFieldProps } from "@/components/date-field";

/**
 * Web fallback for DateField, on the same reasoning as datetime-field.web.tsx:
 * @expo/ui's DatePickerDialog is Jetpack Compose and Android-only, and the
 * web target is a desktop dashboard where typing "2026-09-15" is no friction.
 * Metro resolves this file first for web, so @expo/ui/jetpack-compose never
 * enters the web bundle graph.
 */
export function DateField({ label, value, onChange }: DateFieldProps) {
  const placeholderColor = usePlaceholderColor();

  return (
    <View className="mb-4">
      <Text className="mb-1 text-sm text-neutral-500">{label} (YYYY-MM-DD)</Text>
      <TextInput
        value={value ?? ""}
        onChangeText={(next) => onChange(next.trim() === "" ? null : next.trim())}
        placeholder="2026-09-15"
        placeholderTextColor={placeholderColor}
        accessibilityLabel={label}
        className="min-h-[44px] rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />
      {value && !formatDateFieldLabel(value) ? (
        <Text className="mt-1 text-xs text-amber-700 dark:text-amber-500">
          That is not a date we can read.
        </Text>
      ) : null}
    </View>
  );
}
