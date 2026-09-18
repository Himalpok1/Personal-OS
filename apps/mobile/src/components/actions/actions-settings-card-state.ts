import type { ActionsSummary } from "@personal-os/schema";
import type { ChipTone } from "@/components/ui/status-chip";
import { capabilitiesAllowedLine } from "./action-center-state";

// Pure presentation for the Settings "Actions" card (Checkpoint 10.8,
// ADR-078 §8): the chip beside the title and the capabilities caption.

export interface ActionsSettingsInput {
  isLoading: boolean;
  isError: boolean;
  summary: ActionsSummary | undefined;
}

export interface ActionsSettingsPresentation {
  /** The chip beside the title; null while loading. */
  chip: { label: string; tone: ChipTone } | null;
  /** "1 of 2 capabilities allowed", or the honest line when the summary is unknown. */
  capabilitiesLine: string;
}

export function actionsSettingsPresentation(
  input: ActionsSettingsInput,
): ActionsSettingsPresentation {
  if (input.isLoading) {
    return { chip: null, capabilitiesLine: "Loading…" };
  }
  if (input.isError || input.summary === undefined) {
    return {
      chip: { label: "Unknown", tone: "warning" },
      capabilitiesLine: "Can't reach Personal OS, so the action status is unknown.",
    };
  }
  const pending = input.summary.pending_total;
  return {
    chip:
      pending > 0
        ? { label: `${pending} waiting`, tone: "warning" }
        : { label: "Up to date", tone: "success" },
    capabilitiesLine: capabilitiesAllowedLine(input.summary),
  };
}
