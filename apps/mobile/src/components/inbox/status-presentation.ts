import type { InboxItem } from "@personal-os/schema";
import type { ChipTone, IconName } from "@/components/ui";

// How an inbox status reads (Checkpoint 10.3): the label the row and the
// detail screen have shown since Phase 2 (unchanged), plus the icon and the
// chip/disc tone the design system draws it with. A pure table so the
// mapping is pinned by a test rather than spread across two screens.

export type InboxStatus = InboxItem["status"];

export interface InboxStatusPresentation {
  label: string;
  icon: IconName;
  tone: ChipTone;
}

const PRESENTATION: Record<InboxStatus, InboxStatusPresentation> = {
  pending: { label: "Parsing...", icon: "progress-clock", tone: "neutral" },
  parsed: { label: "Parsed", icon: "check-circle-outline", tone: "success" },
  needs_confirm: { label: "Needs confirmation", icon: "help-circle-outline", tone: "warning" },
  confirmed: { label: "Confirmed", icon: "check-circle-outline", tone: "success" },
  failed: { label: "Failed", icon: "alert-circle-outline", tone: "danger" },
};

export function inboxStatusPresentation(status: InboxStatus): InboxStatusPresentation {
  return PRESENTATION[status];
}
