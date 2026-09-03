import { SEARCH_QUERY_MIN_CHARS } from "@personal-os/schema";
import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

/**
 * Runs a search once the query is long enough to be accepted.
 *
 * `enabled` mirrors the server's minimum rather than guessing at one: below it
 * the server replies 400, so issuing the request would turn "keep typing" into
 * a red error banner on the second keystroke of every search.
 *
 * The query key is the TRIMMED text, so "rent" and "rent " share one cache
 * entry instead of two -- the same normalization the server applies.
 */
export function useSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["search", trimmed],
    queryFn: () => api.search({ q: trimmed }),
    enabled: trimmed.length >= SEARCH_QUERY_MIN_CHARS,
    // A search is a point-in-time question; holding a stale answer for the
    // default 30s makes a just-created note look missing.
    staleTime: 0,
  });
}
