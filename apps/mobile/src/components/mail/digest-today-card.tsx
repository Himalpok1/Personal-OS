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
import { useCurrentMailDigest, useGenerateMailDigest } from "@/queries/mail";
import {
  canGenerateDigest,
  digestFailureText,
  resolveDigestCardState,
} from "./digest-card-state";

// THE ONE new Today card (Checkpoint 7.6). Checkpoint 10.3 moved its chrome
// onto the design system (Card, SectionHeader, Button, AppText); every
// state, label and behaviour is unchanged.
//
// Checkpoint 10.6 (ADR-076 §3): the prose clamp is the design system's
// `ClampedText` (the class component `ClampedDigestText` used to be, now
// shared with the Daily Brief), and the unavailable / not-configured /
// no-mailbox states are compact `EmptyState` rows -- one line each, so the
// card takes no more of Today than it says. MailDigestCard stays HOOKLESS:
// digest-today-card.test.tsx calls it directly with no React dispatcher.

// ===========================================================================
// THE VERTICAL CAP
// ===========================================================================
//
// Today is the busiest screen in the app on a 480x640 device, and the digest's
// prose is model output with no length bound. Unclamped, a long digest pushes
// Overdue below the fold -- so it clamps to this many lines, and only when the
// text actually overflows them.
export const DIGEST_COLLAPSED_LINES = 5;

function ActionButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  /** BOUND, not merely used to draw an indicator (Checkpoint 6.7A finding A1): rapid taps must not fire concurrent mutations. */
  disabled?: boolean;
}) {
  return <Button label={label} onPress={onPress} disabled={disabled} size="sm" />;
}

function Title() {
  return <SectionHeader title="Mail digest" icon="email-outline" spacing="card" />;
}

/** The digest's prose class: body size on the secondary tone, so the clamp component can measure it. */
const PROSE_CLASS = textClass("body", "secondary");

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

  // A 202 means ACCEPTED, not done. `generate.isPending` ends at that 202 -- an
  // HTTP round trip -- so on its own the "preparing" message would flash for a
  // few hundred milliseconds while the worker had not started. This compares the
  // request's own timestamp against the digest's, so the card keeps saying
  // "requested" until a digest generated AFTER the request actually lands.
  const digest = digestQuery.data?.digest ?? null;
  const hasPendingRequest =
    generate.isSuccess &&
    generate.submittedAt > 0 &&
    (digest === null || Date.parse(digest.generated_at) < generate.submittedAt);

  const state = resolveDigestCardState({
    isLoading: digestQuery.isLoading,
    data: digestQuery.data,
    isLoadError: digestQuery.isError,
    isGenerating: generate.isPending,
    generateError: generate.error,
    hasPendingRequest,
  });

  const onGenerate = () => generate.mutate();
  const onRetry = () => void digestQuery.refetch();
  const showAction = canGenerateDigest(state);

  if (state.kind === "loading") {
    return <SkeletonCard lines={3} className="mb-3" />;
  }

  if (state.kind === "unavailable") {
    return (
      <Card className="mb-3">
        <Title />
        {/* We could not read it, so we claim nothing about the mail itself.
            RETRY, NOT GENERATE. Generating is the wrong action when the problem
            is that we could not read -- but offering nothing at all would make
            this a dead end, the P1 class Checkpoint 6.5 fixed on three detail
            screens. */}
        <EmptyState
          size="compact"
          icon="cloud-off-outline"
          title="Can't reach Personal OS, so the mail digest is unavailable."
          action={{ label: "Retry", onPress: onRetry }}
          className="-mx-4"
        />
      </Card>
    );
  }

  if (state.kind === "not_configured" || state.kind === "no_mailbox") {
    return (
      <Card className="mb-3">
        <Title />
        {/* Two different sentences, because they are two different situations.
            Telling someone to connect a mailbox when the server has no Gmail
            credentials at all would send them somewhere that cannot help. */}
        <EmptyState
          size="compact"
          icon="email-off-outline"
          title={
            state.kind === "not_configured"
              ? "Gmail isn't set up on this server."
              : "Connect a mailbox in Settings to start getting daily mail digests."
          }
          className="-mx-4"
        />
      </Card>
    );
  }

  if (state.kind === "empty") {
    return (
      <Card className="mb-3">
        <Title />
        <AppText variant="body" tone="secondary" className="mb-3">
          {"No digest yet. One is generated automatically each day."}
        </AppText>
        {showAction ? <ActionButton label="Generate now" onPress={onGenerate} /> : null}
      </Card>
    );
  }

  if (state.kind === "requested") {
    return (
      <Card className="mb-3">
        <Title />
        {state.previousText ? (
          <ClampedText
            text={state.previousText}
            lines={DIGEST_COLLAPSED_LINES}
            textClassName={PROSE_CLASS}
            containerClassName="mb-3"
          />
        ) : null}
        {/* Persists until a digest newer than the request lands. Says plainly
            that the work is queued, and never that a digest is ready. */}
        <AppText variant="caption" tone="muted" className="mb-3">
          {"Requested. Personal OS is preparing it, and it'll appear here when it's ready."}
        </AppText>
        <ActionButton label="Requested" onPress={onGenerate} disabled />
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
            lines={DIGEST_COLLAPSED_LINES}
            textClassName={PROSE_CLASS}
            containerClassName="mb-3"
          />
        ) : null}
        {/* Honest about what a 202 means: the request was accepted, and a digest
            does not exist yet. This never claims one is ready. */}
        <AppText variant="caption" tone="muted" className="mb-3">
          {"Personal OS is preparing a digest. It'll appear here when it's ready."}
        </AppText>
        <ActionButton label="Working…" onPress={onGenerate} disabled />
      </Card>
    );
  }

  if (state.kind === "failed") {
    return (
      <Card className="mb-3">
        <Title />
        {/* A failed request never destroys the cached digest. */}
        {state.previousText ? (
          <ClampedText
            text={state.previousText}
            lines={DIGEST_COLLAPSED_LINES}
            textClassName={PROSE_CLASS}
            containerClassName="mb-3"
          />
        ) : null}
        {/* Fixed copy per reason -- no provider text, no raw code. */}
        <AppText variant="body" tone="warning" className="mb-3">
          {digestFailureText(state.reason)}
        </AppText>
        {showAction ? <ActionButton label="Try again" onPress={onGenerate} /> : null}
      </Card>
    );
  }

  return (
    <Card className="mb-3">
      <Title />
      {/* Only `content.text` is ever rendered. `MailDigestContentSchema` is
          `.passthrough()`, so iterating its keys would put unvalidated model
          output on screen. */}
      <ClampedText text={state.text} lines={DIGEST_COLLAPSED_LINES} textClassName={PROSE_CLASS} />
      {/* Says WHICH day and WHICH zone the digest covers. The zone is server
          configuration and can legitimately differ from this device's, so
          labelling it "today" without qualification could be wrong. */}
      <AppText variant="caption" tone="muted" className="mb-3 mt-2">
        {`Covers ${state.digestDate} · ${state.timezone}`}
      </AppText>
      {showAction ? <ActionButton label="Regenerate" onPress={onGenerate} /> : null}
    </Card>
  );
}
