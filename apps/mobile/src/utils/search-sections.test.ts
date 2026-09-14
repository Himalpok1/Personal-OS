import type { SearchResponse, SearchResult } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  buildSearchRows,
  isEmptySearchResponse,
  searchRowKey,
  SEARCH_TOP_MATCHES_LABEL,
  SEARCH_TOP_MATCHES_MAX,
} from "./search-sections";

const base = {
  preview: null,
  timestamp: "2026-08-01T00:00:00.000Z",
  score: 0,
  match: { reasons: [], fields: [] },
};

function result(type: SearchResult["type"], id: string, title: string): SearchResult {
  switch (type) {
    case "task":
      return { ...base, id, title, type, status: "active", archived: false };
    case "note":
      return { ...base, id, title, type, archived: false };
    case "event":
      return {
        ...base,
        id,
        title,
        type,
        origin: "local",
        all_day: false,
        starts_at: "2026-09-18T12:46:00.000Z",
        start_date: null,
        is_recurring: false,
        is_detached: false,
        archived: false,
      };
    case "project":
      return { ...base, id, title, type, status: "active", target_date: null, archived: false };
    case "inbox_item":
      return { ...base, id, title, type, status: "pending", entity_type: null, entity_id: null };
    case "mail_message":
      return { ...base, id, title, type, sender: null, has_attachment: false };
  }
}

function response(results: SearchResult[], overrides: Partial<SearchResponse["counts"]> = {}) {
  const zero = { returned: 0, total: 0 };
  const counts = {
    task: zero,
    note: zero,
    event: zero,
    project: zero,
    inbox_item: zero,
    mail_message: zero,
    ...overrides,
  };
  return {
    query: "widget",
    tokens: ["widget"],
    dropped: [],
    limit: 20,
    order: "score",
    match_mode: "all",
    date_filter: null,
    truncated: false,
    counts,
    results,
  } as SearchResponse;
}

/** A compact trace of the rows: `T` = the Top matches header, `H:type`, `R:id`. */
function trace(response: SearchResponse): string[] {
  return buildSearchRows(response).map((row) =>
    row.kind === "header" ? (row.type === null ? "T" : `H:${row.type}`) : `R:${row.result.id}`,
  );
}

