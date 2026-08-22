import { Pressable, Text, View } from "react-native";

export type CalendarViewMode = "month" | "week" | "agenda";

const MODES: readonly { value: CalendarViewMode; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "agenda", label: "Agenda" },
];

// Extracted from (tabs)/calendar.tsx's previously-inline Month/Week pills when
// Checkpoint 5.4 added a third mode -- two hand-written copies was tolerable,
// three was the point it earned a component.
//
// The old inline pills were px-3 py-1 (~28px tall), below the min-h-[40px]
// touch target the rest of the app holds itself to (see
// components/reviews/review-step-list.tsx's comment on the same rule). Raised
// here rather than deferred to Checkpoint 5.6, since a third target makes the
// row tighter on the Rabbit R1's 480px-wide screen, not looser.
export function ViewModeToggle({
  value,
  onChange,
}: {
  value: CalendarViewMode;
  onChange: (mode: CalendarViewMode) => void;
}) {
  return (
    <View className="flex-row gap-2">
      {MODES.map((mode) => {
        const active = mode.value === value;
        return (
          <Pressable
            key={mode.value}
            onPress={() => onChange(mode.value)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${mode.label} view`}
            className={
              active
                ? "min-h-[40px] items-center justify-center rounded-full bg-blue-600 px-4"
                : "min-h-[40px] items-center justify-center rounded-full bg-neutral-100 px-4 dark:bg-neutral-800"
            }
          >
            <Text
              className={
                active ? "font-semibold text-white" : "text-black dark:text-white"
              }
            >
              {mode.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
