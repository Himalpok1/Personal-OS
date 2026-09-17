import { View } from "react-native";
import { SegmentedControl, type SegmentedOption } from "@/components/calendar/segmented-control";

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
// Checkpoint 10.3 made it the same segmented control the calendar's view
// toggle uses; the testIDs, labels and `selected` state are unchanged.

export type SearchAskMode = "search" | "ask";

export interface AskModeToggleProps {
  mode: SearchAskMode;
  onChange: (mode: SearchAskMode) => void;
}

const OPTIONS: readonly SegmentedOption<SearchAskMode>[] = [
  {
    value: "search",
    label: "Search",
    accessibilityLabel: "Search mode",
    testID: "ask-mode-search",
  },
  { value: "ask", label: "Ask", accessibilityLabel: "Ask mode", testID: "ask-mode-ask" },
];

export function AskModeToggle({ mode, onChange }: AskModeToggleProps) {
  return (
    <View className="px-4 pb-2 pt-3">
      <SegmentedControl value={mode} options={OPTIONS} onChange={onChange} />
    </View>
  );
}
