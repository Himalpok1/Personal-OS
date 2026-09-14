import {
  ItemContextSchema,
  SearchResponseSchema,
  type ItemContext,
  type ItemRef,
  type SearchResponse,
  type SearchResultType,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

export type { ItemContext, ItemRef, SearchResponse };

// Client-side params, not the server's SearchQuerySchema -- that schema parses
// a raw querystring (limit arrives as a string, include_archived as "true",
// types as a comma-separated list), and is not the right shape for
// constructing a request from JS values. `buildQuery` serializes these back
// into the wire format the server expects (an array becomes "a,b").
export interface SearchParams {
  q: string;
  /** Per-type cap, not a total. Omit for the server's default. */
  limit?: number;
  include_archived?: boolean;
  /** Subset of result types. Omit for all six. */
  types?: SearchResultType[];
  /**
   * The device's IANA zone. Without it the server recognises no date token
   * ("september" is plain text) and `date_filter` is always null -- send it
   * from the same helper Today uses, never a guess.
   */
  tz?: string;
  /** `score` (default, interleaved) or `type` (grouped in SEARCH_RESULT_TYPE_ORDER). */
  order?: "score" | "type";
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

/** `GET /search/item?type=&id=` -- one item's bounded context; 404 → ApiClientError("not_found"). */
export async function getSearchItemContext(baseUrl: string, ref: ItemRef): Promise<ItemContext> {
  return fetchJson(baseUrl, `/search/item${buildQuery(ref)}`, ItemContextSchema);
}
