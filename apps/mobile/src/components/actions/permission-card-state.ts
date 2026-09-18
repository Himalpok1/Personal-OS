import { ACTION_REGISTRY, type PermissionGrantItem } from "@personal-os/schema";
import { formatDateLabel } from "@/components/academic/format";
import type { IconName } from "@/components/ui/icon";
import type { ChipTone } from "@/components/ui/status-chip";
import { ACTION_CATEGORY_ICON } from "./action-approval-sheet-state";

// Pure presentation for one permission card (Checkpoint 10.8, ADR-078 §3/§8):
// the state chip, the usage line, the actions the capability covers and the
// rule-9 toggle's label. A grant answers "may Personal OS REQUEST actions
// that need this?", never "may it run unasked" -- the copy never suggests
// otherwise.

export interface PermissionCardPresentation {
  icon: IconName;
  stateChip: { label: string; tone: ChipTone };
  /** Present only when the live grant predates the current disclosure. */
  reconsentChip: { label: string; tone: ChipTone } | null;
  usageLine: string;
  /** The registry names of the actions this capability gates. */
  actionNames: string[];
  /** "Revoke" when granted, "Allow" otherwise -- the action the button will take. */
  toggleLabel: "Revoke" | "Allow";
  /** What the confirm dialog names when revoking. */
  revokeTitle: string;
  revokeMessage: string;
}

export function permissionUsageLine(
  item: Pick<PermissionGrantItem, "usage_count" | "last_used_at">,
  options: { timeZone?: string } = {},
): string {
  if (item.usage_count === 0 || item.last_used_at === null) return "Not used yet";
  const times = item.usage_count === 1 ? "once" : `${item.usage_count} times`;
  return `Used ${times} · last ${formatDateLabel(item.last_used_at, options)}`;
}

export function permissionCardPresentation(
  item: PermissionGrantItem,
  options: { timeZone?: string } = {},
): PermissionCardPresentation {
  return {
    icon: ACTION_CATEGORY_ICON[item.category],
    stateChip: item.granted
      ? { label: "Allowed", tone: "success" }
      : { label: "Off", tone: "neutral" },
    reconsentChip:
      item.granted && item.needs_reconsent ? { label: "Re-consent needed", tone: "warning" } : null,
    usageLine: permissionUsageLine(item, options),
    actionNames: item.action_ids.map((id) => ACTION_REGISTRY[id].name),
    toggleLabel: item.granted ? "Revoke" : "Allow",
    revokeTitle: `Revoke ${item.label} access?`,
    revokeMessage: `Pending ${item.label} actions will be cancelled.`,
  };
}

/** What a screen reader hears for the whole card. */
export function permissionCardSpoken(
  item: PermissionGrantItem,
  view: PermissionCardPresentation,
): string {
  const reconsent = view.reconsentChip ? `, ${view.reconsentChip.label}` : "";
  return `${item.label}: ${view.stateChip.label}${reconsent}. ${item.description} ${view.usageLine}.`;
}
