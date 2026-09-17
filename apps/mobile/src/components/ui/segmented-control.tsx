// A segmented control (Checkpoint 10.3): two or three labelled segments on a
// `surface-container` well, the active one lifted onto a `surface-raised`
// pill. Promoted into the design system at Checkpoint 10.4 once it picked up
// a third consumer (task filters) beyond the calendar's Month / Week / Agenda
// toggle and the search screen's Search / Ask toggle. Pure Views and AppText,
// no state of its own -- the caller owns `value`.
//
// Every segment keeps the `selected` accessibility state the toggles it
// replaced already exposed (the ask mode-toggle test pins it byte-for-byte:
// `accessibilityState` is exactly `{ selected }`, nothing else).
import { Pressable, View } from "react-native";
import { AppText } from "./text";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Defaults to the label. */
  accessibilityLabel?: string;
  testID?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Layout-only classes on the well (margins, widths). */
  className?: string;
}

const WELL_CLASS = "flex-row rounded-inner bg-surface-container p-1 dark:bg-surface-container-dark";
const ACTIVE_PILL_CLASS =
  "bg-surface-raised shadow-card dark:bg-surface-raised-dark dark:shadow-none";

function segmentClass(active: boolean): string {
  return [
    "min-h-[44px] flex-1 items-center justify-center rounded-[9px] px-3 active:opacity-80",
    active ? ACTIVE_PILL_CLASS : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <View className={[WELL_CLASS, className].filter(Boolean).join(" ")}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={option.testID}
            onPress={() => onChange(option.value)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            className={segmentClass(active)}
          >
            <AppText
              variant="label"
              tone={active ? "default" : "secondary"}
              className={active ? "font-semibold" : ""}
              numberOfLines={1}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
