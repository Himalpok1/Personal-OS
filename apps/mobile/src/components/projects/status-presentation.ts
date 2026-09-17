import type { ProjectSummaryItem } from "@personal-os/schema";
import type { ChipTone } from "@/components/ui";

// How a project's lifecycle status reads on the Projects tab (Checkpoint
// 10.3): the chip word and its tone. `archived` is not a lifecycle status
// (ADR-039: `archived_at` is an independent axis) but the tab has always
// shown it as the display status of an archived row, so it stays here.

export type ProjectDisplayStatus = ProjectSummaryItem["status"] | "archived";

export interface ProjectStatusPresentation {
  label: string;
  tone: ChipTone;
}

const PRESENTATION: Record<ProjectDisplayStatus, ProjectStatusPresentation> = {
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "neutral" },
  completed: { label: "Completed", tone: "info" },
  archived: { label: "Archived", tone: "neutral" },
};

/** Archived wins over the lifecycle status, exactly as the tab has always read it. */
export function projectDisplayStatus(
  project: Pick<ProjectSummaryItem, "status" | "archived_at">,
): ProjectDisplayStatus {
  return project.archived_at ? "archived" : project.status;
}

export function projectStatusPresentation(status: ProjectDisplayStatus): ProjectStatusPresentation {
  return PRESENTATION[status];
}

/** The "Stalled" flag beside the status: a computed warning, never stored (ADR-039). */
export const PROJECT_STALLED_PRESENTATION: ProjectStatusPresentation = {
  label: "Stalled",
  tone: "warning",
};
