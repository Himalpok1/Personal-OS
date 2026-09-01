import type { ComponentProps } from "react";
import { Component } from "react";
import { Pressable, Text, View } from "react-native";
import { useCurrentMailDigest, useGenerateMailDigest } from "@/queries/mail";
import {
  canGenerateDigest,
  digestFailureText,
  resolveDigestCardState,
} from "./digest-card-state";

// THE ONE new Today card (Checkpoint 7.6).
//
// Card chrome copies the same inline NativeWind string BriefCard and
// HealthTodayCard each declare. There is no shared UI kit in this app and
// brief-card.tsx records the duplication as a deliberate convention, so this
// matches the string rather than extracting an export -- which would pull three
// existing card files into a UI checkpoint's diff.
const CARD_CLASS = "mx-4 mb-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800";

// ===========================================================================
// THE VERTICAL CAP
// ===========================================================================
//
// Today is the busiest screen in the app on a 480x640 device, and the digest's
// prose is model output with no length bound. Unclamped, a long digest pushes
// Overdue below the fold -- so it clamps to this many lines, and only when the
// text actually overflows them.
export const DIGEST_COLLAPSED_LINES = 5;

type TextLayoutEvent = Parameters<NonNullable<ComponentProps<typeof Text>["onTextLayout"]>>[0];

interface ClampedDigestTextProps {
  text: string;
  textClassName: string;
  containerClassName?: string;
}

interface ClampedDigestTextState {
  expanded: boolean;
  isClamped: boolean;
}

/**
 * A class component, for the same reason `ClampedBriefText` is one.
 *
 * This app's test harness calls components directly with no React renderer and
 * therefore no dispatcher, so any `useState` here would break every render-level
 * test in the file rather than just new ones. Instance state needs no
 * dispatcher.
 *
 * The hidden measurement Text is load-bearing, not decoration: `onTextLayout` on
 * a Text that ALREADY has `numberOfLines` set reports the TRUNCATED line count,
 * so measuring the visible clamped copy would report exactly the limit forever
 * and the toggle would never appear. Guessing from string length is also wrong
 * -- font, width and locale all affect wrapping -- which is why `isClamped`
 * starts false and nothing renders until a real measurement returns.
 */
export class ClampedDigestText extends Component<ClampedDigestTextProps, ClampedDigestTextState> {
  state: ClampedDigestTextState = { expanded: false, isClamped: false };

  componentDidUpdate(prevProps: ClampedDigestTextProps): void {
    if (prevProps.text !== this.props.text) {
      this.setState({ expanded: false, isClamped: false });
    }
  }

  handleMeasureLayout = (event: TextLayoutEvent): void => {
    const isClamped = event.nativeEvent.lines.length > DIGEST_COLLAPSED_LINES;
    if (isClamped !== this.state.isClamped) this.setState({ isClamped });
  };

  toggleExpanded = (): void => {
    this.setState((prev) => ({ expanded: !prev.expanded }));
  };

