import {
  ASK_QUESTION_MIN_CHARS,
  SEARCH_QUERY_MIN_CHARS,
  type AskPreset,
  type SearchResponse,
  type SearchResult,
} from "@personal-os/schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { FlatList, Pressable, SafeAreaView, Text, TextInput, View } from "react-native";
import { planAskSubmission } from "@/components/ask/empty-day";
import { AskView, type AskState } from "@/components/ask/ask-view";
import { askErrorMessage } from "@/components/ask/ask-errors";
import { askPresetOf, findAskPreset } from "@/components/ask/ask-presets";
import { AskModeToggle, type SearchAskMode } from "@/components/ask/mode-toggle";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { useAskCloud, useAskEnabled } from "@/queries/ask";
import { useCachedReminders } from "@/queries/reminders";
import { useSearch } from "@/queries/search";
import { useToday } from "@/queries/today";
import { askSourceHref } from "@/utils/ask-navigation";
import {
  searchDateFilterChip,
  searchEventDateLine,
  searchIgnoredTokensLine,
  searchMatchModeBanner,
  searchProjectStatusLine,
  searchTaskStatusLine,
  SEARCH_EXTERNAL_EVENT_COPY,
} from "@/utils/search-labels";
import { SEARCH_TYPE_CHIP_LABELS, searchResultHref } from "@/utils/search-navigation";
import { buildSearchRows, searchRowKey, type SearchRow } from "@/utils/search-sections";

// Search across tasks, notes, events, projects, inbox captures and mail
// metadata (Checkpoint 9.6 widened the domain from four types to six).
//
// ===========================================================================
// EVERY RESULT STRING IS RENDERED AS INERT TEXT
// ===========================================================================
//
// Titles, previews and sender names all go into React Native's <Text>, which
// performs no markdown interpretation, no HTML interpretation, and no link
// detection unless `dataDetectorTypes` is set -- which it is not, here or
// anywhere in this app. There is no WebView, no autolink and no Linking call on
// this screen. A URL inside a mail subject is therefore characters on a screen,
// not a destination.
//
// Where a tap GOES is decided by `searchResultHref`, which reads only the
// server-authored `type` and uuid fields. No attacker-authored string can
// influence navigation.
//
// The view and the row are exported hookless so they can be unit-tested by
// calling them as plain functions, which is how every render-style test in this
// app works (there is no render library in its dependencies).

const TYPE_ACCESSIBILITY: Record<SearchResult["type"], string> = {
  task: "task",
  note: "note",
  event: "event",
  project: "project",
  inbox_item: "inbox capture",
  mail_message: "email",
};

export interface SearchResultRowProps {
  result: SearchResult;
  onSelect: (result: SearchResult) => void;
}

/**
 * The per-type secondary lines, computed once so the JSX below is a flat list
 * of "if present, show it". Every value is a server-authored token or a
 * formatted date -- never a route -- and every one lands in a <Text>.
 */
function resultLines(result: SearchResult): {
  sender: string | null;
  date: string | null;
  status: string | null;
  external: boolean;
} {
  switch (result.type) {
    case "mail_message":
      return { sender: result.sender, date: null, status: null, external: false };
    case "event":
      return {
        sender: null,
        date: searchEventDateLine(result),
        status: null,
        external: result.origin === "external",
      };
    case "task":
      return { sender: null, date: null, status: searchTaskStatusLine(result), external: false };
    case "project":
      return {
        sender: null,
        date: null,
        status: searchProjectStatusLine(result),
        external: false,
      };
    case "note":
    case "inbox_item":
      return { sender: null, date: null, status: null, external: false };
  }
}

