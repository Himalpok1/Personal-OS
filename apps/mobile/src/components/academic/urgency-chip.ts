import type { AcademicCourseStatus, AcademicUrgency } from "@personal-os/schema";
import type { ChipTone } from "@/components/ui/status-chip";
import type { SubmissionBadgeTone } from "./format";

// Chip vocabulary for the academic surfaces (Checkpoint 10.3). Pure and
// React-free. Every function here maps a CLOSED server (or format.ts)
// vocabulary to a StatusChip tone and a word; none derives a fact.

export interface ChipSpec {
  tone: ChipTone;
  label: string;
}

/**
 * The urgency ladder as a chip:
 *   critical → danger  "Overdue"     (due_at < effective_now)
 *   high     → warning "Due <24h"
 *   medium   → info    "This week"
 *   low      → neutral "Later"
 */
export function urgencyChip(urgency: AcademicUrgency): ChipSpec {
  switch (urgency) {
    case "critical":
      return { tone: "danger", label: "Overdue" };
    case "high":
      return { tone: "warning", label: "Due <24h" };
    case "medium":
      return { tone: "info", label: "This week" };
    case "low":
      return { tone: "neutral", label: "Later" };
  }
}

/** format.ts's badge tones (pre-design-system names) onto the StatusChip tones. */
export function badgeChipTone(tone: SubmissionBadgeTone): ChipTone {
  switch (tone) {
    case "red":
      return "danger";
    case "amber":
      return "warning";
    case "green":
      return "success";
    case "neutral":
      return "neutral";
  }
}

/** A course's lifecycle as a chip; `active` is the default reading and gets no chip at all. */
export function courseStatusChip(status: AcademicCourseStatus): ChipSpec | null {
  switch (status) {
    case "active":
      return null;
    case "completed":
      return { tone: "info", label: "Completed" };
    case "archived":
      return { tone: "neutral", label: "Archived" };
  }
}
