import type { MemoryItem } from "@personal-os/schema";
import { ListRow, SwipeableRow, enterRise, type SwipeAction } from "@/components/ui";
import {
  MEMORY_KIND_PRESENTATION,
  memoryLinkChip,
  memoryRowSpoken,
  memorySourceLine,
} from "./memory-row-state";

// One memory in the Memory Center (Checkpoint 10.7): kind icon disc, the
// statement, the provenance line, at most one linked-name chip, a chevron
// into /memory/[id]. A long press opens the screen's Edit / Delete sheet;
// a swipe (device only -- SwipeableRow renders children alone on web) offers
// Delete, so the long-press sheet is the route every platform shares.
//
// Hookless and prop-driven, so the tree-walking tests can render it: the
// sheet state belongs to the screen, which draws ONE sheet for whichever row
// was held (not one per row).

export interface MemoryRowProps {
  memory: MemoryItem;
  onPress: () => void;
  onLongPress: () => void;
  /** The swipe action's handler; the caller confirms before deleting. */
  onDelete: () => void;
  deleting?: boolean;
  last?: boolean;
  testID?: string;
}

export function MemoryRow({
  memory,
  onPress,
  onLongPress,
  onDelete,
  deleting = false,
  last = false,
  testID,
}: MemoryRowProps) {
  const kind = MEMORY_KIND_PRESENTATION[memory.kind];
  const chip = memoryLinkChip(memory);
  const swipeDelete: SwipeAction[] = deleting
    ? []
    : [
        {
          key: "delete",
          label: "Delete",
          icon: "delete-outline",
          tone: "danger",
          onPress: onDelete,
        },
      ];
  return (
    <SwipeableRow rightActions={swipeDelete}>
      <ListRow
        icon={kind.icon}
        iconTone={kind.tone}
        title={memory.statement}
        subtitle={memorySourceLine(memory)}
        trailingChips={chip ? [chip] : undefined}
        chevron
        onPress={onPress}
        onLongPress={onLongPress}
        entering={enterRise}
        accessibilityLabel={memoryRowSpoken(memory)}
        disabled={deleting}
        last={last}
        testID={testID}
      />
    </SwipeableRow>
  );
}