export function SearchResultRow({ result, onSelect }: SearchResultRowProps) {
  const href = searchResultHref(result);
  const { sender, date, status, external } = resultLines(result);
  const archived = "archived" in result && result.archived;

  const content = (
    <View className="flex-1">
      {/* The type chip is what keeps a mixed "Top matches" section legible on
          a 480px screen: a task and a mail subject with the same words are
          told apart by the chip, not by guessing from the preview. */}
      <Text
        testID="search-result-chip"
        className="self-start rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
      >
        {SEARCH_TYPE_CHIP_LABELS[result.type]}
      </Text>
      <Text className="text-base text-black dark:text-white" numberOfLines={2}>
        {result.title}
      </Text>
      {sender === null ? null : (
        <Text className="text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
          {sender}
        </Text>
      )}
      {date === null ? null : (
        <Text
          testID="search-result-date"
          className="text-xs text-neutral-500 dark:text-neutral-400"
          numberOfLines={1}
        >
          {date}
        </Text>
      )}
      {result.preview === null ? null : (
        <Text className="text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={2}>
          {result.preview}
        </Text>
      )}
      {external ? (
        <Text testID="search-result-external" className="text-xs text-neutral-400">
          {SEARCH_EXTERNAL_EVENT_COPY}
        </Text>
      ) : null}
      {status === null ? null : (
        <Text testID="search-result-status" className="text-xs text-neutral-400">
          {status}
        </Text>
      )}
      {archived ? <Text className="text-xs text-neutral-400">Archived</Text> : null}
    </View>
  );

  // A mail result has nowhere to go -- no per-message screen exists and the app
  // may never act on mail (ADR-052). Rendering it as a plain View rather than a
  // dead Pressable is the honest option: nothing invites a tap that does
  // nothing.
  if (href === null) {
    return (
      <View
        testID={`search-result-${result.id}`}
        className="flex-row items-center border-b border-neutral-200 px-4 py-3 dark:border-neutral-800"
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={`search-result-${result.id}`}
      onPress={() => onSelect(result)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${TYPE_ACCESSIBILITY[result.type]}: ${result.title}`}
      className="min-h-[44px] flex-row items-center border-b border-neutral-200 px-4 py-3 active:opacity-70 dark:border-neutral-800"
    >
      {content}
    </Pressable>
  );
}

function SearchSectionHeader({ row }: { row: Extract<SearchRow, { kind: "header" }> }) {
  // The mixed section is a fixed-size head of the list, so a count on it
  // would only restate its length. A per-type section holds only what did NOT
  // make Top matches, so its first number is the rows actually under it
  // ("3 more"); when the server capped that type, the honest returned/total
  // follows so the cap is visible ("Mail (1 more · 6 of 298 matched)").
  const label =
    row.type === null
      ? row.label
      : row.total === row.returned
        ? `${row.label} (${row.shown} more)`
        : `${row.label} (${row.shown} more · ${row.returned} of ${row.total} matched)`;
  return (
    <View className="bg-neutral-100 px-4 py-2 dark:bg-neutral-900">
      <Text
        accessibilityRole="header"
        className="text-sm font-semibold uppercase text-neutral-500 dark:text-neutral-400"
      >
        {label}
      </Text>
    </View>
  );
}

/** The one-line notice that the list on screen is not yet the answer to the typed query. */
const SEARCH_UPDATING_COPY = "Updating…";

/**
 * The two lines that explain a result set before the list: which rung of the
 * matching ladder produced it, and which date window (if any) was applied.
 * Both are server-authored tokens turned into fixed copy; nothing typed by
 * the user or stored in a row is echoed here.
 */
function SearchResultNotes({ response, stale }: { response: SearchResponse; stale: boolean }) {
  // While the response is stale it belongs to a DIFFERENT query than the one
  // typed (or is being replaced), so its banner and chip are withheld: "No
  // exact matches" about the previous query, shown under the current one,
  // would be read as a fact about the current one.
  const banner = stale ? null : searchMatchModeBanner(response.match_mode);
  const chip = stale ? null : searchDateFilterChip(response.date_filter);
  // Query tokens the server dropped past its cap -- the user's own words, so
  // echoing them names exactly what was not searched for.
  const ignored = stale ? null : searchIgnoredTokensLine(response.dropped);
  if (!stale && banner === null && chip === null && ignored === null) return null;
  return (
    <View className="gap-2 px-4 pb-2">
      {stale ? (
        <Text testID="search-updating" className="text-xs text-neutral-500 dark:text-neutral-400">
          {SEARCH_UPDATING_COPY}
        </Text>
      ) : null}
      {banner === null ? null : (
        <Text testID="search-match-banner" className="text-xs text-amber-700 dark:text-amber-400">
          {banner}
        </Text>
      )}
      {chip === null ? null : (
        <Text
          testID="search-date-chip"
          className="self-start rounded-full bg-neutral-200 px-3 py-1 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
        >
          {chip}
        </Text>
      )}
      {ignored === null ? null : (
        <Text testID="search-ignored" className="text-xs text-neutral-500 dark:text-neutral-400">
          {ignored}
        </Text>
      )}
    </View>
  );
}

export type SearchViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; response: SearchResponse };

export interface SearchViewProps {
  query: string;
  onQueryChange: (value: string) => void;
  state: SearchViewState;
  onSelectResult: (result: SearchResult) => void;
  onRetry: () => void;
  placeholderColor: string;
  keyboardHeight: number;
  /**
   * True while the `ready` response may not answer the typed query -- the
   * debounce has not caught up, the list is the previous query's, or a
   * request is in flight (`isSearchResponseStale`). Optional and additive:
   * omitted means "current".
   */
  stale?: boolean;
  /**
   * The Search/Ask segmented toggle (Checkpoint 8.6B), built by the caller
   * and rendered above the input. Optional and additive: every existing
   * caller omits it, in which case nothing renders here and this view's
   * behavior is exactly what it was before Cloud Ask existed -- this is the
   * mechanism that hides the Ask affordance entirely when it is disabled,
   * rather than merely disabling it.
   */
  modeToggle?: ReactNode;
}

export function SearchView({
  query,
  onQueryChange,
  state,
  onSelectResult,
  onRetry,
  placeholderColor,
  keyboardHeight,
  stale = false,
  modeToggle,
}: SearchViewProps) {
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      {modeToggle ?? null}
      <View className="px-4 pb-2 pt-3">
        <TextInput
          testID="search-input"
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search tasks, notes, events, projects, inbox, mail"
          placeholderTextColor={placeholderColor}
          // Focused on mount so the Rabbit's keyboard is up and the field is
          // ready without a second tap on a 480px screen.
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Search query"
          className="rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
        />
      </View>

      {state.kind === "idle" ? (
        <Text testID="search-idle" className="p-4 text-neutral-500">
          Type at least {SEARCH_QUERY_MIN_CHARS} characters to search.
        </Text>
      ) : state.kind === "loading" ? (
        <Text testID="search-loading" className="p-4 text-neutral-500">
          Searching...
        </Text>
      ) : state.kind === "error" ? (
        <View testID="search-error" className="flex-1 items-center justify-center gap-3 p-4">
          <Text className="text-red-600">Couldn&apos;t run that search.</Text>
          <Pressable
            testID="search-retry"
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry search"
            hitSlop={8}
            className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="font-semibold text-white">Retry</Text>
          </Pressable>
        </View>
      ) : state.response.results.length === 0 ? (
        <View testID="search-empty" className="p-4">
          <SearchResultNotes response={state.response} stale={stale} />
          {/* "No matches." is a statement about the typed query; while the
              empty response is a previous query's it is withheld. */}
          {stale ? null : <Text className="text-neutral-500">No matches.</Text>}
        </View>
      ) : (
        <FlatList
          testID="search-results"
          data={buildSearchRows(state.response)}
          keyExtractor={searchRowKey}
          ListHeaderComponent={<SearchResultNotes response={state.response} stale={stale} />}
          renderItem={({ item }) =>
            item.kind === "header" ? (
              <SearchSectionHeader row={item} />
            ) : (
              <SearchResultRow result={item.result} onSelect={onSelectResult} />
            )
          }
          keyboardShouldPersistTaps="handled"
          // FLOATING_CLEARANCE_PX plus the keyboard, in contentContainerStyle
          // rather than contentContainerClassName -- the keyboard height is a
          // runtime number, and floating-layout.ts records why the two must not
          // be mixed on one container.
          contentContainerStyle={{ paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight }}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * The route params a deep link may carry (Checkpoint 9.7): Today's "Ask about
 * today" chip pushes `/search?mode=ask&preset=focus`. A `preset=` ONLY selects
 * that chip and pre-fills its question; NOTHING is submitted without a tap --
 * this screen has no effect that submits, and `search-screen.test.tsx` mounts
 * it with the param and proves `api.askCloud` is never called.
 */
export default function SearchScreen() {
  const params = useLocalSearchParams<{ mode?: string; preset?: string }>();
  const initialPreset = findAskPreset(params.preset);
  const [query, setQuery] = useState("");
  const [question, setQuestion] = useState(initialPreset?.question ?? "");
  const [mode, setMode] = useState<SearchAskMode>(
    params.mode === "ask" || initialPreset !== null ? "ask" : "search",
  );
  // The empty-day short-circuit's own state: WHICH preset was answered locally
  // (no request left; the copy is keyed on it) and that answer is what the
  // screen shows until the next submission. Not a mutation result, so it
  // cannot live in `askMutation`.
  const [answeredLocally, setAnsweredLocally] = useState<AskPreset | null>(null);
  // In-flight guard for `submit` (9.7 review): `askMutation.isPending` is a
  // render-time snapshot, so two sends inside one tick -- the keyboard's send
  // key is never disabled -- would both read it as false and re-transmit the
  // question and its matching bodies. The ref is set the moment a request is
  // handed to the mutation and cleared when that request settles.
  const askInFlight = useRef(false);
  const router = useRouter();
  const placeholderColor = usePlaceholderColor();
  const keyboardHeight = useKeyboardHeight();
  const { data, isError, refetch, stale } = useSearch(query);
  const askEnabled = useAskEnabled();
  const askMutation = useAskCloud();
  // The `/today` the owner already loaded, consulted for the empty-day
  // short-circuit. Same query key Today renders from, so the warm cache is
  // read first -- but this IS a live `useQuery` (30 s staleTime), and it will
  // refetch on mount or focus once that cache is stale; it is not free. The
  // reminders view beside it is cache-only and never fetches.
  const today = useToday();
  const reminders = useCachedReminders();

  // Ask is a MODE inside this screen, never a sixth tab or a third header
  // icon -- and it is HIDDEN, not merely disabled, whenever the "ask" task
  // route does not exist. If Cloud Ask is switched off elsewhere (or a
  // `cloud_ask_disabled` response from `useAskCloud` just invalidated this
  // query) the toggle disappears and this falls back to "search" on its own,
  // with no effect needed to reset local state.
  const effectiveMode: SearchAskMode = askEnabled.enabled ? mode : "search";
  const modeToggle = askEnabled.enabled ? <AskModeToggle mode={mode} onChange={setMode} /> : null;

  if (effectiveMode === "ask") {
    const trimmedQuestion = question.trim();
    const canSubmit = trimmedQuestion.length >= ASK_QUESTION_MIN_CHARS;
    // A chip is "selected" exactly when the input holds its question,
    // byte-for-byte -- the same match the server applies. Editing one
    // character turns the submission back into free text.
    const selectedPreset = askPresetOf(trimmedQuestion);

    const askState: AskState = askMutation.isPending
      ? { kind: "submitting" }
      : answeredLocally !== null
        ? { kind: "nothing_today", preset: answeredLocally }
        : askMutation.isError
          ? { kind: "error", message: askErrorMessage(askMutation.error) }
          : askMutation.data
            ? { kind: "ready", response: askMutation.data }
            : { kind: "idle" };

    // THE ONE PLACE A QUESTION IS SUBMITTED. Called only from a tap (the Ask
    // button, the keyboard's send key, or a preset chip) -- never from an
    // effect or from mount, which is what keeps `preset=` a pre-fill and not
    // a request. A preset goes out with `scope: "today"` (no note/task body
    // is selected server-side for it); free text with `scope: "both"`. A
    // preset on an empty day is answered here, locally, and sends nothing.
    const submit = (text: string) => {
      if (askMutation.isPending || askInFlight.current) return;
      const trimmed = text.trim();
      if (trimmed.length < ASK_QUESTION_MIN_CHARS) return;
      const plan = planAskSubmission(
        trimmed,
        today.data,
        (q) => askPresetOf(q)?.key ?? null,
        reminders.data,
      );
      if (plan.kind === "nothing_today") {
        askMutation.reset();
        setAnsweredLocally(plan.preset);
        return;
      }
      setAnsweredLocally(null);
      askInFlight.current = true;
      askMutation.mutate(
        { question: plan.question, scope: plan.scope },
        {
          onSettled: () => {
            askInFlight.current = false;
          },
        },
      );
    };

    return (
      <AskView
        question={question}
        onQuestionChange={setQuestion}
        state={askState}
        canSubmit={canSubmit}
        onSubmit={() => submit(question)}
        onSelectPreset={(preset) => {
          setQuestion(preset.question);
          submit(preset.question);
        }}
        selectedPreset={selectedPreset?.key ?? null}
        // Opened from a deep link with a preset pre-filled: leave the keyboard
        // down -- it would cover half of a 640px screen for a question the
        // owner did not come here to edit.
        // Recorded debt (9.7 review): on a COLD deep link the params can read
        // empty for a frame while routes load, so the keyboard may flash up.
        autoFocus={initialPreset === null}
        onSelectSource={(source) => router.push(askSourceHref(source))}
        connectionName={askEnabled.route?.connection_name ?? ""}
        placeholderColor={placeholderColor}
        keyboardHeight={keyboardHeight}
        modeToggle={modeToggle}
      />
    );
  }

  const enabled = query.trim().length >= SEARCH_QUERY_MIN_CHARS;
  // `data` rather than `isLoading` is what decides between loading and ready:
  // the query keeps the previous search's data while the next one is in
  // flight (`keepPreviousData`), so keying off it lets the list stay on screen
  // between settled keystrokes instead of flashing back to "Searching..." on
  // every character. While the debounce has not yet caught up with the typed
  // text there is nothing in flight and no data for it, and `data` is the
  // previous list or undefined -- both of which read correctly here.
  const state: SearchViewState = !enabled
    ? { kind: "idle" }
    : isError
      ? { kind: "error" }
      : data === undefined
        ? { kind: "loading" }
        : { kind: "ready", response: data };

  return (
    <SearchView
      query={query}
      onQueryChange={setQuery}
      state={state}
      onSelectResult={(result) => {
        const href = searchResultHref(result);
        if (href !== null) router.push(href);
      }}
      onRetry={() => void refetch()}
      placeholderColor={placeholderColor}
      keyboardHeight={keyboardHeight}
      stale={stale}
      modeToggle={modeToggle}
    />
  );
}
