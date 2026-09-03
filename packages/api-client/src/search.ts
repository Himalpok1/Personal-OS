import { SearchResponseSchema, type SearchResponse } from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

export type { SearchResponse };

// Client-side params, not the server's SearchQuerySchema -- that schema parses
// a raw querystring (limit arrives as a string, include_archived as "true"),
// and is not the right shape for constructing a request from JS values.
// `buildQuery` serializes these back into the wire format the server expects.
export interface SearchParams {
  q: string;
  /** Per-type cap, not a total. Omit for the server's default. */
  limit?: number;
  include_archived?: boolean;
}

/**
 * Values are passed to `buildQuery` RAW. It runs them through
 * `URLSearchParams`, which percent-encodes already; pre-encoding here would
 * double-escape a query containing `%`, `&` or `+` -- exactly the characters a
 * search box invites.
 */
export async function search(baseUrl: string, params: SearchParams): Promise<SearchResponse> {
  return fetchJson(baseUrl, `/search${buildQuery(params)}`, SearchResponseSchema);
}
