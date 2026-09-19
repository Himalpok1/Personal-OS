import type { Agent } from "@personal-os/schema";
import { useRouter, type Href } from "expo-router";
import { View } from "react-native";
import {
  agentLastSeenLabel,
  agentRowChips,
  agentsHeroGradient,
  agentsHeroHeadline,
  countAgentProposals,
} from "@/components/agents/agents-state";
import { AGENTS_TRUST_LINE } from "@/components/agents/trust-line";
import {
  AnimatedNumber,
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  GradientCard,
  ListRow,
  Screen,
  ScreenCentered,
  ScreenFrame,
  ScreenHeader,
  SkeletonScreen,
  enterRise,
} from "@/components/ui";
import { useActions } from "@/queries/actions";
import { useAgents } from "@/queries/agents";
import { deviceTimezone } from "@/queries/today";

// The Agent Center (Checkpoint 10.9, ADR-081 §9): every agent the owner has
// registered, in one place to register, pause, promote and revoke them, and
// to see what each one read and proposed. Reached from Settings → Privacy &
// AI → Agents, not a tab.
//
// One hero (`warm` while an agent proposal waits, `calm` when nothing does),
// the byte-pinned trust line, then the list. Each row opens /agents/[id];
// "Register agent" opens /agents/new. Loading is a skeleton; an error is an
// error, never the empty state. Every read here is device-bound (ADR-082):
// an unpaired device sees the honest error, not an empty list.
//
// "Proposals waiting" counts the PENDING requests whose `source` is `agent`
// from the same list the Action Center's Pending tab reads. "Reads today"
// would need every agent's activity list, so it is omitted rather than
// invented.

const PENDING_LIMIT = 50;

function agentRoute(id: string): Href {
  return `/agents/${encodeURIComponent(id)}` as Href;
}

const NEW_AGENT_ROUTE = "/agents/new" as Href;

function AgentsHero({
  agentCount,
  pendingProposals,
}: {
  agentCount: number;
  pendingProposals: number;
}) {
  const headline = agentsHeroHeadline(agentCount, pendingProposals);
  const counts = [
    { key: "agents", label: "Agents", value: agentCount },
    { key: "proposals", label: "Proposals waiting", value: pendingProposals },
  ];
  const spoken = counts.map((count) => `${count.value} ${count.label.toLowerCase()}`).join(", ");
  return (
    <GradientCard
      gradient={agentsHeroGradient(pendingProposals)}
      className="mt-4"
      accessibilityLabel={`${headline}. ${spoken}. ${AGENTS_TRUST_LINE}`}
      testID="agents-hero"
    >
      <AppText
        variant="headline"
        tone="on-gradient"
        accessibilityLiveRegion="polite"
        testID="agents-hero-headline"
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
        testID="agents-hero-trust"
      >
        {AGENTS_TRUST_LINE}
      </AppText>
    </GradientCard>
  );
}

function AgentRows({ agents, now }: { agents: readonly Agent[]; now: number }) {
  const router = useRouter();
  const timeZone = deviceTimezone();
  return (
    <Card padding="none" className="mt-4" testID="agents-list">
      {agents.map((agent, index) => {
        const chips = agentRowChips(agent);
        const lastSeen = agentLastSeenLabel(agent.last_seen_at, now, { timeZone });
        return (
          <ListRow
            key={agent.id}
            icon={agent.revoked_at === null ? "robot-outline" : "robot-off-outline"}
            iconTone={agent.revoked_at === null ? "primary" : "neutral"}
            title={agent.name}
            subtitle={lastSeen}
            trailingChips={chips}
            chevron
            onPress={() => router.push(agentRoute(agent.id))}
            entering={enterRise}
            accessibilityLabel={`${agent.name}. ${chips.map((chip) => chip.label).join(", ")}. ${lastSeen}. Opens the agent`}
            inset
            last={index === agents.length - 1}
            testID={`agent-${agent.id}`}
          />
        );
      })}
    </Card>
  );
}

export default function AgentCenterScreen() {
  const router = useRouter();
  const agents = useAgents();
  const pending = useActions({ status: "pending", limit: PENDING_LIMIT });

  if (agents.isLoading) {
    return (
      <ScreenFrame>
        <SkeletonScreen />
      </ScreenFrame>
    );
  }

  if (agents.isError || !agents.data) {
    // Never the empty state: with no list we know nothing about what is
    // registered, and "no agents yet" would be a lie. An unpaired device
    // lands here too (the query is disabled without a token).
    return (
      <ScreenCentered>
        <ErrorState
          size="screen"
          message="Couldn't load your agents. Pair this device if you haven't."
          onRetry={() => void agents.refetch()}
          retryLabel="Retry"
          retryAccessibilityLabel="Retry loading agents"
        />
      </ScreenCentered>
    );
  }

  const items = agents.data.items;
  const live = items.filter((agent) => agent.revoked_at === null);
  const pendingProposals = pending.data ? countAgentProposals(pending.data.items) : 0;
  const goToNew = () => router.push(NEW_AGENT_ROUTE);

  return (
    <Screen refreshing={agents.isRefetching} onRefresh={() => void agents.refetch()}>
      {/* The navigator bar already says "Agents"; the hero carries the count. */}
      <ScreenHeader variant="compact" title="Agents" />
      <AgentsHero agentCount={live.length} pendingProposals={pendingProposals} />

      {items.length === 0 ? (
        <EmptyState
          size="section"
          icon="robot-outline"
          title="No agents yet"
          body="An agent you register can read what you allow — today, your calendar, your tasks — and propose actions you approve here."
          action={{
            label: "Register an agent",
            onPress: goToNew,
            accessibilityLabel: "Register an agent",
          }}
          className="mt-4"
          testID="agents-empty"
        />
      ) : (
        <AgentRows agents={items} now={agents.dataUpdatedAt} />
      )}

      <Button
        label="Register agent"
        onPress={goToNew}
        variant="primary"
        icon="plus"
        haptic={false}
        block
        className="mt-4"
        testID="agents-register"
      />
    </Screen>
  );
}
