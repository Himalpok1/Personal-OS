import { describe, expect, it } from "vitest";
import {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_RESULT_TYPE_ORDER,
  SearchQuerySchema,
  SearchResponseSchema,
  SearchResultSchema,
} from "./search.js";

const RESULT = {
  type: "task",
  id: "11111111-1111-4111-8111-111111111111",
  title: "Pay the rent",
  preview: null,
  timestamp: "2026-08-20T15:00:00.000Z",
  status: "active",
  archived: false,
};

const ZERO = { returned: 0, total: 0 };

function response(overrides: Record<string, unknown> = {}) {
  return {
    query: "rent",
    limit: 20,
    truncated: false,
    counts: { task: ZERO, note: ZERO, inbox_item: ZERO, mail_message: ZERO },
    results: [],
    ...overrides,
  };
}

describe("SearchQuerySchema", () => {
  it("normalizes q and applies defaults", () => {
    const parsed = SearchQuerySchema.parse({ q: "  rent   due " });
    expect(parsed.q).toBe("rent due");
    expect(parsed.limit).toBe(SEARCH_LIMIT_DEFAULT);
    expect(parsed.include_archived).toBe(false);
  });

  it("rejects a query that is only whitespace or only control characters", () => {
    expect(SearchQuerySchema.safeParse({ q: "   " }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: "\u202E\u200B" }).success).toBe(false);
  });

  it("applies the length bounds to the NORMALIZED value", () => {
    expect(SearchQuerySchema.safeParse({ q: "  a " }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: "  ab " }).success).toBe(true);
  });

  it("rejects a limit above the maximum rather than clamping", () => {
    expect(SearchQuerySchema.safeParse({ q: "rent", limit: SEARCH_LIMIT_MAX }).success).toBe(true);
    expect(SearchQuerySchema.safeParse({ q: "rent", limit: SEARCH_LIMIT_MAX + 1 }).success).toBe(
      false,
    );
  });

  it("is strict -- an unknown parameter is rejected, not ignored", () => {
    expect(SearchQuerySchema.safeParse({ q: "rent", entity: "mail_connections" }).success).toBe(
      false,
    );
  });

  it("accepts an explicit include_archived=false", () => {
    // booleanQueryParam, not z.coerce.boolean(); pagination.ts records why.
    const parsed = SearchQuerySchema.parse({ q: "rent", include_archived: "false" });
    expect(parsed.include_archived).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: "rent", include_archived: "no" }).success).toBe(false);
  });
});

describe("the result union is a closed allowlist", () => {
  it("accepts a well-formed member", () => {
    expect(SearchResultSchema.safeParse(RESULT).success).toBe(true);
  });

  it("REJECTS an extra field -- this is the mechanism, not a style choice", () => {
    // A column that is not named in the contract is structurally incapable of
    // reaching the wire, because emitting it is a parse failure.
    for (const leak of [
      { from_address: "leak@example.com" },
      { from_domain: "example.com" },
      { connection_id: "22222222-2222-4222-8222-222222222222" },
      { body: "a body" },
      { audio_path: "/tmp/x.m4a" },
      { token_hash: "deadbeef" },
    ]) {
      expect(SearchResultSchema.safeParse({ ...RESULT, ...leak }).success).toBe(false);
    }
  });

  it("rejects an unknown type", () => {
    expect(SearchResultSchema.safeParse({ ...RESULT, type: "health_metric" }).success).toBe(false);
    expect(SearchResultSchema.safeParse({ ...RESULT, type: "event" }).success).toBe(false);
  });

  it("a mail result carries no address or domain field at all", () => {
    const mail = {
      type: "mail_message",
      id: "33333333-3333-4333-8333-333333333333",
      title: "Receipt",
      preview: null,
      timestamp: "2026-08-20T15:00:00.000Z",
      sender: "Widget Co",
      has_attachment: false,
    };
    const parsed = SearchResultSchema.parse(mail);
    expect(Object.keys(parsed).sort()).toEqual([
      "has_attachment",
      "id",
      "preview",
      "sender",
      "timestamp",
      "title",
      "type",
    ]);
  });
});

describe("SearchResponseSchema", () => {
  it("accepts a well-formed response", () => {
    expect(SearchResponseSchema.safeParse(response()).success).toBe(true);
  });

  it("rejects dishonest counts", () => {
    const dishonest = response({
      counts: { task: { returned: 3, total: 1 }, note: ZERO, inbox_item: ZERO, mail_message: ZERO },
    });
    expect(SearchResponseSchema.safeParse(dishonest).success).toBe(false);
  });

  it("rejects an unknown top-level key", () => {
    expect(SearchResponseSchema.safeParse(response({ sql: "select 1" })).success).toBe(false);
  });

  it("rejects a counts object that gained an entity", () => {
    const widened = response({
      counts: {
        task: ZERO,
        note: ZERO,
        inbox_item: ZERO,
        mail_message: ZERO,
        health_metric: ZERO,
      },
    });
    expect(SearchResponseSchema.safeParse(widened).success).toBe(false);
  });
});

describe("SEARCH_RESULT_TYPE_ORDER", () => {
  it("puts the user-authored types ahead of mail", () => {
    expect(SEARCH_RESULT_TYPE_ORDER).toEqual(["task", "note", "inbox_item", "mail_message"]);
    expect(SEARCH_RESULT_TYPE_ORDER.at(-1)).toBe("mail_message");
  });
});
