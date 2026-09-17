import { useRouter, type Href } from "expo-router";
import { View } from "react-native";
import { AppText, Button, Card, Icon, ListRow, StatusChip } from "@/components/ui";
import { useMemorySettings, useUpdateMemorySettings } from "@/queries/memory";
import { MEMORY_PRIVACY_LINE } from "./memory-privacy";
import { memorySwitchPresentation } from "./memory-settings-card-state";

// The Settings card for the Personal Memory layer (Checkpoint 10.7, ADR-077
// §7): status, count, the privacy line, a row into the Memory Center, and
// the global switch as a reversible tonal Button -- no confirmation, because
// the switch gates USE, never storage (turning it off keeps every memory;
// delete-all lives in the Memory Center with its own confirm).
//
// Same shape as components/ask/cloud-ask-card.tsx: its own file, its own
// test, hookless beyond the query/mutation hooks (this app's tree-walking
// tests call the component directly with no dispatcher, so no `useState`),
// and every decision in memory-settings-card-state.ts.

const MEMORY_ROUTE = "/memory" as Href;

export function MemorySettingsCard() {
  const router = useRouter();
  const settings = useMemorySettings();
  const update = useUpdateMemorySettings();
  const view = memorySwitchPresentation({
    isLoading: settings.isLoading,
    isError: settings.isError,
    enabled: settings.data?.enabled,
    memoryCount: settings.data?.memory_count,
  });
  const enabled = settings.data?.enabled ?? false;

  return (
    <Card testID="memory-settings-card" className="mb-4">
      <View className="flex-row items-center gap-2">
        <Icon name="brain" size="md" tone="primary" />
        <AppText variant="title" className="flex-1">
          Memory
        </AppText>
        {view.chip ? (
          <StatusChip
            label={view.chip.label}
            tone={view.chip.tone}
            dot
            accessibilityLabel={`Memory ${view.chip.label}`}
          />
        ) : null}
      </View>
      <AppText
        testID="memory-settings-status"
        variant="body"
        tone={settings.isError ? "danger" : "secondary"}
        className="mt-2 min-h-[20px]"
        accessibilityLiveRegion="polite"
      >
        {view.statusText}
      </AppText>
      <AppText testID="memory-privacy-line" variant="caption" tone="secondary" className="mt-2">
        {MEMORY_PRIVACY_LINE}
      </AppText>

      <Card padding="none" elevation="flat" className="mt-3">
        <ListRow
          testID="memory-settings-open"
          icon="brain"
          iconTone="primary"
          title="Open Memory"
          subtitle="See, edit or delete what Personal OS remembers"
          onPress={() => router.push(MEMORY_ROUTE)}
          accessibilityLabel="Open Memory"
          chevron
          last
        />
      </Card>

      {view.toggleLabel ? (
        <Button
          testID="memory-settings-toggle"
          label={update.isPending ? (enabled ? "Turning off" : "Turning on") : view.toggleLabel}
          onPress={() => update.mutate(!enabled)}
          busy={update.isPending}
          accessibilityLabel={enabled ? "Turn Memory off" : "Turn Memory on"}
          variant="tonal"
          size="sm"
          className="mt-3"
        />
      ) : null}
      {update.isError ? (
        <AppText
          testID="memory-settings-error"
          variant="caption"
          tone="danger"
          className="mt-2"
          accessibilityRole="alert"
        >
          Couldn&apos;t change the Memory switch. Try again.
        </AppText>
      ) : null}
    </Card>
  );
}
