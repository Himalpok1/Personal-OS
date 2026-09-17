import {
  AppText,
  Button,
  Card,
  ClampedText,
  EmptyState,
  SectionHeader,
  SkeletonCard,
  textClass,
} from "@/components/ui";
import { useCurrentBrief, useGenerateBrief } from "@/queries/brief";
import { resolveBriefCardState } from "./brief-card-state";

// Checkpoint 10.3: the card composes the design system (Card, SectionHeader,
// Button, AppText) instead of the inline NativeWind string it shared with
// every other Today card before there was a UI kit. Every state, label and
// behaviour below is unchanged; only the chrome is.
//
// Checkpoint 10.6 (ADR-076 §3): the prose clamp is the design system's
// `ClampedText` -- the class component `ClampedBriefText` used to be, moved
// into `ui/` so the Brief and the mail digest share one -- and the
// no-provider line is a compact `EmptyState` row. BriefCard stays HOOKLESS:
// brief-card.test.tsx calls it directly with no React dispatcher, which is
// why the clamp is a class component and why nothing here may call a hook.

// The Brief card is mounted on the Today screen above the Overdue section
// (Checkpoint 5.1), and the model's prose is unbounded -- a long, multi-
// paragraph response would push every task row below the fold on the R1's
// 640px-tall screen. Clamp to this many lines by default; only clamp when
// the text actually overflows it.
export const BRIEF_COLLAPSED_LINES = 6;

function formatGeneratedAt(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The brief's prose class: body size on the secondary tone, so the clamp component can measure it. */
const PROSE_CLASS = textClass("body", "secondary");

function Title() {
  return <SectionHeader title="Daily Brief" icon="text-box-outline" spacing="card" />;
}

function ActionButton({
  label,
  onPress,
  disabled,
  tone = "default",
}: {
  label: string;
  onPress: () => void;
  /** Bound to the press, not just drawn: a pending generation must not be re-fired by a second tap. */
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <Button
      label={label}
      onPress={onPress}
      disabled={disabled}
      variant={tone === "danger" ? "danger" : "primary"}
      size="sm"
    />
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
    // A skeleton, not nothing: unlike the optional Health/Academics cards,
    // the Brief card is always on Today, so its place is reserved.
    return <SkeletonCard lines={3} className="mb-3" />;
  }

  if (state.kind === "empty") {
    return (
      <Card className="mb-3">
        <Title />
        <AppText variant="body" tone="secondary" className="mb-3">
          A one-tap summary of today, generated on demand.
        </AppText>
        <ActionButton label="Generate Daily Brief" onPress={onGenerate} />
      </Card>
    );
  }

  if (state.kind === "present") {
    return (
      <Card className="mb-3">
        <Title />
        <ClampedText text={state.text} lines={BRIEF_COLLAPSED_LINES} textClassName={PROSE_CLASS} />
        <AppText variant="caption" tone="muted" className="mb-3 mt-2">
          Generated {formatGeneratedAt(state.generatedAt)}
        </AppText>
        <ActionButton label="Regenerate" onPress={onGenerate} />
      </Card>
    );
  }

  if (state.kind === "generating") {
    return (
      <Card className="mb-3">
        <Title />
        {state.previousText ? (
          <ClampedText
            text={state.previousText}
            lines={BRIEF_COLLAPSED_LINES}
            textClassName={PROSE_CLASS}
            containerClassName="mb-3"
          />
        ) : null}
        <ActionButton label="Generating…" onPress={onGenerate} disabled />
      </Card>
    );
  }

  if (state.kind === "no_provider") {
    return (
      <Card className="mb-3">
        <Title />
        {state.previousText ? (
          <ClampedText
            text={state.previousText}
            lines={BRIEF_COLLAPSED_LINES}
            textClassName={PROSE_CLASS}
            containerClassName="mb-3"
          />
        ) : null}
        {/* Still offer the action: the user may have just configured a
            provider in Settings, and without this the card is a dead end
            until the whole app is reloaded. Calm default tone, not danger --
            an unconfigured provider is a non-fatal state, not a failure. */}
        <EmptyState
          size="compact"
          icon="robot-off-outline"
          title="No AI provider is configured for daily briefs."
          action={{ label: "Try again", onPress: onGenerate }}
          className="-mx-4"
        />
      </Card>
    );
  }

  // state.kind === "error"
  return (
    <Card className="mb-3">
      <Title />
      {state.previousText ? (
        <ClampedText
          text={state.previousText}
          lines={BRIEF_COLLAPSED_LINES}
          textClassName={PROSE_CLASS}
          containerClassName="mb-3"
        />
      ) : null}
      <AppText variant="body" tone="danger" className="mb-3">
        {"Couldn't generate the daily brief."}
      </AppText>
      <ActionButton label="Retry" onPress={onGenerate} tone="danger" />
    </Card>
  );
}
