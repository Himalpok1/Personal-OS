import type { SearchResponse, SearchResult } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { buildSearchRows, isEmptySearchResponse, searchRowKey } from "./search-sections";

function result(type: SearchResult["type"], id: string, title: string): SearchResult {
  const base = { id, title, preview: null, timestamp: "2026-08-01T00:00:00.000Z" };
  switch (type) {
    case "task":
      return { ...base, type, status: "active", archived: false };
    case "note":
      return { ...base, type, archived: false };
    case "inbox_item":
      return { ...base, type, status: "pending", entity_type: null, entity_id: null };
    case "mail_message":
      return { ...base, type, sender: null, has_attachment: false };
  }
}

function response(results: SearchResult[], overrides: Partial<SearchResponse["counts"]> = {}) {
  const zero = { returned: 0, total: 0 };
  const counts = { task: zero, note: zero, inbox_item: zero, mail_message: zero, ...overrides };
  return {
    query: "widget",
    limit: 20,
    truncated: false,
    counts,
    results,
  } as SearchResponse;
}

describe("buildSearchRows", () => {
  it("returns nothing for an empty result set", () => {
    expect(buildSearchRows(response([]))).toEqual([]);
  });

  it("inserts one header per type, in the order the server sent", () => {
    const rows = buildSearchRows(
      response(
        [
          result("task", "t1", "task one"),
          result("task", "t2", "task two"),
          result("note", "n1", "note one"),
          result("mail_message", "m1", "mail one"),
        ],
        {
          task: { returned: 2, total: 2 },
          note: { returned: 1, total: 1 },
          mail_message: { returned: 1, total: 1 },
        },
      ),
    );

    expect(rows.map((row) => (row.kind === "header" ? `H:${row.type}` : `R:${row.result.id}`))).toEqual(
      ["H:task", "R:t1", "R:t2", "H:note", "R:n1", "H:mail_message", "R:m1"],
    );
  });

  it("does NOT re-sort -- the server's order is the contract", () => {
    // Deliberately handed back in a non-canonical order. A client-side sort
    // would create a second place the ordering rule lives.
    const rows = buildSearchRows(
      response([result("mail_message", "m1", "mail"), result("task", "t1", "task")], {
        task: { returned: 1, total: 1 },
        mail_message: { returned: 1, total: 1 },
      }),
    );
    expect(rows[0]!.kind === "header" && rows[0]!.type).toBe("mail_message");
  });

  it("carries the honest totals onto the header so a cap is visible", () => {
    const rows = buildSearchRows(
      response([result("note", "n1", "note")], { note: { returned: 1, total: 42 } }),
    );
    const header = rows[0]!;
    expect(header.kind === "header" && header.returned).toBe(1);
    expect(header.kind === "header" && header.total).toBe(42);
  });
});

describe("searchRowKey", () => {
  it("cannot collide between a header and a result", () => {
    const rows = buildSearchRows(
      response([result("task", "task", "x")], { task: { returned: 1, total: 1 } }),
    );
    const keys = rows.map(searchRowKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("isEmptySearchResponse", () => {
  it("is true only when nothing matched", () => {
    expect(isEmptySearchResponse(response([]))).toBe(true);
    expect(isEmptySearchResponse(response([result("note", "n1", "x")]))).toBe(false);
  });
});
