import type { AskPreset, AskResponse, AskSource, AskSourceSection } from "@personal-os/schema";
import type { ReactNode } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { ASK_PRESETS, type AskPresetDefinition } from "@/components/ask/ask-presets";
import { ChoiceChip } from "@/components/ask/choice-chip";
import { textFieldClass } from "@/components/ask/text-field";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import {
  AppText,
  Button,
  Card,
  Icon,
  ScreenFrame,
  SectionHeader,
  type IconName,
} from "@/components/ui";

// Cloud Ask's question/answer surface (Checkpoint 8.6B) -- a MODE inside the
// search screen, never a sixth tab or a third header icon: the search screen
// already carries the Search/Settings header actions this app's narrowest target (the
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
// library in this app's dependencies). Checkpoint 10.3 composed it on the
// design system's hookless primitives (Card, Button, AppText, Icon); every
// testID, label and state is unchanged.

export type AskState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "ready"; response: AskResponse }
  /**
   * Checkpoint 9.7: a preset was tapped while the cached Today response shows
   * nothing due, scheduled or waiting. Answered locally -- no request left the
   * device -- so the copy is fixed and there is nothing to cite.
   */
  | { kind: "nothing_today"; preset: AskPreset };

/** The fixed local answer for an empty day; never a model's words. */
export const ASK_NOTHING_TODAY_COPY = "Nothing is due, scheduled or waiting today.";
/**
 * The same answer for the "Summarize tomorrow" chip, whose window is the
 * seven-day horizon the empty-day check consults (upcoming days and cached
 * reminders), not today alone.
 */
export const ASK_NOTHING_UPCOMING_COPY = "Nothing is due or scheduled in the next 7 days.";

/** The local empty-day answer, keyed on WHICH chip asked -- fixed text, never a model's. */
export function askNothingCopyFor(preset: AskPreset): string {
  return preset === "tomorrow" ? ASK_NOTHING_UPCOMING_COPY : ASK_NOTHING_TODAY_COPY;
}

/** Shown above an answer the model wrote without a single `[n]`. */
export const ASK_NO_CITATIONS_COPY = "This answer cites nothing you can open.";

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
   * Checkpoint 9.7. A preset chip tap: the caller fills the input with the
   * preset's question and submits it with `scope: "today"` -- the ONE way a
   * chip ever sends anything (a `preset=` route param only pre-fills).
   */
  onSelectPreset: (preset: AskPresetDefinition) => void;
  /** Which chip the current question IS (byte-equal), or null for free text. */
  selectedPreset: AskPreset | null;
  /**
   * Whether the input grabs focus on mount. Off when the screen was opened
   * with a preset pre-filled: the keyboard would cover half of a 640px screen
   * for a question the owner did not intend to edit.
   */
  autoFocus: boolean;
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
  event: "Event",
  inbox_item: "Capture",
  project: "Project",
};

/**
 * The SERVER-authored section a source came from, as row copy (Checkpoint
 * 9.7). Rendered beside the citation so a ranking claim in the answer ("your
 * only overdue task") can be checked against the section the server put the
 * item in, without opening it -- the citation check only proves a ref exists,
 * never that the claim about it is true. `record` (a lexically matched note or
 * task) and an absent section (an 8.6B-shaped response) fall back to the type.
 */
const SOURCE_SECTION_LABEL: Record<Exclude<AskSourceSection, "record">, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  upcoming: "Upcoming",
  event: "Event",
  reminder: "Reminder",
  completed: "Completed",
  capture: "Capture",
  project: "Project",
  snoozed: "Snoozed",
};

export function askSourceLabel(source: AskSource): string {
  if (source.section === undefined || source.section === "record") {
    return SOURCE_TYPE_LABEL[source.type];
  }
  return SOURCE_SECTION_LABEL[source.section];
}

/**
 * `[n] <section> · <detail>` -- the row's one-line header, every piece
 * server-authored. `detail` arrives WITHOUT the section word (an overdue row's
 * detail is "P1", a snoozed row's "until …"); nothing here assumes otherwise.
 */
