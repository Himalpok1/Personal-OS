import { SEARCH_QUERY_MIN_CHARS, type SearchResponse, type SearchResult } from "@personal-os/schema";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, SafeAreaView, Text, TextInput, View } from "react-native";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { useSearch } from "@/queries/search";
import { searchResultHref } from "@/utils/search-navigation";
import { buildSearchRows, searchRowKey, type SearchRow } from "@/utils/search-sections";

// Search across tasks, notes, inbox captures and mail metadata.
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
  inbox_item: "inbox capture",
  mail_message: "email",
};

export interface SearchResultRowProps {
  result: SearchResult;
  onSelect: (result: SearchResult) => void;
}

export function SearchResultRow({ result, onSelect }: SearchResultRowProps) {
  const href = searchResultHref(result);
  const sender = result.type === "mail_message" ? result.sender : null;
  const archived = "archived" in result && result.archived;

  const content = (
    <View className="flex-1">
      <Text className="text-base text-black dark:text-white" numberOfLines={2}>
        {result.title}
      </Text>
      {sender === null ? null : (
        <Text className="text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
          {sender}
        </Text>
      )}
      {result.preview === null ? null : (
        <Text className="text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={2}>
          {result.preview}
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
  return (
    <View className="bg-neutral-100 px-4 py-2 dark:bg-neutral-900">
      <Text className="text-sm font-semibold uppercase text-neutral-500 dark:text-neutral-400">
        {row.total > row.returned
          ? `${row.label} (${row.returned} of ${row.total})`
          : `${row.label} (${row.returned})`}
      </Text>
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
}

export function SearchView({
  query,
  onQueryChange,
  state,
  onSelectResult,
  onRetry,
  placeholderColor,
  keyboardHeight,
}: SearchViewProps) {
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View className="px-4 pb-2 pt-3">
        <TextInput
          testID="search-input"
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search tasks, notes, inbox, mail"
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
        <Text testID="search-empty" className="p-4 text-neutral-500">
          No matches.
        </Text>
      ) : (
        <FlatList
          testID="search-results"
          data={buildSearchRows(state.response)}
          keyExtractor={searchRowKey}
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

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const router = useRouter();
  const placeholderColor = usePlaceholderColor();
  const keyboardHeight = useKeyboardHeight();
  const { data, isError, refetch } = useSearch(query);

  const enabled = query.trim().length >= SEARCH_QUERY_MIN_CHARS;
  // `data` rather than `isLoading` is what decides between loading and ready:
  // TanStack keeps the previous query's data while a new one is in flight, so
  // keying off it lets the list stay on screen between keystrokes instead of
  // flashing back to "Searching..." on every character.
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
    />
  );
}
