import type { MemoryItem, MemorySuggestion } from "@personal-os/schema";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ChoiceChip } from "@/components/ask/choice-chip";
import { confirmDestructive } from "@/components/confirm-destructive";
import { memoryExportUrl } from "@/components/memory/memory-form-state";
import { MEMORY_PRIVACY_LINE } from "@/components/memory/memory-privacy";
import { MemoryRow } from "@/components/memory/memory-row";
import {
  MEMORY_KIND_PRESENTATION,
  groupMemoriesByKind,
  memoryHeroHeadline,
  memoryKindCounts,
} from "@/components/memory/memory-row-state";
import {
  MEMORY_OFF_NOTICE,
  memorySwitchPresentation,
} from "@/components/memory/memory-settings-card-state";
import {
  MEMORY_STARTERS,
  memoryNewHref,
  memoryStarterHref,
} from "@/components/memory/memory-starters";
import {
  AppText,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ErrorState,
  GradientCard,
  Screen,
  ScreenCentered,
  ScreenFrame,
  ScreenHeader,
  SectionHeader,
  SheetRow,
  SkeletonScreen,
  StatusChip,
  showToast,
  type ChipTone,
} from "@/components/ui";
import { API_BASE_URL } from "@/queries/client";
import {
  MEMORIES_FOR_INTELLIGENCE_LIMIT,
  useDecideMemorySuggestion,
  useDeleteAllMemories,
  useDeleteMemory,
  useMemories,
  useMemorySettings,
  useMemorySuggestions,
  useUpdateMemorySettings,
} from "@/queries/memory";

// The Memory Center (Checkpoint 10.7, ADR-077): everything Personal OS
// remembers, in one place the owner can read, edit, delete and switch off.
// Reached from Settings → Privacy & AI → Memory, not a tab.
//
// One hero (the first consumer of the `soft` gradient: a quiet tinted panel
// under ordinary on-surface tones, not a white-text hero), the off notice
// when the switch is off, at most ONE suggestion card (ADR-077 §4: never a
// recurring Today card), a section per kind, an export pointer and delete-
// all. Loading is a skeleton; an error is an error, never the empty state.
//
// Every row's long press opens ONE sheet for the whole screen (Edit /
// Delete) -- the tap path a swipe merely shortcuts on a device.

const MEMORY_LIST_LIMIT = MEMORIES_FOR_INTELLIGENCE_LIMIT;

function memoryRoute(id: string): Href {
  return `/memory/${encodeURIComponent(id)}` as Href;
}

function MemoryHero({
  total,
  items,
  chip,
}: {
  total: number;
  items: readonly MemoryItem[];
  chip: { label: string; tone: ChipTone } | null;
}) {
  const counts = memoryKindCounts(items);
  const spokenCounts = counts
    .map(({ kind, count }) => `${count} ${MEMORY_KIND_PRESENTATION[kind].plural.toLowerCase()}`)
    .join(", ");
  return (
    <GradientCard
      gradient="soft"
      className="mt-4"
      accessibilityLabel={`${memoryHeroHeadline(total)}. ${spokenCounts}. ${MEMORY_PRIVACY_LINE}`}
    >
      <View className="flex-row items-start justify-between gap-3">
        <AppText
          variant="headline"
          className="flex-1"
          accessibilityLiveRegion="polite"
          testID="memory-hero-headline"
        >
          {memoryHeroHeadline(total)}
        </AppText>
        {chip ? (
          <StatusChip
            label={chip.label}
            tone={chip.tone}
            dot
            accessibilityLabel={`Memory ${chip.label}`}
          />
        ) : null}
      </View>
      <View className="mt-4 flex-row gap-5">
        {counts.map(({ kind, count }) => (
          <View key={kind}>
            <AppText variant="display">{String(count)}</AppText>
            <AppText variant="caption" tone="secondary">
              {MEMORY_KIND_PRESENTATION[kind].plural}
            </AppText>
          </View>
        ))}
      </View>
      <AppText variant="caption" tone="secondary" className="mt-4" testID="memory-hero-privacy">
        {MEMORY_PRIVACY_LINE}
      </AppText>
    </GradientCard>
  );
}

