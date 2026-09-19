import { ApiClientError } from "@personal-os/api-client";
import {
  AGENT_TRUST_LEVELS,
  AGENT_TRUST_LEVEL_LABELS,
  type Agent,
  type AgentPermission,
  type AgentTrustLevel,
} from "@personal-os/schema";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { AgentPermissionCard } from "@/components/agents/agent-permission-card";
import {
  AGENT_TRUST_CHIP,
  REVOKED_CHIP,
  activityGroupChips,
  activityGroupLine,
  agentLastSeenLabel,
  groupActivityByCorrelation,
  relativeInstantLabel,
  type ActivityGroup,
} from "@/components/agents/agents-state";
import { formatDateLabel } from "@/components/academic/format";
import { confirmDestructive } from "@/components/confirm-destructive";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  ScreenCentered,
  ScreenFrame,
  ScreenHeader,
  SectionHeader,
  SkeletonCard,
  SkeletonList,
  StatusChip,
  showToast,
} from "@/components/ui";
import {
  coerceAgentIdParam,
  useAgent,
  useAgentActivity,
  useAgentPermissions,
  useRevokeAgent,
  useUpdateAgent,
  useUpdateAgentPermission,
} from "@/queries/agents";
import { deviceTimezone } from "@/queries/today";
import { formatShortDateTime } from "@/utils/format-datetime";

// One agent (Checkpoint 10.9, ADR-081 §9): who it is, its trust level as
// three rule-9 buttons, the `agent` principal's permissions (per PRINCIPAL,
// not per agent -- the caption says so), its activity grouped by
// correlation into "Read: … → Proposed: … → Approved" rows that open the
// request in the Action Center, and the danger-zone revoke. Every write is
// device-bound (ADR-082) and every read uses the query's own
// `dataUpdatedAt` for relative time -- no clock read in render (rule 7).

const ACTIVITY_PAGE = 30;

function actionRoute(id: string): Href {
  return `/actions/${encodeURIComponent(id)}` as Href;
}

const TRUST_ORDER: readonly AgentTrustLevel[] = AGENT_TRUST_LEVELS;

function TrustLevelCard({
  agent,
  pendingLevel,
  onChoose,
}: {
  agent: Agent;
  pendingLevel: AgentTrustLevel | null;
  onChoose: (level: AgentTrustLevel) => void;
}) {
  const revoked = agent.revoked_at !== null;
  return (
    <Card className="mt-4" testID="agent-trust-card">
      <AppText variant="title">Trust level</AppText>
      <AppText variant="caption" tone="secondary" className="mt-1">
        {AGENT_TRUST_LEVEL_LABELS[agent.trust_level].description}
      </AppText>
      <View className="mt-3 flex-row flex-wrap gap-2">
        {TRUST_ORDER.map((level) => {
          const current = level === agent.trust_level;
          const label = level === "none" ? "Pause" : AGENT_TRUST_LEVEL_LABELS[level].label;
          return (
            <Button
              key={level}
              label={label}
              onPress={() => onChoose(level)}
              variant={current ? "tonal" : "outline"}
              size="sm"
              disabled={current || revoked}
              busy={pendingLevel === level}
              haptic={false}
              accessibilityLabel={
                current ? `${label}: current trust level` : `Set trust level to ${label}`
              }
              testID={`agent-trust-${level}`}
            />
          );
        })}
      </View>
    </Card>
  );
}

function ActivityRow({
  group,
  now,
  last,
  onPress,
}: {
  group: ActivityGroup;
  now: number;
  last: boolean;
  onPress?: () => void;
}) {
  const line = activityGroupLine(group);
  const chips = activityGroupChips(group);
  const when = relativeInstantLabel(group.at, now, { timeZone: deviceTimezone() });
  return (
    <ListRow
      icon={group.request ? "lightbulb-on-outline" : "eye-outline"}
      iconTone={group.request?.status === "pending" ? "warning" : "neutral"}
      title={line}
      subtitle={when}
      trailingChips={chips}
      chevron={onPress !== undefined}
      onPress={onPress}
      accessibilityLabel={`${line}. ${when}${onPress ? ". Opens the request" : ""}`}
      inset
      last={last}
      testID={`agent-activity-${group.correlation_id}`}
    />
  );
}

