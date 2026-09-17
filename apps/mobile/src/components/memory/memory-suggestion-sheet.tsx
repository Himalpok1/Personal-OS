import type { MemorySuggestion, MemorySuggestionDecision } from "@personal-os/schema";
import { useRouter, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { View } from "react-native";
import { AppText, BottomSheet, SheetRow, showToast } from "@/components/ui";
import { useDecideMemorySuggestion } from "@/queries/memory";
import { MEMORY_PRIVACY_LINE } from "./memory-privacy";

// The explicit-moment suggestion sheet (Checkpoint 10.7, ADR-077 §4).
//
// Opens from exactly two places: the project screen, right after the owner
// saved a goal (app/projects/[id].tsx), and the Memory Center's one
// "Suggested" card. Never from Today, never on a timer, never from a
// behaviour signal -- the store has no opener but `showMemorySuggestion`,
// and a source guard pins that no Today file imports this module.
//
// STATE LIVES IN A MODULE STORE, the `showToast()` / `openAssignmentSheet()`
// pattern: the project screen's save handler is a mutation callback with
// no access to a sheet's state, so it calls a plain function, and ONE
// `MemorySuggestionSheetHost`, mounted once at the root beside
// `AssignmentSheetHost` (app/_layout.tsx), draws the `BottomSheet`.
//
// The statement is shown READ-ONLY. "Remember" sends exactly the sentence
// on screen (the server stores what the owner confirmed, never its own
// composition -- ADR-077 §3); the owner edits it afterwards in /memory/[id]
// if they want a different wording. "Not now" silences this key for 14 days;
// "Never ask again" silences it for good -- neither stores the sentence.
//
// `MemorySuggestionSheetHost` is the leaf (hooks); `MemorySuggestionSheetContent`
// is hookless and is what the test renders.

export interface MemorySuggestionSheetState {
  visible: boolean;
  suggestion: MemorySuggestion | null;
}

// --- the store -------------------------------------------------------------

type Listener = () => void;

const CLOSED: MemorySuggestionSheetState = { visible: false, suggestion: null };
let state: MemorySuggestionSheetState = CLOSED;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Open the sheet for a suggestion the owner has just been shown the trigger for. */
export function showMemorySuggestion(suggestion: MemorySuggestion): void {
  state = { visible: true, suggestion };
  emit();
}

/** Close the sheet. The record stays for the exit animation. */
export function closeMemorySuggestion(): void {
  if (!state.visible) return;
  state = { visible: false, suggestion: state.suggestion };
  emit();
}

export function getMemorySuggestionSheet(): MemorySuggestionSheetState {
  return state;
}

export function subscribeMemorySuggestionSheet(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only. */
export function resetMemorySuggestionSheetForTests(): void {
  state = CLOSED;
  emit();
}

// --- the content -----------------------------------------------------------

export interface MemorySuggestionSheetContentProps {
  suggestion: MemorySuggestion;
  onDecide: (decision: MemorySuggestionDecision) => void;
  pending: boolean;
  error: string | null;
}

/** The rows: the statement, its evidence, and the three answers. Hookless. */
export function MemorySuggestionSheetContent({
  suggestion,
  onDecide,
  pending,
  error,
}: MemorySuggestionSheetContentProps) {
  return (
    <View className="pb-2" testID="memory-suggestion-sheet-content">
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`${suggestion.statement}. ${suggestion.evidence}`}
        className="mb-3"
      >
        <AppText variant="body-strong" testID="memory-suggestion-statement">
          {suggestion.statement}
        </AppText>
        <AppText
          variant="caption"
          tone="secondary"
          className="mt-1"
          testID="memory-suggestion-evidence"
        >
          {suggestion.evidence}
        </AppText>
        <AppText variant="caption" tone="muted" className="mt-1">
          {MEMORY_PRIVACY_LINE}
        </AppText>
      </View>
      <SheetRow
        icon="check"
        tone="primary"
        label="Remember"
        subtitle="Saved exactly as shown; you can edit it afterwards"
        onPress={() => onDecide("remember")}
        disabled={pending}
        testID="memory-suggestion-remember"
      />
      <SheetRow
        icon="clock-outline"
        label="Not now"
        subtitle="Ask again in a couple of weeks"
        onPress={() => onDecide("not_now")}
        disabled={pending}
        testID="memory-suggestion-not-now"
      />
      <SheetRow
        icon="bell-off-outline"
        label="Never ask again"
        subtitle="for this project's goal"
        onPress={() => onDecide("never")}
        disabled={pending}
        last
        testID="memory-suggestion-never"
      />
      {error ? (
        <AppText
          variant="caption"
          tone="danger"
          className="mt-2"
          accessibilityRole="alert"
          testID="memory-suggestion-error"
        >
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

// --- the host --------------------------------------------------------------

function memoryRoute(id: string): Href {
  return `/memory/${encodeURIComponent(id)}` as Href;
}

/** Mounted ONCE, at the root. The leaf. */
export function MemorySuggestionSheetHost() {
  const current = useSyncExternalStore(
    subscribeMemorySuggestionSheet,
    getMemorySuggestionSheet,
    getMemorySuggestionSheet,
  );
  const router = useRouter();
  const decide = useDecideMemorySuggestion();

  const onDecide = (decision: MemorySuggestionDecision) => {
    const suggestion = current.suggestion;
    if (!suggestion) return;
    decide.mutate(
      {
        key: suggestion.key,
        body:
          decision === "remember" ? { decision, statement: suggestion.statement } : { decision },
      },
      {
        onSuccess: (result) => {
          closeMemorySuggestion();
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

  return (
    <BottomSheet
      open={current.visible}
      onClose={() => {
        decide.reset();
        closeMemorySuggestion();
      }}
      title="Remember this?"
      testID="memory-suggestion-sheet"
    >
      {current.suggestion ? (
        <MemorySuggestionSheetContent
          suggestion={current.suggestion}
          onDecide={onDecide}
          pending={decide.isPending}
          error={decide.isError ? "Couldn't save that answer. Try again." : null}
        />
      ) : null}
    </BottomSheet>
  );
}