function SuggestionCard({
  suggestion,
  onDecide,
  pending,
  error,
}: {
  suggestion: MemorySuggestion;
  onDecide: (decision: "remember" | "not_now" | "never") => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <Card className="mt-4" testID="memory-suggestion-card">
      <SectionHeader title="Suggested" icon="lightbulb-outline" spacing="none" className="pb-2" />
      <AppText variant="body-strong">{suggestion.statement}</AppText>
      <AppText variant="caption" tone="secondary" className="mt-1">
        {suggestion.evidence}
      </AppText>
      <View className="mt-3 flex-row flex-wrap gap-2">
        <Button
          label="Remember"
          onPress={() => onDecide("remember")}
          busy={pending}
          variant="primary"
          size="sm"
          icon="check"
        />
        <Button
          label="Not now"
          onPress={() => onDecide("not_now")}
          disabled={pending}
          variant="tonal"
          size="sm"
        />
        <Button
          label="Never"
          onPress={() => onDecide("never")}
          disabled={pending}
          variant="outline"
          size="sm"
          accessibilityLabel="Never ask again"
        />
      </View>
      {error ? (
        <AppText variant="caption" tone="danger" className="mt-2" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
    </Card>
  );
}

export default function MemoryCenterScreen() {
  const router = useRouter();
  const memories = useMemories({ limit: MEMORY_LIST_LIMIT });
  const settings = useMemorySettings();
  const suggestions = useMemorySuggestions();
  const updateSettings = useUpdateMemorySettings();
  const deleteMemory = useDeleteMemory();
  const deleteAll = useDeleteAllMemories();
  const decide = useDecideMemorySuggestion();
  // The one long-press sheet: whichever row was held.
  const [sheetMemory, setSheetMemory] = useState<MemoryItem | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  if (memories.isLoading) {
    return (
      <ScreenFrame>
        <SkeletonScreen />
      </ScreenFrame>
    );
  }

  if (memories.isError || !memories.data) {
    // Never the empty state: when the API is unreachable we know nothing
    // about what is stored, and "nothing remembered yet" would be a lie.
    return (
      <ScreenCentered>
        <ErrorState
          size="screen"
          message="Couldn't load your memories."
          onRetry={() => void memories.refetch()}
          retryLabel="Retry"
          retryAccessibilityLabel="Retry loading memories"
        />
      </ScreenCentered>
    );
  }

  const { items, total } = memories.data;
  const groups = groupMemoriesByKind(items);
  const switchView = memorySwitchPresentation({
    isLoading: settings.isLoading,
    isError: settings.isError,
    enabled: settings.data?.enabled,
    memoryCount: settings.data?.memory_count,
  });
  const switchOff = settings.data?.enabled === false;
  const suggestion = suggestions.data?.items[0] ?? null;
  const refreshing = memories.isRefetching || settings.isRefetching || suggestions.isRefetching;
  const refresh = () => {
    void memories.refetch();
    void settings.refetch();
    void suggestions.refetch();
  };

  const confirmDelete = (memory: MemoryItem) =>
    confirmDestructive({
      title: "Delete this memory?",
      message: "This can't be undone. Export first if you want a copy.",
      confirmLabel: "Delete",
      onConfirm: () => {
        setRowError(null);
        deleteMemory.mutate(memory.id, {
          onSuccess: () => showToast({ message: "Memory deleted", tone: "danger" }),
          onError: () => setRowError("Couldn't delete that memory. Please try again."),
        });
      },
    });

  const confirmDeleteAll = () =>
    confirmDestructive({
      title: `Delete all ${total} ${total === 1 ? "memory" : "memories"}?`,
      message: "This can't be undone. Export first if you want a copy.",
      confirmLabel: "Delete all",
      onConfirm: () => {
        setRowError(null);
        deleteAll.mutate(undefined, {
          onSuccess: (result) =>
            showToast({
              message: `Deleted ${result.deleted} ${result.deleted === 1 ? "memory" : "memories"}`,
              tone: "danger",
            }),
          onError: () => setRowError("Couldn't delete your memories. Please try again."),
        });
      },
    });

  const onDecideSuggestion = (decision: "remember" | "not_now" | "never") => {
    if (!suggestion) return;
    decide.mutate(
      {
        key: suggestion.key,
        body:
          decision === "remember" ? { decision, statement: suggestion.statement } : { decision },
      },
      {
        onSuccess: (result) => {
          if (result.memory) {
            const id = result.memory.id;
            showToast({
              message: "Remembered",
              tone: "success",
              action: { label: "View", onPress: () => router.push(memoryRoute(id)) },
            });
          }
        },
      },
    );
  };

  const exportUrl = memoryExportUrl(API_BASE_URL);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {/* The navigator bar already says "Memory"; the hero carries the count. */}
      <ScreenHeader variant="compact" title="Memory" />
      <MemoryHero total={total} items={items} chip={switchView.chip} />

      {switchOff ? (
        <Card variant="soft" className="mt-4" testID="memory-off-notice">
          <AppText variant="body">{MEMORY_OFF_NOTICE}</AppText>
          <Button
            label="Turn on"
            onPress={() => updateSettings.mutate(true)}
            busy={updateSettings.isPending}
            accessibilityLabel="Turn Memory on"
            variant="tonal"
            size="sm"
            className="mt-3"
          />
        </Card>
      ) : null}

      {suggestion ? (
        <SuggestionCard
          suggestion={suggestion}
          onDecide={onDecideSuggestion}
          pending={decide.isPending}
          error={decide.isError ? "Couldn't save that answer. Try again." : null}
        />
      ) : null}

      {rowError ? (
        <AppText variant="body" tone="danger" className="mt-4" accessibilityRole="alert">
          {rowError}
        </AppText>
      ) : null}

      {total === 0 ? (
        <>
          <EmptyState
            size="section"
            icon="brain"
            title="Nothing remembered yet"
            body="Memories are things you tell Personal OS on purpose. It never guesses them from what you do."
            action={{
              label: "Add a memory",
              onPress: () => router.push(memoryNewHref() as Href),
              accessibilityLabel: "Add a memory",
            }}
            className="mt-4"
            testID="memory-empty"
          />
          <Card variant="soft" testID="memory-starters">
            <SectionHeader
              title="Try one"
              icon="lightbulb-outline"
              spacing="none"
              className="pb-2"
            />
            <AppText variant="caption" tone="secondary" className="mb-3">
              Examples to start from. Each one just opens the editor with the sentence filled in.
            </AppText>
            <View className="flex-row flex-wrap gap-2">
              {MEMORY_STARTERS.map((starter) => (
                <ChoiceChip
                  key={starter.statement}
                  label={starter.statement}
                  selected={false}
                  onPress={() => router.push(memoryStarterHref(starter) as Href)}
                  accessibilityLabel={`Start from: ${starter.statement}`}
                />
              ))}
            </View>
          </Card>
        </>
      ) : (
        groups.map((group) => (
          <View key={group.kind}>
            <SectionHeader
              title={group.presentation.plural}
              count={group.items.length}
              icon={group.presentation.icon}
              action={{
                label: "Add",
                icon: "plus",
                onPress: () => router.push(memoryNewHref({ kind: group.kind }) as Href),
                accessibilityLabel: `Add a ${group.presentation.label.toLowerCase()}`,
              }}
            />
            <Card padding="none">
              {group.items.length === 0 ? (
                <EmptyState
                  size="compact"
                  icon={group.presentation.icon}
                  title={`No ${group.presentation.plural.toLowerCase()} yet`}
                />
              ) : (
                group.items.map((memory, index) => (
                  <MemoryRow
                    key={memory.id}
                    memory={memory}
                    onPress={() => router.push(memoryRoute(memory.id))}
                    onLongPress={() => setSheetMemory(memory)}
                    onDelete={() => confirmDelete(memory)}
                    deleting={deleteMemory.isPending && deleteMemory.variables === memory.id}
                    last={index === group.items.length - 1}
                    testID={`memory-row-${memory.id}`}
                  />
                ))
              )}
            </Card>
          </View>
        ))
      )}

      {total > items.length ? (
        <AppText variant="caption" tone="muted" className="mt-2">
          Showing {items.length} of {total}
        </AppText>
      ) : null}

      <Card variant="soft" className="mt-6" testID="memory-export-card">
        <SectionHeader title="Export" icon="export" spacing="none" className="pb-2" />
        <AppText variant="body" tone="secondary">
          Export your memories with everything else you&apos;ve written: open
        </AppText>
        <AppText variant="body-strong" selectable className="mt-1" testID="memory-export-url">
          {exportUrl}
        </AppText>
        <AppText variant="body" tone="secondary" className="mt-1">
          in a browser on this tailnet.
        </AppText>
      </Card>

      {total > 0 ? (
        <Button
          label="Delete all memories"
          onPress={confirmDeleteAll}
          busy={deleteAll.isPending}
          variant="outline"
          icon="delete-outline"
          block
          className="mt-4"
          testID="memory-delete-all"
        />
      ) : null}

      <BottomSheet
        open={sheetMemory !== null}
        onClose={() => setSheetMemory(null)}
        title={sheetMemory?.statement}
        testID="memory-row-sheet"
      >
        {sheetMemory ? (
          <>
            <SheetRow
              icon="pencil-outline"
              label="Edit"
              onPress={() => {
                const target = sheetMemory;
                setSheetMemory(null);
                router.push(memoryRoute(target.id));
              }}
              accessibilityLabel="Edit memory"
            />
            <SheetRow
              icon="delete-outline"
              label="Delete"
              tone="danger"
              onPress={() => {
                const target = sheetMemory;
                setSheetMemory(null);
                confirmDelete(target);
              }}
              accessibilityLabel="Delete memory"
              last
            />
          </>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}
