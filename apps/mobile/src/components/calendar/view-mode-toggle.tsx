import { SegmentedControl, type SegmentedOption } from "@/components/ui";

export type CalendarViewMode = "month" | "week" | "agenda";

const MODES: readonly SegmentedOption<CalendarViewMode>[] = [
  { value: "month", label: "Month", accessibilityLabel: "Month view" },
  { value: "week", label: "Week", accessibilityLabel: "Week view" },
  { value: "agenda", label: "Agenda", accessibilityLabel: "Agenda view" },
];

// Extracted from (tabs)/calendar.tsx's previously-inline Month/Week pills when
// Checkpoint 5.4 added a third mode -- two hand-written copies was tolerable,
// three was the point it earned a component. Checkpoint 10.3 made it a
// segmented control on the design system's tokens (segmented-control.tsx);
// the labels, the `selected` state and the "<Mode> view" accessibility
// labels are unchanged.
export function ViewModeToggle({
  value,
  onChange,
}: {
  value: CalendarViewMode;
  onChange: (mode: CalendarViewMode) => void;
}) {
  return <SegmentedControl value={value} options={MODES} onChange={onChange} className="flex-1" />;
}
