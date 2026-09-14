import { SEARCH_QUERY_MIN_CHARS } from "@personal-os/schema";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from "@/utils/use-debounced-value";
import { api } from "./client";
import { deviceTimezone } from "./today";

/**
 * Runs a search once the query is long enough to be accepted, and has
 * settled for SEARCH_DEBOUNCE_MS.
 *
 * `enabled` mirrors the server's minimum rather than guessing at one: below it
 * the server replies 400, so issuing the request would turn "keep typing" into
 * a red error banner on the second keystroke of every search.
 *
 * The query key is the TRIMMED, DEBOUNCED text, so "rent" and "rent " share
 * one cache entry instead of two -- the same normalization the server applies
 * -- and a keystroke that is typed over within the settle window never becomes
 * a request at all.
 *
 * `tz` is the device zone from the same helper Today uses (Checkpoint 9.6,
 * ADR-065). It is what lets the server read "september" or "tomorrow" as a
 * date window in the user's own calendar rather than as plain text; the
 * server deliberately has no default, so omitting it would silently turn the
 * date grammar off.
 */
/**
 * True when the response on screen may not be the answer to what is typed:
 * the debounce has not caught up with the field, the list is the PREVIOUS
 * query's (`keepPreviousData`), or a request is still in flight. The screen
 * shows an "Updating..." line while this holds and withholds the previous
 * response's match-mode banner and date chip, which describe a different
 * query and would otherwise read as facts about this one.
 */
export function isSearchResponseStale(args: {
  typed: string;
  debounced: string;
  isPlaceholderData: boolean;
  isFetching: boolean;
}): boolean {
  return args.typed.trim() !== args.debounced || args.isPlaceholderData || args.isFetching;
}

export function useSearch(query: string) {
  const trimmed = query.trim();
  const debouncedQuery = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  const result = useQuery({
    queryKey: ["search", debouncedQuery],
    queryFn: () => api.search({ q: debouncedQuery, tz: deviceTimezone() }),
    enabled: debouncedQuery.length >= SEARCH_QUERY_MIN_CHARS,
    // A search is a point-in-time question; holding a stale answer for the
    // default 30s makes a just-created note look missing.
    staleTime: 0,
    // Keep the previous query's list on screen while the next one is in
    // flight, so refining a search does not flash back to "Searching..." on
    // every settled keystroke.
    placeholderData: keepPreviousData,
  });
  return {
    ...result,
    stale: isSearchResponseStale({
      typed: trimmed,
      debounced: debouncedQuery,
      isPlaceholderData: result.isPlaceholderData,
      isFetching: result.isFetching,
    }),
  };
}
