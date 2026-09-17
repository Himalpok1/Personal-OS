import { TextInput, View } from "react-native";
import { FieldLabel, textFieldClass } from "@/components/ask/text-field";
import { AppText } from "@/components/ui";
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
      <FieldLabel>{`${label} (ISO 8601)`}</FieldLabel>
      <TextInput
        value={value ?? ""}
        onChangeText={(next) => onChange(next.trim() === "" ? null : next)}
        placeholder="2026-09-15T14:00:00"
        placeholderTextColor={placeholderColor}
        accessibilityLabel={label}
        className={textFieldClass()}
      />
      {value && !formatFieldLabel(value) ? (
        <AppText variant="caption" tone="warning" className="mt-1">
          That is not a date we can read.
        </AppText>
      ) : null}
      {past ? (
        <AppText variant="caption" tone="warning" className="mt-1">
          That time has already passed.
        </AppText>
      ) : null}
    </View>
  );
}
