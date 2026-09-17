import { DatePickerDialog, Host, TimePickerDialog } from "@expo/ui/jetpack-compose";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { FieldLabel, fieldWellClass } from "@/components/ask/text-field";
import { AppText, Icon, IconButton } from "@/components/ui";
import {
  combineDateAndTime,
  datePickerInitialInstant,
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
 * Each dialog MUST be a DIRECT child of <Host>. Found the hard way during
 * Checkpoint 8.4's physical acceptance: with the dialog inside this
 * component's own <View>, tapping the field did nothing at all, and the only
 * evidence anywhere was one logcat line --
 *   ExpoComposeView: MissingHostException: A Jetpack Compose view
 *   "DatePickerDialogView" must be rendered as a direct child of a <Host>
 * -- because any non-Compose ViewGroup between Host and the view breaks the
 * Compose composition boundary. Nothing throws and no test fails, which is
 * why compose-host.test.ts now checks this mechanically.
 *
 * Android-only by construction -- see datetime-field.web.tsx for the web
 * target, which keeps the text input.
 */
// The dialogs overlay the screen themselves, so their Host must occupy no
// layout space in the form. Declared once so both agree.
const HOST_STYLE = { position: "absolute", width: 0, height: 0 } as const;

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
      <FieldLabel>{label}</FieldLabel>
      <View className="flex-row items-center gap-2">
        <Pressable
          testID={testID}
          onPress={() => setPickingDate(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={shown ? `${label}: ${shown}. Change` : `Set ${label}`}
          className={fieldWellClass("flex-1 flex-row items-center gap-2 active:opacity-80")}
        >
          <Icon name="calendar-clock-outline" size="md" tone="on-surface-muted" />
          <AppText variant="body" tone={shown ? "default" : "muted"} className="flex-1">
            {shown ?? "Not set"}
          </AppText>
        </Pressable>
        {shown ? (
          <IconButton
            icon="close-circle"
            onPress={() => onChange(null)}
            accessibilityLabel={`Clear ${label}`}
            tone="on-surface-muted"
          />
        ) : null}
      </View>
      {past ? (
        <AppText variant="caption" tone="warning" className="mt-1">
          That time has already passed.
        </AppText>
      ) : null}

      {pickingDate ? (
        <Host style={HOST_STYLE}>
          <DatePickerDialog
          initialDate={datePickerInitialInstant(pickerInitialInstant(value)).toISOString()}
          onDateSelected={(date) => {
            setPickingDate(false);
            setDraftDate(date);
            setPickingTime(true);
          }}
            onDismissRequest={() => setPickingDate(false)}
          />
        </Host>
      ) : null}

      {pickingTime ? (
        <Host style={HOST_STYLE}>
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
        </Host>
      ) : null}
    </View>
  );
}
