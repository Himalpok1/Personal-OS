import type { Agent } from "@personal-os/schema";
import type { ChipTone } from "@/components/ui/status-chip";

// Pure presentation for the Settings "Agents" card (Checkpoint 10.9,
// ADR-081 §9): the chip beside the title. Revoked agents are not counted --
// the chip answers "how many agents can act", not "how many rows exist".

export interface AgentsSettingsInput {
  isLoading: boolean;
  isError: boolean;
  items: readonly Pick<Agent, "revoked_at">[] | undefined;
}

export interface AgentsSettingsPresentation {
  /** The chip beside the title; null while loading. */
  chip: { label: string; tone: ChipTone } | null;
}

export function liveAgentCount(items: readonly Pick<Agent, "revoked_at">[]): number {
  return items.filter((agent) => agent.revoked_at === null).length;
}

export function agentsSettingsPresentation(input: AgentsSettingsInput): AgentsSettingsPresentation {
  if (input.isLoading) return { chip: null };
  if (input.isError || input.items === undefined) {
    return { chip: { label: "Unknown", tone: "warning" } };
  }
  const live = liveAgentCount(input.items);
  return {
    chip:
      live > 0
        ? { label: `${live} registered`, tone: "info" }
        : { label: "None yet", tone: "neutral" },
  };
}
