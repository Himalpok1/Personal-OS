import { useRouter, type Href } from "expo-router";
import { PendingActionRow } from "@/components/actions/action-request-row";
import { AppText, Card, SectionHeader } from "@/components/ui";
import { useActions } from "@/queries/actions";

// The "Needs your approval" card on Today (Checkpoint 10.8, ADR-078 §8):
// rendered ONLY when something is pending, between the reminder notice and
// Focus Now (pinned in src/__tests__/today-screen-order.test.ts).
//
// Owns its own query, like the Academics and Health cards, and follows the
// ReminderNoticeCard posture: NOTHING (not an empty state, not a skeleton)
// while loading, on an error, or when nothing is waiting -- an approval
// prompt that appears on the busiest screen in the app is a prompt only
// when there is something to approve. A plain `Card`, not a gradient: Today
// draws one gradient (the briefing) and this card must never compete with
// it. Each row opens the ONE root-mounted approval sheet.

const ACTIONS_ROUTE = "/actions" as Href;

/** How many pending rows the card draws before "+N more". */
export const TODAY_PENDING_ROWS = 2;

export function ActionsNeedsApprovalCard() {
  const router = useRouter();
  const pending = useActions({ status: "pending", limit: TODAY_PENDING_ROWS + 1 });
  const data = pending.data;
  if (pending.isLoading || pending.isError || data === undefined) return null;
  if (data.total === 0 || data.items.length === 0) return null;

  const shown = data.items.slice(0, TODAY_PENDING_ROWS);
  const more = data.total - shown.length;
  return (
    <Card padding="none" className="mb-3" testID="actions-needs-approval-card">
      <SectionHeader
        title="Needs your approval"
        count={data.total}
        icon="shield-check"
        tone="warning"
        spacing="card"
        className="px-4 pt-3"
        action={{
          label: "See all",
          onPress: () => router.push(ACTIONS_ROUTE),
          accessibilityLabel: "See all pending actions",
        }}
      />
      {shown.map((item, index) => (
        <PendingActionRow
          key={item.id}
          item={item}
          last={index === shown.length - 1 && more <= 0}
          testID={`today-pending-action-${item.id}`}
        />
      ))}
      {more > 0 ? (
        <AppText
          variant="caption"
          tone="muted"
          className="px-4 py-2.5"
          testID="actions-needs-approval-more"
        >
          +{more} more
        </AppText>
      ) : null}
    </Card>
  );
}
