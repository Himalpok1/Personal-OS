import { useRouter, type Href } from "expo-router";
import { View } from "react-native";
import { AppText, Card, Icon, ListRow, StatusChip } from "@/components/ui";
import { useActionsSummary } from "@/queries/actions";
import { actionsSettingsPresentation } from "./actions-settings-card-state";
import { ACTIONS_TRUST_LINE } from "./trust-line";

// The Settings card for the Action Framework (Checkpoint 10.8, ADR-078 §8):
// how many requests are waiting, the trust line, a row into the Action
// Center, and how many capabilities are allowed. It changes nothing itself
// -- every approve, cancel, allow and revoke lives in the Action Center --
// so it carries no button beyond the row.
//
// Same shape as components/memory/memory-settings-card.tsx: its own file,
// its own test, hookless beyond the query hook (the tree-walking tests call
// it directly with no dispatcher), and every decision in
// actions-settings-card-state.ts.

const ACTIONS_ROUTE = "/actions" as Href;

export function ActionsSettingsCard() {
  const router = useRouter();
  const summary = useActionsSummary();
  const view = actionsSettingsPresentation({
    isLoading: summary.isLoading,
    isError: summary.isError,
    summary: summary.data,
  });

  return (
    <Card testID="actions-settings-card" className="mb-4">
      <View className="flex-row items-center gap-2">
        <Icon name="shield-check" size="md" tone="primary" />
        <AppText variant="title" className="flex-1">
          Actions
        </AppText>
        {view.chip ? (
          <StatusChip
            label={view.chip.label}
            tone={view.chip.tone}
            dot
            accessibilityLabel={`Actions ${view.chip.label}`}
          />
        ) : null}
      </View>
      <AppText testID="actions-trust-line" variant="caption" tone="secondary" className="mt-2">
        {ACTIONS_TRUST_LINE}
      </AppText>

      <Card padding="none" elevation="flat" className="mt-3">
        <ListRow
          testID="actions-settings-open"
          icon="shield-check"
          iconTone="primary"
          title="Open Action Center"
          subtitle="Approve, cancel or undo actions; allow or revoke what Personal OS may ask for"
          onPress={() => router.push(ACTIONS_ROUTE)}
          accessibilityLabel="Open Action Center"
          chevron
          last
        />
      </Card>

      <AppText
        testID="actions-settings-capabilities"
        variant="caption"
        tone={summary.isError ? "danger" : "muted"}
        className="mt-2"
        accessibilityLiveRegion="polite"
      >
        {view.capabilitiesLine}
      </AppText>
    </Card>
  );
}
