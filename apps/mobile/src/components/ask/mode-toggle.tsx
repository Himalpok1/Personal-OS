import { Pressable, Text, View } from "react-native";

// The two-way "Search" / "Ask" switch shown above the search screen's input
// whenever Cloud Ask is enabled (Checkpoint 8.6B). Rendered by the screen's
// hook-wiring wrapper (`app/search/index.tsx`'s default export), never by
// `SearchView`/`AskView` themselves -- both stay props-driven and hookless,
// only accepting this as an already-built `modeToggle` node. This component
// owns no state of its own either, so it slots into whichever view is active
// unchanged.
//
// Deliberately not a `Switch`: two labelled, tappable segments read better at
// 480px than a single boolean control whose two ends need their own labels
// anyway, and there is no sixth tab or third header icon here -- this is the
// entire affordance for switching modes inside the existing search screen.

export type SearchAskMode = "search" | "ask";

export interface AskModeToggleProps {
  mode: SearchAskMode;
  onChange: (mode: SearchAskMode) => void;
}

const OPTIONS: readonly { value: SearchAskMode; label: string }[] = [
  { value: "search", label: "Search" },
  { value: "ask", label: "Ask" },
];

export function AskModeToggle({ mode, onChange }: AskModeToggleProps) {
  return (
    <View className="flex-row gap-2 px-4 pb-2 pt-3">
      {OPTIONS.map(({ value, label }) => {
        const active = mode === value;
        return (
          <Pressable
            key={value}
            testID={`ask-mode-${value}`}
            onPress={() => onChange(value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${label} mode`}
            hitSlop={8}
            className={`min-h-[36px] items-center justify-center rounded-full px-3 py-1 active:opacity-70 ${
              active ? "bg-blue-600" : "bg-neutral-200 dark:bg-neutral-800"
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                active ? "text-white" : "text-black dark:text-white"
              }`}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
