import type { SearchResponse, SearchResult } from "@personal-os/schema";
import { SEARCH_TYPE_LABELS } from "./search-navigation";

// Turning the API's flat result array into the rows a FlatList renders.
//
// The API already returns results grouped by type, in a fixed type order, with
// a defined order inside each group (SEARCH_RESULT_TYPE_ORDER). So this does
// NOT sort, and deliberately so: re-sorting client-side would create a second
// place the ordering rule lives, and the two would eventually disagree. It only
// inserts a heading each time the type changes, which is a faithful rendering
// of an order the server already fixed.

export type SearchRow =
  | {
      kind: "header";
      type: SearchResult["type"];
      label: string;
      /** How many are shown here. */
      returned: number;
      /** How many matched in total -- larger than `returned` when the cap bit. */
      total: number;
    }
  | { kind: "result"; result: SearchResult };

/** A stable key for FlatList. Headers and results cannot collide. */
export function searchRowKey(row: SearchRow): string {
  return row.kind === "header" ? `header:${row.type}` : `result:${row.result.id}`;
}

export function buildSearchRows(response: SearchResponse): SearchRow[] {
  const rows: SearchRow[] = [];
  let currentType: SearchResult["type"] | null = null;

  for (const result of response.results) {
    if (result.type !== currentType) {
      currentType = result.type;
      const counts = response.counts[result.type];
      rows.push({
        kind: "header",
        type: result.type,
        label: SEARCH_TYPE_LABELS[result.type],
        returned: counts.returned,
        total: counts.total,
      });
    }
    rows.push({ kind: "result", result });
  }

  return rows;
}

/** True when the response matched nothing at all. */
export function isEmptySearchResponse(response: SearchResponse): boolean {
  return response.results.length === 0;
}
