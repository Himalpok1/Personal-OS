import type { FocusNowReason } from "@personal-os/core/focus-now/score";
import type { ChipTone } from "@/components/ui/status-chip";

// Chip vocabulary for the Focus Now card (Checkpoint 10.4, ADR-072). Pure,
// React-free. Maps the CLOSED `FocusNowReason` vocabulary onto a word and a
// StatusChip tone -- the same words the Academics card already uses
// (`components/academic/urgency-chip.ts`) for the reasons the two share, so
// a row here never disagrees with its origin card about what "Overdue" or
// "Due <24h" means.

export interface ChipSpec {
  tone: ChipTone;
  label: string;
}

export const FOCUS_NOW_REASON_CHIP: Readonly<Record<FocusNowReason, ChipSpec>> = {
  overdue: { tone: "danger", label: "Overdue" },
  due_within_24h: { tone: "warning", label: "Due <24h" },
  due_this_week: { tone: "info", label: "This week" },
  marked_missing: { tone: "danger", label: "Missing" },
  marked_late: { tone: "warning", label: "Late" },
  high_points: { tone: "neutral", label: "High points" },
  top_priority: { tone: "primary", label: "P1" },
};

/** A row's reasons as chips, in the server/core's own reasons order. */
export function focusNowReasonChips(reasons: readonly FocusNowReason[]): ChipSpec[] {
  return reasons.map((reason) => FOCUS_NOW_REASON_CHIP[reason]);
}
