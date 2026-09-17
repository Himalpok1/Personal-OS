import type { FocusNowSource } from "@personal-os/core/focus-now/explain";
import type { ChipTone } from "@/components/ui/status-chip";

// The word the client prints for each closed `FocusNowSource` (ADR-075 §1;
// `memory` added by ADR-077 §5), plus the briefing's one extra source,
// `health` (ADR-075 §4). Pure and React-free so the explanation sheet, the
// Focus Now rows and the briefing card all name a source with the same word.

export type BriefingSource = FocusNowSource | "health";

export const FOCUS_NOW_SOURCE_LABEL: Readonly<Record<BriefingSource, string>> = {
  task: "Task",
  reminder: "Reminder",
  project: "Project",
  canvas_assignment: "Canvas assignment",
  course: "Course",
  calendar: "Calendar",
  memory: "Memory",
  health: "Health",
};

/** The chip tone a source wears in the explanation sheet: Canvas-authored evidence reads as info, the owner's own as neutral, a saved memory as primary. */
export const FOCUS_NOW_SOURCE_TONE: Readonly<Record<BriefingSource, ChipTone>> = {
  task: "neutral",
  reminder: "neutral",
  project: "neutral",
  canvas_assignment: "info",
  course: "info",
  calendar: "neutral",
  memory: "primary",
  health: "success",
};

export function focusNowSourceLabel(source: BriefingSource): string {
  return FOCUS_NOW_SOURCE_LABEL[source];
}
