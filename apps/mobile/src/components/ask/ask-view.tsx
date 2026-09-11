import type { AskResponse, AskSource } from "@personal-os/schema";
import type { ReactNode } from "react";
import { Pressable, ScrollView, SafeAreaView, Text, TextInput, View } from "react-native";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";

// Cloud Ask's question/answer surface (Checkpoint 8.6B) -- a MODE inside the
// search screen, never a sixth tab or a third header icon: the search screen
// already carries the header 🔍/⚙️ actions this app's narrowest target (the
// Rabbit R1's 480px bar) has room for. See `mode-toggle.tsx` for the control
// that switches into this mode.
//
// ===========================================================================
// EVERY STRING HERE IS RENDERED AS INERT TEXT -- SAME RULE AS search/index.tsx
// ===========================================================================
//
// The model's own answer is attacker-INFLUENCEABLE prose (ADR-058's
// injection-laundering concern applies to Ask exactly as it does to the mail
// digest and the Daily Brief -- the context it was grounded in is the user's
// own stored text, but the model's output is still not first-party text), and
// a source's title is the user's own stored text echoed back verbatim. Both
// land in a plain <Text>, which interprets no markup and detects no links
// unless `dataDetectorTypes` is set -- which it is not, here or anywhere in
// this app. There is no WebView, no autolink and no Linking call on this
// screen.
//
// Navigation is derived ONLY by `askSourceHref` (utils/ask-navigation.ts),
// which reads the server-authored `type` and uuid on an `AskSource` -- never
// from `answer` or `title` -- mirroring search-navigation.ts's rule for the
// identical reason.
//
// Hookless and props-driven, same convention as `SearchView`: that is what
// makes it testable by calling it as a plain function (there is no render
// library in this app's dependencies).

export type AskState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "ready"; response: AskResponse };

export interface AskViewProps {
  question: string;
  onQuestionChange: (value: string) => void;
  state: AskState;
  onSubmit: () => void;
  onSelectSource: (source: AskSource) => void;
  /** The "ask" task route's `connection_name` -- who receives the question. */
  connectionName: string;
  /** Whether the question is long enough to submit; gates the button, not the field. */
  canSubmit: boolean;
  placeholderColor: string;
  keyboardHeight: number;
  /**
   * The Search/Ask segmented toggle, built by the caller and rendered above
   * the input. Optional, and rendered as nothing when omitted -- the
   * mechanism that lets the screen hide the whole affordance when Cloud Ask
   * is off, by simply never passing it.
   */
  modeToggle?: ReactNode;
}

const SOURCE_TYPE_LABEL: Record<AskSource["type"], string> = {
  task: "Task",
  note: "Note",
};

export interface AskSourceRowProps {
  source: AskSource;
  onSelect: (source: AskSource) => void;
}

export function AskSourceRow({ source, onSelect }: AskSourceRowProps) {
  return (
    <Pressable
      testID={`ask-source-${source.ref}`}
      onPress={() => onSelect(source)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${SOURCE_TYPE_LABEL[source.type].toLowerCase()}: ${source.title}`}
      hitSlop={8}
      className="min-h-[44px] flex-row items-center border-b border-neutral-200 px-4 py-3 active:opacity-70 dark:border-neutral-800"
    >
      <Text className="flex-1 text-sm text-black dark:text-white" numberOfLines={2}>
        {`[${source.ref}] ${SOURCE_TYPE_LABEL[source.type]} · ${source.title}`}
      </Text>
    </Pressable>
  );
}

export function AskView({
  question,
  onQuestionChange,
  state,
  onSubmit,
  onSelectSource,
  connectionName,
  canSubmit,
  placeholderColor,
  keyboardHeight,
  modeToggle,
}: AskViewProps) {
  const submitting = state.kind === "submitting";
  const submitDisabled = !canSubmit || submitting;

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      {modeToggle ?? null}

      <View className="px-4 pb-2 pt-1">
        <TextInput
          testID="ask-input"
          value={question}
          onChangeText={onQuestionChange}
          placeholder="Ask about your notes and tasks"
          placeholderTextColor={placeholderColor}
          autoCorrect={false}
          returnKeyType="send"
          onSubmitEditing={onSubmit}
          accessibilityLabel="Ask a question"
          className="rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
        />
        <Pressable
          testID="ask-submit"
          onPress={onSubmit}
          disabled={submitDisabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: submitDisabled }}
          accessibilityLabel="Ask"
          hitSlop={8}
          className={`mt-2 min-h-[44px] items-center justify-center rounded-lg px-4 py-2 active:opacity-70 ${
            submitDisabled ? "bg-neutral-200 dark:bg-neutral-800" : "bg-blue-600"
          }`}
        >
          <Text
            className={`text-sm font-semibold ${
              submitDisabled ? "text-neutral-500 dark:text-neutral-400" : "text-white"
            }`}
          >
            {submitting ? "Asking…" : "Ask"}
          </Text>
        </Pressable>

        {/* A passive reminder, always visible in Ask mode regardless of
            state -- not a dialog, and not repeated per question. The one-time
            enable disclosure in Settings already covers consent. */}
        <Text testID="ask-footer" className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          {`Sends matching notes and tasks to ${connectionName}.`}
        </Text>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight }}
      >
        {state.kind === "idle" ? (
          <Text testID="ask-idle" className="p-4 text-neutral-500">
            Ask a question about your notes and tasks.
          </Text>
        ) : state.kind === "submitting" ? (
          <Text testID="ask-loading" className="p-4 text-neutral-500">
            Asking…
          </Text>
        ) : state.kind === "error" ? (
          <Text testID="ask-error" className="p-4 text-red-600">
            {state.message}
          </Text>
        ) : (
          <View testID="ask-answer-container">
            <Text testID="ask-answer" className="px-4 pb-2 text-base leading-6 text-black dark:text-white">
              {state.response.answer}
            </Text>
            {state.response.redactions > 0 ? (
              <Text
                testID="ask-redactions"
                className="px-4 pb-2 text-xs text-amber-700 dark:text-amber-300"
              >
                {`${state.response.redactions} secret-looking string${
                  state.response.redactions === 1 ? "" : "s"
                } removed before sending.`}
              </Text>
            ) : null}
            {state.response.sources.length > 0 ? (
              <View testID="ask-sources">
                <Text className="px-4 pb-1 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
                  Sources
                </Text>
                {state.response.sources.map((source) => (
                  <AskSourceRow key={source.ref} source={source} onSelect={onSelectSource} />
                ))}
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
