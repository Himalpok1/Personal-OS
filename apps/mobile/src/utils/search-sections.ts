import {
  SEARCH_RESULT_TYPE_ORDER,
  type SearchResponse,
  type SearchResult,
} from "@personal-os/schema";
import { SEARCH_TYPE_LABELS } from "./search-navigation";

// Turning the API's flat result array into the rows a FlatList renders.
//
// Since Checkpoint 9.6 the API returns ONE list in score order across types
// (`compareScored`: score desc, timestamp desc, type order, id asc). The
// screen shows the head of that list as "Top matches" -- the best few whatever
// their type, each wearing a type chip -- and then the REST, grouped by type in
// SEARCH_RESULT_TYPE_ORDER. So this PARTITIONS, and deliberately never sorts:
// a client-side sort would be a second place the ranking rule lives, and the
// two would eventually disagree. Within every section the relative order is
// exactly the order the server sent.
//
// Section headers carry THREE numbers, and the distinction matters. `shown`
// is how many rows sit under the header -- the type's results that did NOT
// make "Top matches" -- while `returned` / `total` are the server's per-type
// counts, which is how a hidden cap stays visible (ADR-059 §2). They are not
// the same thing: with six mail results of which five are in Top matches, the
// header sits over ONE row, and a header reading "Mail (6 of 298)" over it
// would be a lie about the rows beneath. The screen renders
// "Mail (1 more · 6 of 298 matched)".

/** How many results the mixed "Top matches" section takes from the head of the list. */
export const SEARCH_TOP_MATCHES_MAX = 5;

/** The heading of the mixed section, exported so the screen test can pin it. */
export const SEARCH_TOP_MATCHES_LABEL = "Top matches";

export type SearchRow =
  | {
      kind: "header";
      /** `null` for the mixed "Top matches" section. */
      type: SearchResult["type"] | null;
      label: string;
      /** How many result rows sit directly under this header. */
      shown: number;
      /**
       * How many of this type the server returned in the whole response --
       * including any that went into "Top matches". Equals `shown` for the
       * mixed section.
       */
      returned: number;
      /** How many matched in total -- larger than `returned` when the cap bit. */
      total: number;
    }
  | { kind: "result"; result: SearchResult; section: "top" | "type" };

/**
 * A stable key for FlatList. Headers and results cannot collide, and a result
 * can only ever appear in one section, so its id alone is unique.
 */
export function searchRowKey(row: SearchRow): string {
  if (row.kind === "header") return row.type === null ? "header:top" : `header:${row.type}`;
  return `result:${row.result.id}`;
}

export function buildSearchRows(response: SearchResponse): SearchRow[] {
  const { results } = response;
  if (results.length === 0) return [];

  const rows: SearchRow[] = [];

  // Section 1: the best few, in server order, whatever their type.
  const topCount = Math.min(SEARCH_TOP_MATCHES_MAX, results.length);
  const top = results.slice(0, topCount);
  rows.push({
    kind: "header",
    type: null,
    label: SEARCH_TOP_MATCHES_LABEL,
    shown: topCount,
    returned: topCount,
    total: topCount,
  });
  for (const result of top) rows.push({ kind: "result", result, section: "top" });

  // Section 2..n: everything that did not make the top, grouped by type in the
  // canonical order. A type with nothing left over gets no header, and the
  // remaining results keep the relative order they arrived in.
  const remaining = results.slice(topCount);
  for (const type of SEARCH_RESULT_TYPE_ORDER) {
    const ofType = remaining.filter((result) => result.type === type);
    if (ofType.length === 0) continue;
    const counts = response.counts[type];
    rows.push({
      kind: "header",
      type,
      label: SEARCH_TYPE_LABELS[type],
      shown: ofType.length,
      returned: counts.returned,
      total: counts.total,
    });
    for (const result of ofType) rows.push({ kind: "result", result, section: "type" });
  }

  return rows;
}

/** True when the response matched nothing at all. */
export function isEmptySearchResponse(response: SearchResponse): boolean {
  return response.results.length === 0;
}
