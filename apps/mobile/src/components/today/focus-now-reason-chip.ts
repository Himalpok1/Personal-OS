import { FOCUS_NOW_REASON_LABEL } from "@personal-os/core/focus-now/explain";
import type { FocusNowReason } from "@personal-os/core/focus-now/score";
import type { ChipTone } from "@/components/ui/status-chip";

// Chip vocabulary for the Focus Now card (Checkpoint 10.4, ADR-072; the six
// context reasons added by Checkpoint 10.6, ADR-075). Pure, React-free. Maps
// the CLOSED `FocusNowReason` vocabulary onto a word and a StatusChip tone --
// the same words the Academics card already uses
// (`components/academic/urgency-chip.ts`) for the reasons the two share, so
// a row here never disagrees with its origin card about what "Overdue" or
// "Due <24h" means. Every label is core's own `FOCUS_NOW_REASON_LABEL`, so
// the chip on the row and the label in the explanation sheet are one string.

export interface ChipSpec {
  tone: ChipTone;
  label: string;
}

/** The tone per reason; the label is core's, never restated here. */
const REASON_TONE: Readonly<Record<FocusNowReason, ChipTone>> = {
  overdue: "danger",
  due_within_24h: "warning",
  due_this_week: "info",
  marked_missing: "danger",
  marked_late: "warning",
  high_points: "neutral",
  top_priority: "primary",
  // ADR-075 §2: the three point-carrying context reasons read as a nudge
  // (primary / warning), the three informational ones stay quiet.
  linked_assignment: "primary",
  project_stalled: "warning",
  course_attention_high: "warning",
  no_submission: "neutral",
  reminder_set: "neutral",
  snoozed: "info",
};

export const FOCUS_NOW_REASON_CHIP: Readonly<Record<FocusNowReason, ChipSpec>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(REASON_TONE) as FocusNowReason[]).map((reason) => [
      reason,
      { tone: REASON_TONE[reason], label: FOCUS_NOW_REASON_LABEL[reason] },
    ]),
  ) as Record<FocusNowReason, ChipSpec>,
);

/** A row's reasons as chips, in the server/core's own reasons order. */
export function focusNowReasonChips(reasons: readonly FocusNowReason[]): ChipSpec[] {
  return reasons.map((reason) => FOCUS_NOW_REASON_CHIP[reason]);
}
