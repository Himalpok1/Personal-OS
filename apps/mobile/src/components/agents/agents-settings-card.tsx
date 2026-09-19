import { useRouter, type Href } from "expo-router";
import { View } from "react-native";
import { AppText, Card, Icon, ListRow, StatusChip } from "@/components/ui";
import { useAgents } from "@/queries/agents";
import { agentsSettingsPresentation } from "./agents-settings-card-state";
import { AGENTS_TRUST_LINE } from "./trust-line";

// The Settings card for the Agent Gateway (Checkpoint 10.9, ADR-081 §9):
// how many agents are registered, the trust line, and a row into the Agent
// Center. It changes nothing itself -- every register, pause, revoke and
// grant lives in the Agent Center -- so it carries no button beyond the row.
//
// Same shape as components/actions/actions-settings-card.tsx: its own file,
// its own test, hookless beyond the one query hook (the tree-walking tests
// call it directly with no dispatcher), and every decision in
// agents-settings-card-state.ts. It sits AFTER the Actions card in Privacy &
// AI because agents are the principals that use actions.

const AGENTS_ROUTE = "/agents" as Href;

export function AgentsSettingsCard() {
  const router = useRouter();
  const agents = useAgents();
  const view = agentsSettingsPresentation({
    isLoading: agents.isLoading,
    isError: agents.isError,
    items: agents.data?.items,
  });

  return (
    <Card testID="agents-settings-card" className="mb-4">
      <View className="flex-row items-center gap-2">
        <Icon name="robot-outline" size="md" tone="primary" />
        <AppText variant="title" className="flex-1">
          Agents
        </AppText>
        {view.chip ? (
          <StatusChip
            label={view.chip.label}
            tone={view.chip.tone}
            dot
            accessibilityLabel={`Agents ${view.chip.label}`}
          />
        ) : null}
      </View>
      <AppText testID="agents-trust-line" variant="caption" tone="secondary" className="mt-2">
        {AGENTS_TRUST_LINE}
      </AppText>

      <Card padding="none" elevation="flat" className="mt-3">
        <ListRow
          testID="agents-settings-open"
          icon="robot-outline"
          iconTone="primary"
          title="Open Agent Center"
          subtitle="Register, pause or revoke agents; allow or revoke what they may read and propose"
          onPress={() => router.push(AGENTS_ROUTE)}
          accessibilityLabel="Open Agent Center"
          chevron
          last
        />
      </Card>
    </Card>
  );
}
