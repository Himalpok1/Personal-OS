import type { AcademicWorkload, AcademicWorkloadStatus } from "@personal-os/schema";
import type { ChipTone } from "@/components/ui/status-chip";
import { pluralize } from "./format";

// The workload status line on the Academics card (Checkpoint 10.3). Pure and
// React-free: `status` is the SERVER's derivation (core's
// `deriveWorkloadStatus`: behind ⟺ overdue ∨ missing; at_risk ⟺ due within
// 24h; else on_track) and is never re-derived here -- this module only
// chooses a tone, a word and an explanation built from the counts the same
// object reports, so the reader can see WHY the status was assigned.

export interface WorkloadChip {
  tone: ChipTone;
  label: string;
  /** The counts behind the status, e.g. "2 overdue · 1 missing"; null when there is nothing to say. */
  detail: string | null;
}

const LABEL: Record<AcademicWorkloadStatus, { tone: ChipTone; label: string }> = {
  behind: { tone: "danger", label: "Behind" },
  at_risk: { tone: "warning", label: "At risk" },
  on_track: { tone: "success", label: "On track" },
};

function joinCounts(parts: (string | null)[]): string | null {
  const kept = parts.filter((part): part is string => part !== null);
  return kept.length === 0 ? null : kept.join(" · ");
}

/**
 *   behind   → "Behind"   · "2 overdue · 1 missing" (whichever are > 0)
 *   at_risk  → "At risk"  · "1 due in 24h"
 *   on_track → "On track" · "3 due this week" / "2 open" / null
 */
export function workloadChip(workload: AcademicWorkload): WorkloadChip {
  const { tone, label } = LABEL[workload.status];
  switch (workload.status) {
    case "behind":
      return {
        tone,
        label,
        detail: joinCounts([
          workload.overdue_total > 0 ? `${workload.overdue_total} overdue` : null,
          workload.missing_total > 0 ? `${workload.missing_total} missing` : null,
        ]),
      };
    case "at_risk":
      return {
        tone,
        label,
        detail:
          workload.due_within_24h_total > 0 ? `${workload.due_within_24h_total} due in 24h` : null,
      };
    case "on_track":
      return {
        tone,
        label,
        detail:
          workload.due_this_week_total > 0
            ? `${workload.due_this_week_total} due this week`
            : workload.open_total > 0
              ? pluralize(workload.open_total, "open assignment")
              : null,
      };
  }
}

/** The card must show a status the owner should act on even when every section is empty. */
export function workloadNeedsAttention(status: AcademicWorkloadStatus): boolean {
  return status === "behind" || status === "at_risk";
}
