import type {
  ActionPermission,
  ActionRequestItem,
  ActionsSummary,
  Agent,
} from "@personal-os/schema";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  ACTION_TABS,
  actionsHeroCounts,
  actionsHeroGradient,
  actionsHeroHeadline,
  coerceActionTabParam,
  groupHistoryByDay,
  historyItems,
  type ActionTab,
} from "@/components/actions/action-center-state";
import { HistoryActionRow, PendingActionRow } from "@/components/actions/action-request-row";
import { PermissionCard } from "@/components/actions/permission-card";
import { ACTIONS_TRUST_LINE } from "@/components/actions/trust-line";
import {
  AnimatedNumber,
  AppText,
  Card,
  EmptyState,
  ErrorState,
  GradientCard,
  Screen,
  ScreenCentered,
  ScreenFrame,
  ScreenHeader,
  SegmentedControl,
  SkeletonList,
  SkeletonScreen,
  showToast,
} from "@/components/ui";
import {
  useActions,
  useActionsSummary,
  useCancelAction,
  usePermissions,
  useUpdatePermission,
} from "@/queries/actions";
import { useAgents } from "@/queries/agents";
import { deviceTimezone } from "@/queries/today";

// The Action Center (Checkpoint 10.8, ADR-078 §8): every action request
// Personal OS has proposed, in one place the owner can approve, cancel,
// review and undo -- and the permissions that gate what may be proposed at
// all. Reached from Settings → Privacy & AI → Actions, and from the Today
// card's "See all"; not a tab.
//
// One hero (`warm` while something waits, `calm` when nothing does -- the
// first consumers of the two presets held since 10.3), the byte-pinned
// trust line, then three tabs. Pending rows open the ONE root-mounted
// approval sheet; history rows open /actions/[id]; permission cards carry
// the rule-9 toggle. Loading is a skeleton; an error is an error, never the
// empty state.
//
// Checkpoint 10.9 (ADR-081 §9): the screen reads the agent list once and
// hands it to the rows, so a request an agent proposed names that agent in
// its subtitle. The list is optional to every row -- a missing list means a
// plain "Agent" word, never a blank row.

const PAGE_LIMIT = 50;

const TAB_OPTIONS: readonly { value: ActionTab; label: string; testID: string }[] = [
  { value: "pending", label: "Pending", testID: "actions-tab-pending" },
  { value: "history", label: "History", testID: "actions-tab-history" },
  { value: "permissions", label: "Permissions", testID: "actions-tab-permissions" },
];

function actionRoute(id: string): Href {
  return `/actions/${encodeURIComponent(id)}` as Href;
}

function ActionsHero({ summary }: { summary: ActionsSummary }) {
  const headline = actionsHeroHeadline(summary.pending_total);
  const counts = actionsHeroCounts(summary);
  const spoken = counts.map((count) => `${count.value} ${count.label.toLowerCase()}`).join(", ");
  return (
    <GradientCard
      gradient={actionsHeroGradient(summary.pending_total)}
      className="mt-4"
      accessibilityLabel={`${headline}. ${spoken}. ${ACTIONS_TRUST_LINE}`}
      testID="actions-hero"
    >
      <AppText
        variant="headline"
        tone="on-gradient"
        accessibilityLiveRegion="polite"
        testID="actions-hero-headline"
      >
        {headline}
      </AppText>
      <View className="mt-4 flex-row gap-5">
        {counts.map((count) => (
          <View key={count.key}>
            <AnimatedNumber value={count.value} variant="display" tone="on-gradient" />
            <AppText variant="caption" tone="on-gradient-muted">
              {count.label}
            </AppText>
          </View>
        ))}
      </View>
      <AppText
        variant="caption"
        tone="on-gradient-muted"
        className="mt-4"
        testID="actions-hero-trust"
      >
        {ACTIONS_TRUST_LINE}
      </AppText>
    </GradientCard>
  );
}

type AgentList = readonly Pick<Agent, "id" | "name" | "revoked_at">[] | undefined;

function PendingTab({
  onCancel,
  agents,
}: {
  onCancel: (item: ActionRequestItem) => void;
  agents: AgentList;
}) {
  const pending = useActions({ status: "pending", limit: PAGE_LIMIT });
  if (pending.isLoading) return <SkeletonList rows={3} className="mt-4" />;
  if (pending.isError || !pending.data) {
    return (
      <ErrorState
        message="Couldn't load pending actions."
        onRetry={() => void pending.refetch()}
        retryAccessibilityLabel="Retry loading pending actions"
        className="mt-4"
      />
    );
  }
  const { items, total } = pending.data;
  if (items.length === 0) {
    return (
      <EmptyState
        size="section"
        tone="success"
        icon="check-decagram-outline"
        title="All caught up"
        body="Nothing is waiting for your approval."
        className="mt-4"
        testID="actions-pending-empty"
      />
    );
  }
  return (
    <>
      <Card padding="none" className="mt-4" testID="actions-pending-list">
        {items.map((item, index) => (
          <PendingActionRow
            key={item.id}
            item={item}
            agents={agents}
            onCancel={() => onCancel(item)}
            last={index === items.length - 1}
            testID={`pending-action-${item.id}`}
          />
        ))}
      </Card>
      {total > items.length ? (
        <AppText variant="caption" tone="muted" className="mt-2">
          Showing {items.length} of {total}
        </AppText>
      ) : null}
    </>
  );
}