  render() {
    const { text, textClassName, containerClassName } = this.props;
    const { expanded, isClamped } = this.state;

    return (
      <View className={containerClassName}>
        <Text
          className={textClassName}
          style={{ position: "absolute", opacity: 0, zIndex: -1 }}
          onTextLayout={this.handleMeasureLayout}
          accessible={false}
          pointerEvents="none"
        >
          {text}
        </Text>
        <Text
          className={textClassName}
          numberOfLines={expanded ? undefined : DIGEST_COLLAPSED_LINES}
        >
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

function ActionButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      // BOUND, not merely used to draw an indicator. Checkpoint 6.7A finding A1:
      // without this, rapid taps fire concurrent mutations.
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={8}
      className={`min-h-[44px] items-center justify-center rounded-lg px-4 py-2 active:opacity-70 ${
        disabled ? "bg-neutral-200 dark:bg-neutral-800" : "bg-blue-600"
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

function Title() {
  return <Text className="mb-2 text-base font-medium text-black dark:text-white">Mail digest</Text>;
}

const PROSE_CLASS = "text-sm leading-5 text-neutral-700 dark:text-neutral-300";

/**
 * The Today mail-digest card.
 *
 * OWNS ITS OWN QUERY and reads nothing from `/today`. Both existing Today cards
 * do the same, and the rule the Today screen states is that it "must never wait
 * on, or fail because of" a dependent integration -- a mail outage must not be
 * able to make the task list fail to load.
 *
 * RESERVES A LOADING STATE rather than collapsing to null. HealthTodayCard
 * collapses deliberately, because for most installs Health renders nothing
 * forever; a digest is expected to exist once mail is set up, so the house rule
 * (reserve, as BriefCard does) applies instead.
 */
export function MailDigestCard() {
  const digestQuery = useCurrentMailDigest();
  const generate = useGenerateMailDigest();

  const state = resolveDigestCardState({
    isLoading: digestQuery.isLoading,
    data: digestQuery.data,
    isLoadError: digestQuery.isError,
    isGenerating: generate.isPending,
    generateError: generate.error,
  });

  const onGenerate = () => generate.mutate();
  const showAction = canGenerateDigest(state);

  if (state.kind === "loading") {
    return (
      <View className={CARD_CLASS}>
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">Loading mail digest…</Text>
      </View>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <View className={CARD_CLASS}>
        <Title />
        {/* We could not read it, so we claim nothing about the mail itself. */}
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">
          {"Can't reach Personal OS, so the mail digest is unavailable."}
        </Text>
      </View>
    );
  }

  if (state.kind === "not_configured" || state.kind === "no_mailbox") {
    return (
      <View className={CARD_CLASS}>
        <Title />
        {/* Two different sentences, because they are two different situations.
            Telling someone to connect a mailbox when the server has no Gmail
            credentials at all would send them somewhere that cannot help. */}
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">
          {state.kind === "not_configured"
            ? "Gmail isn't set up on this server."
            : "Connect a mailbox in Settings to start getting daily mail digests."}
        </Text>
      </View>
    );
  }

  if (state.kind === "empty") {
    return (
      <View className={CARD_CLASS}>
        <Title />
        <Text className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
          {"No digest yet. One is generated automatically each day."}
        </Text>
        {showAction ? <ActionButton label="Generate now" onPress={onGenerate} /> : null}
      </View>
    );
  }

  if (state.kind === "generating") {
    return (
      <View className={CARD_CLASS}>
        <Title />
        {state.previousText ? (
          <ClampedDigestText
            text={state.previousText}
            textClassName={PROSE_CLASS}
            containerClassName="mb-3"
          />
        ) : null}
        {/* Honest about what a 202 means: the request was accepted, and a digest
            does not exist yet. This never claims one is ready. */}
        <Text className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
          {"Personal OS is preparing a digest. It'll appear here when it's ready."}
        </Text>
        <ActionButton label="Working…" onPress={onGenerate} disabled />
      </View>
    );
  }

  if (state.kind === "failed") {
    return (
      <View className={CARD_CLASS}>
        <Title />
        {/* A failed request never destroys the cached digest. */}
        {state.previousText ? (
          <ClampedDigestText
            text={state.previousText}
            textClassName={PROSE_CLASS}
            containerClassName="mb-3"
          />
        ) : null}
        {/* Fixed copy per reason -- no provider text, no raw code. */}
        <Text className="mb-3 text-sm text-amber-700 dark:text-amber-300">
          {digestFailureText(state.reason)}
        </Text>
        {showAction ? <ActionButton label="Try again" onPress={onGenerate} /> : null}
      </View>
    );
  }

  return (
    <View className={CARD_CLASS}>
      <Title />
      {/* Only `content.text` is ever rendered. `MailDigestContentSchema` is
          `.passthrough()`, so iterating its keys would put unvalidated model
          output on screen. */}
      <ClampedDigestText text={state.text} textClassName={PROSE_CLASS} />
      {/* Says WHICH day and WHICH zone the digest covers. The zone is server
          configuration and can legitimately differ from this device's, so
          labelling it "today" without qualification could be wrong. */}
      <Text className="mb-3 mt-2 text-xs text-neutral-500 dark:text-neutral-400">
        {`Covers ${state.digestDate} · ${state.timezone}`}
      </Text>
      {showAction ? <ActionButton label="Regenerate" onPress={onGenerate} /> : null}
    </View>
  );
}