describe("buildSearchRows", () => {
  it("returns nothing for an empty result set -- not even a Top matches header", () => {
    expect(buildSearchRows(response([]))).toEqual([]);
  });

  it("shows ONLY the Top matches section when five or fewer results came back", () => {
    const three = response([
      result("mail_message", "m1", "mail"),
      result("task", "t1", "task"),
      result("event", "e1", "event"),
    ]);
    expect(buildSearchRows(three)[0]).toEqual({
      kind: "header",
      type: null,
      label: SEARCH_TOP_MATCHES_LABEL,
      shown: 3,
      returned: 3,
      total: 3,
    });
    expect(trace(three)).toEqual(["T", "R:m1", "R:t1", "R:e1"]);
  });

  it("takes exactly the first five as Top matches, in SERVER order, whatever their types", () => {
    const rows = trace(
      response([
        result("mail_message", "m1", "mail"),
        result("note", "n1", "note"),
        result("task", "t1", "task"),
        result("project", "p1", "project"),
        result("event", "e1", "event"),
        result("inbox_item", "i1", "inbox"),
      ]),
    );
    expect(SEARCH_TOP_MATCHES_MAX).toBe(5);
    expect(rows.slice(0, 6)).toEqual(["T", "R:m1", "R:n1", "R:t1", "R:p1", "R:e1"]);
    // Deliberately handed back in a non-canonical order: a client-side sort
    // would create a second place the ranking rule lives.
    expect(rows.slice(6)).toEqual(["H:inbox_item", "R:i1"]);
  });

  it("groups the REMAINING results by type in SEARCH_RESULT_TYPE_ORDER, keeping arrival order within a type", () => {
    const rows = trace(
      response([
        result("task", "t1", "a"),
        result("task", "t2", "b"),
        result("task", "t3", "c"),
        result("task", "t4", "d"),
        result("task", "t5", "e"),
        // Everything below is past the top five and arrives interleaved.
        result("mail_message", "m1", "m"),
        result("note", "n2", "n"),
        result("event", "e1", "e"),
        result("task", "t6", "f"),
        result("note", "n1", "n"),
        result("mail_message", "m2", "m"),
        result("project", "p1", "p"),
      ]),
    );
    expect(rows).toEqual([
      "T",
      "R:t1",
      "R:t2",
      "R:t3",
      "R:t4",
      "R:t5",
      "H:task",
      "R:t6",
      "H:note",
      "R:n2",
      "R:n1",
      "H:event",
      "R:e1",
      "H:project",
      "R:p1",
      "H:mail_message",
      "R:m1",
      "R:m2",
    ]);
  });

  it("omits a per-type section when that type has nothing left after the top five", () => {
    const rows = trace(
      response([
        result("note", "n1", "a"),
        result("note", "n2", "b"),
        result("note", "n3", "c"),
        result("note", "n4", "d"),
        result("note", "n5", "e"),
        result("mail_message", "m1", "m"),
      ]),
    );
    expect(rows).toEqual(["T", "R:n1", "R:n2", "R:n3", "R:n4", "R:n5", "H:mail_message", "R:m1"]);
    expect(rows).not.toContain("H:note");
  });

  it("never re-sorts, and never duplicates a result across sections", () => {
    const many = Array.from({ length: 9 }, (_, i) => result("task", `t${i}`, "x"));
    const rows = buildSearchRows(response(many));
    const ids = rows.flatMap((row) => (row.kind === "result" ? [row.result.id] : []));
    expect(ids).toEqual(many.map((r) => r.id));
  });

  it("carries the rows-under-it count AND the server's honest per-type counts onto a per-type header", () => {
    // Six mail results, five of them in Top matches: the Mail header sits over
    // ONE row. `shown` says so; `returned`/`total` keep the cap visible.
    const rows = buildSearchRows(
      response(
        [
          result("mail_message", "m1", "a"),
          result("mail_message", "m2", "b"),
          result("mail_message", "m3", "c"),
          result("mail_message", "m4", "d"),
          result("mail_message", "m5", "e"),
          result("mail_message", "m6", "f"),
        ],
        { mail_message: { returned: 6, total: 298 } },
      ),
    );
    const header = rows.find((row) => row.kind === "header" && row.type === "mail_message");
    expect(header).toEqual({
      kind: "header",
      type: "mail_message",
      label: "Mail",
      shown: 1,
      returned: 6,
      total: 298,
    });
  });

  it("counts `shown` per type from the remainder only, never from the response counts", () => {
    const rows = buildSearchRows(
      response(
        [
          result("task", "t1", "a"),
          result("task", "t2", "b"),
          result("note", "n1", "c"),
          result("task", "t3", "d"),
          result("note", "n2", "e"),
          result("task", "t4", "f"),
          result("note", "n3", "g"),
          result("note", "n4", "h"),
        ],
        { task: { returned: 4, total: 4 }, note: { returned: 4, total: 40 } },
      ),
    );
    const headers = rows.filter((row) => row.kind === "header" && row.type !== null);
    expect(headers).toEqual([
      { kind: "header", type: "task", label: "Tasks", shown: 1, returned: 4, total: 4 },
      { kind: "header", type: "note", label: "Notes", shown: 2, returned: 4, total: 40 },
    ]);
  });

  it("tags every result row with the section it sits in", () => {
    const rows = buildSearchRows(
      response([...Array.from({ length: 6 }, (_, i) => result("note", `n${i}`, "x"))]),
    );
    const sections = rows.flatMap((row) => (row.kind === "result" ? [row.section] : []));
    expect(sections).toEqual(["top", "top", "top", "top", "top", "type"]);
  });
});

describe("searchRowKey", () => {
  it("is unique across the Top matches header, every type header and every result", () => {
    const rows = buildSearchRows(
      response([
        ...Array.from({ length: 5 }, (_, i) => result("task", `t${i}`, "x")),
        result("task", "header", "a header-shaped id cannot collide"),
        result("note", "top", "nor can a section-shaped one"),
      ]),
    );
    const keys = rows.map(searchRowKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("header:top");
  });
});

describe("isEmptySearchResponse", () => {
  it("is true only when nothing matched", () => {
    expect(isEmptySearchResponse(response([]))).toBe(true);
    expect(isEmptySearchResponse(response([result("note", "n1", "x")]))).toBe(false);
  });
});
