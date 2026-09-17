import { TextInput, View } from "react-native";
import { FieldLabel, textFieldClass } from "@/components/ask/text-field";
import { AppText } from "@/components/ui";
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
      <FieldLabel>{`${label} (YYYY-MM-DD)`}</FieldLabel>
      <TextInput
        value={value ?? ""}
        onChangeText={(next) => onChange(next.trim() === "" ? null : next.trim())}
        placeholder="2026-09-15"
        placeholderTextColor={placeholderColor}
        accessibilityLabel={label}
        className={textFieldClass()}
      />
      {value && !formatDateFieldLabel(value) ? (
        <AppText variant="caption" tone="warning" className="mt-1">
          That is not a date we can read.
        </AppText>
      ) : null}
    </View>
  );
}
