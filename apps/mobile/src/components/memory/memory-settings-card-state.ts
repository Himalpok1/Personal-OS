import type { ChipTone } from "@/components/ui/status-chip";

// Pure presentation for the Settings "Memory" card and the Memory Center's
// switch chip (Checkpoint 10.7, ADR-077 §7). The switch gates USE, not
// storage: the copy says so whenever it is off.

export interface MemorySwitchInput {
  isLoading: boolean;
  isError: boolean;
  enabled: boolean | undefined;
  memoryCount: number | undefined;
}

export interface MemorySwitchPresentation {
  /** The chip beside the title; null while loading. */
  chip: { label: string; tone: ChipTone } | null;
  /** One line under the title. */
  statusText: string;
  /** The reversible toggle's label, or null when there is nothing to toggle yet. */
  toggleLabel: "Turn off" | "Turn on" | null;
}

export function memorySwitchPresentation(input: MemorySwitchInput): MemorySwitchPresentation {
  if (input.isLoading) {
    return { chip: null, statusText: "Loading…", toggleLabel: null };
  }
  if (input.isError || input.enabled === undefined) {
    return {
      chip: { label: "Unknown", tone: "warning" },
      statusText: "Can't reach Personal OS, so the Memory status is unknown.",
      toggleLabel: null,
    };
  }
  const count = input.memoryCount ?? 0;
  const countText = `${count} ${count === 1 ? "memory" : "memories"}`;
  if (input.enabled) {
    return {
      chip: { label: "On", tone: "success" },
      statusText: `On — ${countText}. Focus Now and your briefing use them.`,
      toggleLabel: "Turn off",
    };
  }
  return {
    chip: { label: "Off", tone: "neutral" },
    statusText: `Off — ${countText} kept, not used by Focus Now or your briefing.`,
    toggleLabel: "Turn on",
  };
}

/** The Memory Center's own notice when the switch is off (ADR-077 §7: storage stays). */
export const MEMORY_OFF_NOTICE =
  "Memory is off — Focus Now and your briefing won't use it. Your memories are kept.";