export default function AgentDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = coerceAgentIdParam(params.id);
  const agent = useAgent(id);
  const [activityLimit, setActivityLimit] = useState(ACTIVITY_PAGE);
  const activity = useAgentActivity(id, { limit: activityLimit });
  const permissions = useAgentPermissions();
  const updateAgent = useUpdateAgent();
  const updatePermission = useUpdateAgentPermission();
  const revoke = useRevokeAgent();

  if (id === null) {
    return (
      <ScreenCentered>
        <ErrorState title="Not found" message="This agent couldn't be found." />
      </ScreenCentered>
    );
  }

  if (agent.isLoading || (!agent.isError && !agent.data)) {
    return (
      <ScreenFrame>
        <View className="px-4 pt-4">
          <SkeletonCard lines={4} />
        </View>
      </ScreenFrame>
    );
  }

  if (agent.isError || !agent.data) {
    const status = agent.error instanceof ApiClientError ? agent.error.status : null;
    return (
      <ScreenCentered>
        <ErrorState
          title={status === 404 ? "Not found" : "Something went wrong"}
          message={
            status === 404
              ? "This agent couldn't be found."
              : "Couldn't load this agent. Pair this device if you haven't."
          }
          onRetry={status === 404 ? undefined : () => void agent.refetch()}
          retryAccessibilityLabel="Retry loading this agent"
        />
      </ScreenCentered>
    );
  }

  const item = agent.data;
  const revoked = item.revoked_at !== null;
  const trustChip = AGENT_TRUST_CHIP[item.trust_level];
  const timeZone = deviceTimezone();
  const lastSeen = agentLastSeenLabel(item.last_seen_at, agent.dataUpdatedAt, { timeZone });

  const onChooseTrust = (level: AgentTrustLevel) => {
    updateAgent.mutate(
      { id: item.id, body: { trust_level: level } },
      {
        onSuccess: (updated) =>
          showToast({
            message:
              updated.trust_level === "none"
                ? "Agent paused"
                : `Trust level: ${AGENT_TRUST_LEVEL_LABELS[updated.trust_level].label}`,
            tone: "success",
          }),
        onError: () =>
          showToast({ message: "Couldn't change the trust level. Try again.", tone: "danger" }),
      },
    );
  };

  const onTogglePermission = (permission: AgentPermission, label: string, granted: boolean) => {
    updatePermission.mutate(
      { permission, granted },
      {
        onSuccess: (result) => {
          if (granted) {
            showToast({ message: `${label} allowed for agents`, tone: "success" });
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

  const onRevoke = () => {
    confirmDestructive({
      title: `Revoke ${item.name}?`,
      message: "Its token stops working immediately. Its history stays.",
      confirmLabel: "Revoke",
      onConfirm: () =>
        revoke.mutate(item.id, {
          onSuccess: () => showToast({ message: "Agent revoked", tone: "neutral" }),
          onError: () =>
            showToast({ message: "Couldn't revoke that agent. Try again.", tone: "danger" }),
        }),
    });
  };

  const groups = activity.data ? groupActivityByCorrelation(activity.data.items) : [];
  const activityTotal = activity.data?.total ?? 0;
  const activityShown = activity.data?.items.length ?? 0;

  return (
    <Screen refreshing={agent.isRefetching} onRefresh={() => void agent.refetch()}>
      <ScreenHeader variant="compact" title="Agent" />

      <Card
        className="mt-4"
        accessibilityLabel={`${item.name}. ${revoked ? "Revoked. " : ""}Trust level ${trustChip.label}. Registered ${formatDateLabel(item.created_at, { timeZone })}. ${lastSeen}`}
        testID="agent-identity"
      >
        <View className="flex-row items-start justify-between gap-3">
          <AppText variant="headline" className="flex-1" testID="agent-name">
            {item.name}
          </AppText>
          <View className="flex-row flex-wrap justify-end gap-1.5">
            <StatusChip
              label={trustChip.label}
              tone={trustChip.tone}
              icon={trustChip.icon}
              size="md"
            />
            {revoked ? (
              <StatusChip
                label={REVOKED_CHIP.label}
                tone={REVOKED_CHIP.tone}
                icon={REVOKED_CHIP.icon}
                size="md"
              />
            ) : null}
          </View>
        </View>
        <AppText variant="caption" tone="secondary" className="mt-2">
          Registered {formatDateLabel(item.created_at, { timeZone })} · {lastSeen}
        </AppText>
        {revoked ? (
          <AppText variant="caption" tone="muted" className="mt-1" testID="agent-revoked-line">
            Revoked {formatShortDateTime(item.revoked_at as string)}. Its token no longer works; its
            history stays.
          </AppText>
        ) : null}
      </Card>

      <TrustLevelCard
        agent={item}
        pendingLevel={
          updateAgent.isPending ? (updateAgent.variables?.body.trust_level ?? null) : null
        }
        onChoose={onChooseTrust}
      />

      <SectionHeader title="Permissions" icon="shield-key-outline" />
      <AppText
        variant="caption"
        tone="secondary"
        className="mb-3"
        testID="agent-permissions-caption"
      >
        Permissions apply to every agent. Trust level is per agent.
      </AppText>
      {permissions.isLoading ? <SkeletonList rows={2} /> : null}
      {permissions.isError ? (
        <ErrorState
          message="Couldn't load the agent permissions."
          onRetry={() => void permissions.refetch()}
          retryAccessibilityLabel="Retry loading agent permissions"
        />
      ) : null}
      {permissions.data
        ? permissions.data.items.map((grant) => (
            <AgentPermissionCard
              key={grant.permission}
              item={grant}
              onToggle={(granted) => onTogglePermission(grant.permission, grant.label, granted)}
              pending={
                updatePermission.isPending &&
                updatePermission.variables?.permission === grant.permission
              }
              testID={`agent-permission-${grant.permission}`}
            />
          ))
        : null}

      <SectionHeader title="Activity" icon="history" count={activity.data?.total} />
      {activity.isLoading ? <SkeletonList rows={3} /> : null}
      {activity.isError ? (
        <ErrorState
          message="Couldn't load this agent's activity."
          onRetry={() => void activity.refetch()}
          retryAccessibilityLabel="Retry loading agent activity"
        />
      ) : null}
      {activity.data ? (
        groups.length === 0 ? (
          <EmptyState
            size="section"
            icon="history"
            title="No activity yet"
            body="What this agent reads and proposes will appear here."
            testID="agent-activity-empty"
          />
        ) : (
          <>
            <Card padding="none" testID="agent-activity">
              {groups.map((group, index) => (
                <ActivityRow
                  key={group.correlation_id}
                  group={group}
                  now={activity.dataUpdatedAt}
                  last={index === groups.length - 1}
                  onPress={
                    group.request
                      ? () => router.push(actionRoute((group.request as { id: string }).id))
                      : undefined
                  }
                />
              ))}
            </Card>
            {activityTotal > activityShown ? (
              <Button
                label="Load more"
                onPress={() => setActivityLimit((limit) => limit + ACTIVITY_PAGE)}
                variant="outline"
                size="sm"
                haptic={false}
                busy={activity.isFetching}
                className="mt-3"
                accessibilityLabel={`Load more activity, showing ${activityShown} of ${activityTotal}`}
                testID="agent-activity-more"
              />
            ) : null}
          </>
        )
      ) : null}

      {revoked ? null : (
        <Button
          label="Revoke agent"
          onPress={onRevoke}
          busy={revoke.isPending}
          variant="danger"
          icon="robot-off-outline"
          block
          className="mt-6"
          accessibilityLabel={`Revoke ${item.name}`}
          testID="agent-revoke"
        />
      )}
    </Screen>
  );
}