export function askSourceHeaderText(source: AskSource): string {
  const parts = [askSourceLabel(source)];
  if (source.detail !== undefined && source.detail.length > 0) parts.push(source.detail);
  return `[${source.ref}] ${parts.join(" · ")}`;
}

/** `[n] <section> · <detail> · <title>` -- the header and the user's own title, as one string. */
export function askSourceRowText(source: AskSource): string {
  return `${askSourceHeaderText(source)} · ${source.title}`;
}

export interface AskSourceRowProps {
  source: AskSource;
  onSelect: (source: AskSource) => void;
  /** The last row on its card draws no divider. */
  last?: boolean;
}

const SOURCE_TYPE_ICON: Record<AskSource["type"], IconName> = {
  task: "checkbox-marked-circle-outline",
  note: "note-text-outline",
  event: "calendar",
  inbox_item: "inbox-outline",
  project: "folder-outline",
};

// The hairline ListRow draws between rows on a card; this row is composed by
// hand because its two text lines carry testIDs the primitive cannot take.
const ROW_DIVIDER_CLASS = "border-b border-outline/70 dark:border-outline-dark";

export function AskSourceRow({ source, onSelect, last = false }: AskSourceRowProps) {
  return (
    <Pressable
      testID={`ask-source-${source.ref}`}
      onPress={() => onSelect(source)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${SOURCE_TYPE_LABEL[source.type].toLowerCase()}: ${source.title}`}
      hitSlop={8}
      className={`min-h-[52px] flex-row items-center gap-3 px-4 py-2.5 active:opacity-70 ${
        last ? "" : ROW_DIVIDER_CLASS
      }`}
    >
      <Icon name={SOURCE_TYPE_ICON[source.type]} size="md" tone="primary" />
      <View className="flex-1">
        {/* Header and title on separate lines (9.7 review): at 480px a single
            two-line Text cut the TITLE -- the one part the owner needs to
            recognise the item -- behind the server's section and detail. The
            accessibility label above still carries the full title. */}
        <AppText
          testID={`ask-source-${source.ref}-header`}
          variant="caption"
          tone="muted"
          numberOfLines={1}
        >
          {askSourceHeaderText(source)}
        </AppText>
        <AppText testID={`ask-source-${source.ref}-title`} variant="body-strong" numberOfLines={2}>
          {source.title}
        </AppText>
      </View>
      <Icon name="chevron-right" size="md" tone="on-surface-muted" />
    </Pressable>
  );
}

export interface AskPresetChipsProps {
  selected: AskPreset | null;
  disabled: boolean;
  onSelect: (preset: AskPresetDefinition) => void;
}

/**
 * The three "Ask about today" chips. Each tap is one explicit submission with
 * `scope: "today"`; the chip whose question is in the input reads as selected.
 * Rendered inside the ScrollView so they stay reachable on the Rabbit R1
 * (480×640) with the keyboard up -- see use-keyboard-height.ts.
 */
export function AskPresetChips({ selected, disabled, onSelect }: AskPresetChipsProps) {
  return (
    <View testID="ask-presets" className="flex-row flex-wrap gap-2 px-4 pb-2">
      {ASK_PRESETS.map((preset) => (
        <ChoiceChip
          key={preset.key}
          testID={`ask-preset-${preset.key}`}
          label={preset.label}
          selected={preset.key === selected}
          disabled={disabled}
          onPress={() => onSelect(preset)}
          accessibilityLabel={`Ask: ${preset.label}`}
        />
      ))}
    </View>
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
  onSelectPreset,
  selectedPreset,
  autoFocus,
  modeToggle,
}: AskViewProps) {
  const submitting = state.kind === "submitting";
  const submitDisabled = !canSubmit || submitting;

  return (
    <ScreenFrame>
      {modeToggle ?? null}

      {/* Chips, input, button and footer all live INSIDE the ScrollView
          (Checkpoint 9.7): on the Rabbit R1 the keyboard leaves ~240px of
          reachable screen, and a fixed header block would push the answer
          out of it entirely. keyboardShouldPersistTaps keeps the chips and
          the button tappable while the field is focused. */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight }}
      >
        <AskPresetChips selected={selectedPreset} disabled={submitting} onSelect={onSelectPreset} />

        <View className="px-4 pb-2 pt-1">
          <Card>
            <TextInput
              testID="ask-input"
              value={question}
              onChangeText={onQuestionChange}
              placeholder="Ask about today, your notes and tasks"
              placeholderTextColor={placeholderColor}
              autoFocus={autoFocus}
              autoCorrect={false}
              returnKeyType="send"
              onSubmitEditing={onSubmit}
              accessibilityLabel="Ask a question"
              className={textFieldClass()}
            />
            {/* `disabled`, not `busy`: the label while in flight has always
                read "Asking…", which `busy` would render as "Ask…". */}
            <Button
              testID="ask-submit"
              label={submitting ? "Asking…" : "Ask"}
              onPress={onSubmit}
              disabled={submitDisabled}
              accessibilityLabel="Ask"
              variant="primary"
              block
              className="mt-3"
            />

            {/* A passive reminder, always visible in Ask mode regardless of
              state -- not a dialog, and not repeated per question. The one-time
              enable disclosure in Settings already covers consent. */}
            <AppText testID="ask-footer" variant="caption" tone="muted" className="mt-2">
              {`Sends your question, today's schedule and matching notes/tasks to ${connectionName}`}
            </AppText>
          </Card>
        </View>

        {state.kind === "idle" ? (
          <AppText testID="ask-idle" variant="body" tone="secondary" className="px-4 py-4">
            Ask about today, or about your notes and tasks.
          </AppText>
        ) : state.kind === "nothing_today" ? (
          <View className="px-4 pt-2">
            <Card className="flex-row items-center gap-3">
              <Icon name="check-circle-outline" size="lg" tone="success" />
              <AppText testID="ask-nothing-today" variant="body" className="flex-1">
                {askNothingCopyFor(state.preset)}
              </AppText>
            </Card>
          </View>
        ) : state.kind === "submitting" ? (
          <View className="px-4 pt-2">
            <Card className="flex-row items-center gap-3">
              <Icon name="progress-clock" size="lg" tone="primary" />
              <AppText testID="ask-loading" variant="body" tone="secondary" className="flex-1">
                Asking…
              </AppText>
            </Card>
          </View>
        ) : state.kind === "error" ? (
          <View className="px-4 pt-2">
            <Card className="flex-row items-center gap-3">
              <Icon name="alert-circle-outline" size="lg" tone="danger" />
              <AppText testID="ask-error" variant="body" tone="danger" className="flex-1">
                {state.message}
              </AppText>
            </Card>
          </View>
        ) : (
          <View testID="ask-answer-container" className="px-4 pt-2">
            <Card>
              {state.response.citations_present === false ? (
                <AppText
                  testID="ask-no-citations"
                  variant="caption"
                  tone="warning"
                  className="pb-2"
                >
                  {ASK_NO_CITATIONS_COPY}
                </AppText>
              ) : null}
              <AppText testID="ask-answer" variant="body" className="leading-6">
                {state.response.answer}
              </AppText>
              {state.response.redactions > 0 ? (
                <AppText testID="ask-redactions" variant="caption" tone="warning" className="pt-2">
                  {`${state.response.redactions} secret-looking string${
                    state.response.redactions === 1 ? "" : "s"
                  } removed before sending.`}
                </AppText>
              ) : null}
            </Card>
            {state.response.sources.length > 0 ? (
              <View testID="ask-sources">
                <SectionHeader title="Sources" count={state.response.sources.length} />
                <Card padding="none">
                  {state.response.sources.map((source, index) => (
                    <AskSourceRow
                      key={source.ref}
                      source={source}
                      onSelect={onSelectSource}
                      last={index === state.response.sources.length - 1}
                    />
                  ))}
                </Card>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </ScreenFrame>
  );
}
