import { Pressable, Text, View } from "react-native";
import { useCurrentBrief, useGenerateBrief } from "@/queries/brief";
import { resolveBriefCardState } from "./brief-card-state";

// Card chrome mirrors ProjectCard/ReviewBanner in (tabs)/index.tsx --
// no shared UI kit exists in this app, so every card copies the same
// inline NativeWind conventions rather than inventing a new one.
const CARD_CLASS = "mx-4 mb-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800";

function formatGeneratedAt(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ActionButton({
  label,
  onPress,
  disabled,
  tone = "default",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={8}
      className={`min-h-[44px] items-center justify-center rounded-lg px-4 py-2 active:opacity-70 ${
        disabled
          ? "bg-neutral-200 dark:bg-neutral-800"
          : tone === "danger"
            ? "bg-red-600"
            : "bg-blue-600"
      }`}
    >
      <Text
        className={`text-sm font-semibold ${
          disabled ? "text-neutral-500 dark:text-neutral-400" : "text-white"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function BriefCard() {
  const currentBriefQuery = useCurrentBrief();
  const generateMutation = useGenerateBrief();

  const state = resolveBriefCardState({
    isLoading: currentBriefQuery.isLoading,
    brief: currentBriefQuery.data,
    isGenerating: generateMutation.isPending,
    // The in-flight/most-recent regeneration attempt takes priority over a
    // stale read error -- it's the action the user just took.
    error: generateMutation.error ?? currentBriefQuery.error,
  });

  const onGenerate = () => generateMutation.mutate();

  if (state.kind === "loading") {
    return (
      <View className={CARD_CLASS}>
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">
          Loading daily brief…
        </Text>
      </View>
    );
  }

  if (state.kind === "empty") {
    return (
      <View className={CARD_CLASS}>
        <Text className="mb-3 text-base font-medium text-black dark:text-white">Daily Brief</Text>
        <ActionButton label="Generate Daily Brief" onPress={onGenerate} />
      </View>
    );
  }

  if (state.kind === "present") {
    return (
      <View className={CARD_CLASS}>
        <Text className="mb-2 text-base font-medium text-black dark:text-white">Daily Brief</Text>
        <Text className="text-sm leading-5 text-neutral-700 dark:text-neutral-300">
          {state.text}
        </Text>
        <Text className="mb-3 mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Generated {formatGeneratedAt(state.generatedAt)}
        </Text>
        <ActionButton label="Regenerate" onPress={onGenerate} />
      </View>
    );
  }

  if (state.kind === "generating") {
    return (
      <View className={CARD_CLASS}>
        <Text className="mb-2 text-base font-medium text-black dark:text-white">Daily Brief</Text>
        {state.previousText ? (
          <Text className="mb-3 text-sm leading-5 text-neutral-700 dark:text-neutral-300">
            {state.previousText}
          </Text>
        ) : null}
        <ActionButton label="Generating…" onPress={onGenerate} disabled />
      </View>
    );
  }

  if (state.kind === "no_provider") {
    return (
      <View className={CARD_CLASS}>
        <Text className="mb-2 text-base font-medium text-black dark:text-white">Daily Brief</Text>
        {state.previousText ? (
          <Text className="mb-3 text-sm leading-5 text-neutral-700 dark:text-neutral-300">
            {state.previousText}
          </Text>
        ) : null}
        <Text className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
          No AI provider is configured for daily briefs.
        </Text>
        {/* Still offer the action: the user may have just configured a
            provider in Settings, and without this the card is a dead end
            until the whole app is reloaded. Calm default tone, not danger --
            an unconfigured provider is a non-fatal state, not a failure. */}
        <ActionButton label="Try again" onPress={onGenerate} />
      </View>
    );
  }

  // state.kind === "error"
  return (
    <View className={CARD_CLASS}>
      <Text className="mb-2 text-base font-medium text-black dark:text-white">Daily Brief</Text>
      {state.previousText ? (
        <Text className="mb-3 text-sm leading-5 text-neutral-700 dark:text-neutral-300">
          {state.previousText}
        </Text>
      ) : null}
      <Text className="mb-3 text-sm text-red-600 dark:text-red-400">
        {"Couldn't generate the daily brief."}
      </Text>
      <ActionButton label="Retry" onPress={onGenerate} tone="danger" />
    </View>
  );
}
