import type { FocusSource, FocusSuggestionResponse } from "@personal-os/schema";
import { FOCUS_MIN_CANDIDATES } from "@personal-os/schema";
import { View } from "react-native";
import { AskSourceRow } from "@/components/ask/ask-view";
import { AppText, Button, Card, SectionHeader } from "@/components/ui";

// Suggested Focus (Checkpoint 9.8): when Cloud Ask is on and there are at
// least FOCUS_MIN_CANDIDATES today (overdue + due-today tasks), a tap picks
// ONE and explains why in <=40 words, citing it. Never automatic -- no model
// call happens without an explicit tap on this card's own button (never on
// mount, never from an effect). Hookless and props-driven, same convention
// as AskView: all state lives in the caller's query/mutation hooks.
//
// EVERY STRING HERE IS INERT TEXT -- same rule as AskView/SearchView: the
// suggestion is attacker-influenceable prose grounded in the owner's own
// data but still not first-party text; a source's title is the owner's own
// stored text. Both land in a plain <Text> (AppText is a Text with a class).
//
// Checkpoint 10.3: composed from the design system (Card, SectionHeader,
// Button, AppText). Every state, testID, label and behaviour is unchanged.

export type SuggestedFocusState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; response: FocusSuggestionResponse }
  | { kind: "not_enough_candidates" }
  | { kind: "error"; message: string };

export const SUGGESTED_FOCUS_NOT_ENOUGH_COPY = "Nothing stands out enough to suggest right now.";

export interface SuggestedFocusCardProps {
  /** Today's overdue + due-today count -- see focusCandidateCount in queries/focus.ts. */
  candidateCount: number;
  state: SuggestedFocusState;
  onSuggest: () => void;
  onSelectSource: (source: FocusSource) => void;
}

function Title() {
  return <SectionHeader title="Suggested focus" icon="target" spacing="card" />;
}

export function SuggestedFocusCard({
  candidateCount,
  state,
  onSuggest,
  onSelectSource,
}: SuggestedFocusCardProps) {
  // Hard product requirement (owner-approved): below the threshold, render
  // NOTHING -- not a disabled/greyed-out row. The Today screen's call site
  // mirrors this with the same `askEnabled ? (...) : null` idiom the Ask
  // chip already uses; this internal guard is belt-and-braces.
  if (candidateCount < FOCUS_MIN_CANDIDATES) return null;

  if (state.kind === "ready") {
    return (
      <Card testID="suggested-focus-card" className="mt-3">
        <Title />
        <View testID="suggested-focus-answer-container">
          <AppText testID="suggested-focus-answer" variant="body">
            {state.response.suggestion}
          </AppText>
          <AskSourceRow
            source={state.response.source}
            onSelect={() => onSelectSource(state.response.source)}
          />
          {/* Extensibility note (D4 of the 9.8 design deliberately excludes
              this for now): a future helpful/not-helpful affordance could be
              added here as an optional prop without restructuring this
              component -- nothing is built for it yet. */}
          <Button
            testID="suggested-focus-suggest"
            onPress={onSuggest}
            accessibilityLabel="Suggest focus again"
            label="Suggest again"
            variant="outline"
            size="sm"
            className="mt-3"
          />
        </View>
      </Card>
    );
  }

  if (state.kind === "not_enough_candidates") {
    // The server independently recomputes candidates from a freshly-read
    // TodayContext, which can disagree with this card's client-side gate
    // (built from a possibly-stale cached /today summary) -- e.g. the owner
    // completed one of exactly two overdue tasks between page load and this
    // tap. Without a way back to "idle", this state was a dead end (9.8
    // adversarial review): "Check again" re-runs the same cheap, no-model-
    // call request, which either succeeds (the count changed) or returns the
    // same honest refusal.
    return (
      <Card testID="suggested-focus-card" className="mt-3">
        <Title />
        <AppText testID="suggested-focus-not-enough" variant="body" tone="secondary">
          {SUGGESTED_FOCUS_NOT_ENOUGH_COPY}
        </AppText>
        <Button
          testID="suggested-focus-suggest"
          onPress={onSuggest}
          accessibilityLabel="Check again"
          label="Check again"
          variant="outline"
          size="sm"
          className="mt-3"
        />
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card testID="suggested-focus-card" className="mt-3">
        <Title />
        <View testID="suggested-focus-error-container">
          <AppText testID="suggested-focus-error" variant="body" tone="danger">
            {state.message}
          </AppText>
          <Button
            testID="suggested-focus-suggest"
            onPress={onSuggest}
            accessibilityLabel="Try suggesting focus again"
            label="Try again"
            variant="outline"
            size="sm"
            className="mt-3"
          />
        </View>
      </Card>
    );
  }

  const loading = state.kind === "loading";
  return (
    <Card testID="suggested-focus-card" className="mt-3">
      <Title />
      <AppText variant="body" tone="secondary" className="mb-3">
        One task to start with, and why -- picked from today&apos;s overdue and due items.
      </AppText>
      {/* `busy` renders "Thinking…" and BINDS the disabled state, so a second
          tap during the request is a no-op rather than a second model call. */}
      <Button
        testID="suggested-focus-suggest"
        onPress={onSuggest}
        busy={loading}
        accessibilityLabel="Suggest focus"
        label={loading ? "Thinking" : "Suggest focus"}
        variant="tonal"
        size="sm"
      />
    </Card>
  );
}