function HistoryTab({ agents }: { agents: AgentList }) {
  const router = useRouter();
  const list = useActions({ limit: PAGE_LIMIT });
  if (list.isLoading) return <SkeletonList rows={4} className="mt-4" />;
  if (list.isError || !list.data) {
    return (
      <ErrorState
        message="Couldn't load your action history."
        onRetry={() => void list.refetch()}
        retryAccessibilityLabel="Retry loading action history"
        className="mt-4"
      />
    );
  }
  const items = historyItems(list.data.items);
  if (items.length === 0) {
    return (
      <EmptyState
        size="section"
        icon="history"
        title="No history yet"
        body="Approved, cancelled and expired actions will appear here."
        className="mt-4"
        testID="actions-history-empty"
      />
    );
  }
  const groups = groupHistoryByDay(items, { timeZone: deviceTimezone(), now: list.dataUpdatedAt });
  return (
    <>
      {groups.map((group) => (
        <View key={group.date}>
          <AppText variant="overline" tone="muted" className="pb-2 pt-4">
            {group.label}
          </AppText>
          <Card padding="none">
            {group.items.map((item, index) => (
              <HistoryActionRow
                key={item.id}
                item={item}
                agents={agents}
                onPress={() => router.push(actionRoute(item.id))}
                last={index === group.items.length - 1}
                testID={`history-action-${item.id}`}
              />
            ))}
          </Card>
        </View>
      ))}
    </>
  );
}

function PermissionsTab() {
  const permissions = usePermissions();
  const update = useUpdatePermission();
  if (permissions.isLoading) return <SkeletonList rows={2} className="mt-4" />;
  if (permissions.isError || !permissions.data) {
    return (
      <ErrorState
        message="Couldn't load your permissions."
        onRetry={() => void permissions.refetch()}
        retryAccessibilityLabel="Retry loading permissions"
        className="mt-4"
      />
    );
  }
  const onToggle = (permission: ActionPermission, label: string, granted: boolean) => {
    update.mutate(
      { permission, granted },
      {
        onSuccess: (result) => {
          if (granted) {
            showToast({ message: `${label} allowed`, tone: "success" });
            return;
          }
          const cancelled = result.cancelled_pending;
          showToast({
            message:
              cancelled > 0
                ? `${label} revoked · ${cancelled} pending ${cancelled === 1 ? "action" : "actions"} cancelled`
                : `${label} revoked`,
            tone: "neutral",
          });
        },
        onError: () =>
          showToast({ message: `Couldn't change ${label}. Try again.`, tone: "danger" }),
      },
    );
  };
  return (
    <View className="mt-4">
      {permissions.data.items.map((item) => (
        <PermissionCard
          key={item.permission}
          item={item}
          onToggle={(granted) => onToggle(item.permission, item.label, granted)}
          pending={update.isPending && update.variables?.permission === item.permission}
          testID={`permission-${item.permission}`}
        />
      ))}
    </View>
  );
}

export default function ActionCenterScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<ActionTab>(() => coerceActionTabParam(params.tab));
  const summary = useActionsSummary();
  const cancel = useCancelAction();
  // Read once here, never per row: an unpaired device has no list and the
  // rows fall back to the plain source word.
  const agents = useAgents();

  if (summary.isLoading) {
    return (
      <ScreenFrame>
        <SkeletonScreen />
      </ScreenFrame>
    );
  }

  if (summary.isError || !summary.data) {
    // Never the empty state: when the API is unreachable we know nothing
    // about what is waiting, and "nothing waiting" would be a lie.
    return (
      <ScreenCentered>
        <ErrorState
          size="screen"
          message="Couldn't load your actions."
          onRetry={() => void summary.refetch()}
          retryLabel="Retry"
          retryAccessibilityLabel="Retry loading actions"
        />
      </ScreenCentered>
    );
  }

  const onCancel = (item: ActionRequestItem) => {
    cancel.mutate(item.id, {
      onSuccess: () => showToast({ message: "Cancelled", tone: "neutral" }),
      onError: () => showToast({ message: "Couldn't cancel that. Try again.", tone: "danger" }),
    });
  };

  return (
    <Screen refreshing={summary.isRefetching} onRefresh={() => void summary.refetch()}>
      {/* The navigator bar already says "Actions"; the hero carries the count. */}
      <ScreenHeader variant="compact" title="Actions" />
      <ActionsHero summary={summary.data} />

      <SegmentedControl
        value={tab}
        options={TAB_OPTIONS}
        onChange={(next) => {
          if ((ACTION_TABS as readonly string[]).includes(next)) setTab(next);
        }}
        className="mt-4"
      />

      {tab === "pending" ? <PendingTab onCancel={onCancel} agents={agents.data?.items} /> : null}
      {tab === "history" ? <HistoryTab agents={agents.data?.items} /> : null}
      {tab === "permissions" ? <PermissionsTab /> : null}
    </Screen>
  );
}
