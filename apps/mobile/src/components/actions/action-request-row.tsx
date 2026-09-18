import type { ActionRequestItem } from "@personal-os/schema";
import { ListRow, SwipeableRow, enterRise, type SwipeAction } from "@/components/ui";
import {
  ACTION_CATEGORY_ICON,
  actionDefinitionFor,
  actionStatusChip,
  riskChip,
} from "./action-approval-sheet-state";
import { openActionApprovalSheet } from "./action-approval-sheet";
import { pendingRowSpoken, pendingRowSubtitle } from "./action-center-state";

// One action request as a list row (Checkpoint 10.8, ADR-078 §8).
//
// A PENDING row: category icon disc, the server's `input_summary`, the
// client-authored reason (else its source), the risk chip, a chevron; a tap
// opens the approval sheet, and on a device a swipe offers Approve / Cancel
// as shortcuts to the same two buttons the sheet draws (a swipe is never
// the only route -- docs/MOBILE-DESIGN-SYSTEM.md → Gestures). The swipe's
// Approve goes through the SAME sheet rather than approving blind: the
// owner reads what will change before anything runs (ADR-078 §6).
//
// A HISTORY row: the same disc and summary, the status chip, a chevron
// into /actions/[id].
//
// Hookless and prop-driven, so the tree-walking tests render it.

export interface PendingActionRowProps {
  item: ActionRequestItem;
  /** The swipe Cancel; the row's Approve always opens the sheet. */
  onCancel?: () => void;
  last?: boolean;
  testID?: string;
}

export function PendingActionRow({ item, onCancel, last = false, testID }: PendingActionRowProps) {
  const definition = actionDefinitionFor(item);
  const open = () => openActionApprovalSheet(item);
  const actions: SwipeAction[] = [
    { key: "approve", label: "Review", icon: "check", tone: "success", onPress: open },
  ];
  if (onCancel) {
    actions.push({
      key: "cancel",
      label: "Cancel",
      icon: "close",
      tone: "neutral",
      onPress: onCancel,
    });
  }
  return (
    <SwipeableRow rightActions={actions}>
      <ListRow
        icon={ACTION_CATEGORY_ICON[definition.category]}
        iconTone={definition.category === "calendar" ? "info" : "primary"}
        title={item.input_summary}
        subtitle={pendingRowSubtitle(item)}
        trailingChips={[riskChip(definition.risk)]}
        chevron
        onPress={open}
        entering={enterRise}
        accessibilityLabel={pendingRowSpoken(item)}
        inset
        last={last}
        testID={testID}
      />
    </SwipeableRow>
  );
}

export interface HistoryActionRowProps {
  item: ActionRequestItem;
  onPress: () => void;
  last?: boolean;
  testID?: string;
}

export function HistoryActionRow({ item, onPress, last = false, testID }: HistoryActionRowProps) {
  const definition = actionDefinitionFor(item);
  const status = actionStatusChip(item.status);
  return (
    <ListRow
      icon={ACTION_CATEGORY_ICON[definition.category]}
      iconTone="neutral"
      title={item.input_summary}
      subtitle={definition.name}
      trailingChips={[status]}
      chevron
      onPress={onPress}
      accessibilityLabel={`${definition.name}: ${item.input_summary}. ${status.label}`}
      inset
      last={last}
      testID={testID}
    />
  );
}
