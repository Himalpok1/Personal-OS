import type { ComponentProps } from "react";
import { Component } from "react";
import { Pressable, Text, View } from "react-native";
import { useCurrentBrief, useGenerateBrief } from "@/queries/brief";
import { resolveBriefCardState } from "./brief-card-state";

// Card chrome mirrors ProjectCard/ReviewBanner in (tabs)/index.tsx --
// no shared UI kit exists in this app, so every card copies the same
// inline NativeWind conventions rather than inventing a new one.
const CARD_CLASS = "mx-4 mb-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800";

// The Brief card is mounted on the Today screen above the Overdue section
// (Checkpoint 5.1), and the model's prose is unbounded -- a long, multi-
// paragraph response would push every task row below the fold on the R1's
// 640px-tall screen. Clamp to this many lines by default; only clamp when
// the text actually overflows it.
export const BRIEF_COLLAPSED_LINES = 6;

type TextLayoutEvent = Parameters<NonNullable<ComponentProps<typeof Text>["onTextLayout"]>>[0];

interface ClampedBriefTextProps {
  text: string;
  // Classes for the prose itself (color/size/leading). Kept separate from
  // containerClassName so margin lives in exactly one place regardless of
  // whether the toggle ends up rendering.
  textClassName: string;
  containerClassName?: string;
}

interface ClampedBriefTextState {
  expanded: boolean;
  // Only true once a real onTextLayout measurement has confirmed the full
  // (unclamped) text needs more than BRIEF_COLLAPSED_LINES lines. Starts
  // false on purpose: guessing from string length is explicitly wrong here
  // (font, width, and locale all affect wrapping), so no toggle renders
  // until the real measurement comes back.
  isClamped: boolean;
}

// The rest of this app is 100% function components + hooks (see
// brief-card-state.ts's docstring on why brief-card.tsx itself stays a thin,
// hookless renderer). This is a deliberate, isolated exception: the app's
// test harness (brief-card.test.tsx) calls components directly with no React
// renderer/dispatcher attached, which cannot support hooks at all -- any
// useState here would break every existing BriefCard test, not just new
// ones. A class component's instance state needs no dispatcher, so it can be
// constructed and inspected directly in tests exactly like the rest of this
// file already is. BriefCard itself stays completely hookless; only this
// isolated, single-purpose component pays the cost.
export class ClampedBriefText extends Component<ClampedBriefTextProps, ClampedBriefTextState> {
  state: ClampedBriefTextState = { expanded: false, isClamped: false };

  componentDidUpdate(prevProps: ClampedBriefTextProps): void {
    // A regenerate (or any brief-text change) must not leave a stale
    // expanded/measured view of the previous text hanging around.
    if (prevProps.text !== this.props.text) {
      this.setState({ expanded: false, isClamped: false });
    }
  }

  handleMeasureLayout = (event: TextLayoutEvent): void => {
    const measuredLines = event.nativeEvent.lines.length;
    const isClamped = measuredLines > BRIEF_COLLAPSED_LINES;
    if (isClamped !== this.state.isClamped) {
      this.setState({ isClamped });
    }
  };

  toggleExpanded = (): void => {
    this.setState((prev) => ({ expanded: !prev.expanded }));
  };

  render() {
    const { text, textClassName, containerClassName } = this.props;
    const { expanded, isClamped } = this.state;

    return (
      <View className={containerClassName}>
        {/* Invisible, always-unclamped measurement pass -- the only reliable
            way to learn the real rendered line count (per RN, onTextLayout
            on a Text that already has numberOfLines set only reports the
            truncated line count, not the true one). */}
        <Text
          className={textClassName}
          style={{ position: "absolute", opacity: 0, zIndex: -1 }}
          onTextLayout={this.handleMeasureLayout}
          accessible={false}
          pointerEvents="none"
        >
          {text}
        </Text>
        <Text className={textClassName} numberOfLines={expanded ? undefined : BRIEF_COLLAPSED_LINES}>
          {text}
        </Text>
        {isClamped ? (
          <Pressable
            onPress={this.toggleExpanded}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            hitSlop={8}
            className="mt-1 min-h-[44px] items-center justify-start"
          >
            <Text className="text-sm font-medium text-blue-600 dark:text-blue-400">
              {expanded ? "Show less" : "Show more"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
}

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
        <ClampedBriefText
          text={state.text}
          textClassName="text-sm leading-5 text-neutral-700 dark:text-neutral-300"
        />
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
          <ClampedBriefText
            text={state.previousText}
            textClassName="text-sm leading-5 text-neutral-700 dark:text-neutral-300"
            containerClassName="mb-3"
          />
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
          <ClampedBriefText
            text={state.previousText}
            textClassName="text-sm leading-5 text-neutral-700 dark:text-neutral-300"
            containerClassName="mb-3"
          />
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
        <ClampedBriefText
          text={state.previousText}
          textClassName="text-sm leading-5 text-neutral-700 dark:text-neutral-300"
          containerClassName="mb-3"
        />
      ) : null}
      <Text className="mb-3 text-sm text-red-600 dark:text-red-400">
        {"Couldn't generate the daily brief."}
      </Text>
      <ActionButton label="Retry" onPress={onGenerate} tone="danger" />
    </View>
  );
}
