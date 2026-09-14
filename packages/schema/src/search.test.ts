import {
  SEARCH_MATCH_FIELDS,
  SEARCH_SCORE_CODES,
  SEARCH_SCORE_TYPE_ORDER,
} from "@personal-os/core/search/score";
import { describe, expect, it } from "vitest";
import {
  ITEM_CONTEXT_BODY_MAX_CHARS,
  ItemContextSchema,
  ItemRefSchema,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_RESULT_TYPE_ORDER,
  SearchDateFilterSchema,
  SearchMatchFieldSchema,
  SearchMatchModeSchema,
  SearchQuerySchema,
  SearchResponseSchema,
  SearchResultSchema,
  SearchResultTypeSchema,
  SearchScoreCodeSchema,
  SearchScoreReasonSchema,
} from "./search.js";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const TS = "2026-08-20T15:00:00.000Z";

const MATCH = {
  reasons: [
    { code: "title_exact", points: 100 },
    { code: "title_token", points: 14, token: "rent" },
    { code: "recency", points: 20 },
    { code: "type_prior", points: 0 },
  ],
  fields: ["title"],
};

const BASE = {
  id: ID,
  title: "Pay the rent",
  preview: null,
  timestamp: TS,
  score: 134,
  match: MATCH,
};

const RESULT = { type: "task", ...BASE, status: "active", archived: false };

const MEMBERS: Record<string, Record<string, unknown>> = {
  task: RESULT,
  note: { type: "note", ...BASE, archived: false },
  event: {
    type: "event",
    ...BASE,
    origin: "local",
    all_day: false,
    starts_at: TS,
    start_date: null,
    is_recurring: false,
    is_detached: false,
    archived: false,
  },
  project: {
    type: "project",
    ...BASE,
    status: "active",
    target_date: "2026-12-31",
    archived: false,
  },
  inbox_item: {
    type: "inbox_item",
    ...BASE,
    status: "parsed",
    entity_type: "task",
    entity_id: ID2,
  },
  mail_message: { type: "mail_message", ...BASE, sender: "Widget Co", has_attachment: false },
};

const ZERO = { returned: 0, total: 0 };
const COUNTS = {
  task: ZERO,
  note: ZERO,
  event: ZERO,
  project: ZERO,
  inbox_item: ZERO,
  mail_message: ZERO,
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    query: "rent",
    tokens: ["rent"],
    dropped: [],
    limit: 20,
    order: "score",
    match_mode: "all",
    date_filter: null,
    truncated: false,
    counts: COUNTS,
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
    expect(parsed.order).toBe("score");
    expect(parsed.types).toBeUndefined();
    expect(parsed.tz).toBeUndefined();
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

  it("parses `types` as a comma-separated subset and rejects an unknown member", () => {
    expect(SearchQuerySchema.parse({ q: "rent", types: "task, note ,mail_message" }).types).toEqual(
      ["task", "note", "mail_message"],
    );
    expect(SearchQuerySchema.parse({ q: "rent", types: "event" }).types).toEqual(["event"]);
    expect(SearchQuerySchema.safeParse({ q: "rent", types: "task,health_metric" }).success).toBe(
      false,
    );
    expect(SearchQuerySchema.safeParse({ q: "rent", types: "" }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: "rent", types: " , " }).success).toBe(false);
  });

  it("accepts a valid IANA tz and rejects an invalid one; there is no default", () => {
    expect(SearchQuerySchema.parse({ q: "rent", tz: "America/Chicago" }).tz).toBe(
      "America/Chicago",
    );
    expect(SearchQuerySchema.safeParse({ q: "rent", tz: "Mars/Olympus" }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: "rent", tz: "" }).success).toBe(false);
  });

  it("accepts order=score and order=type only", () => {
    expect(SearchQuerySchema.parse({ q: "rent", order: "type" }).order).toBe("type");
    expect(SearchQuerySchema.safeParse({ q: "rent", order: "recency" }).success).toBe(false);
  });
});

describe("the result union is a closed allowlist of six members", () => {
  it("accepts a well-formed member of every type", () => {
    for (const [type, member] of Object.entries(MEMBERS)) {
      const parsed = SearchResultSchema.safeParse(member);
      expect(parsed.success, type).toBe(true);
    }
  });

  it("the six member types are exactly the type enum", () => {
    expect(Object.keys(MEMBERS).sort()).toEqual([...SearchResultTypeSchema.options].sort());
  });

  it("REJECTS an extra field on EVERY member -- this is the mechanism, not a style choice", () => {
    // A column that is not named in the contract is structurally incapable of
    // reaching the wire, because emitting it is a parse failure.
    const leaks = [
      { from_address: "leak@example.com" },
      { from_domain: "example.com" },
      { connection_id: ID2 },
      { body: "a body" },
      { description: "a description with a passcode" },
      { audio_path: "/tmp/x.m4a" },
      { parse_result: {} },
      { confidence: 0.9 },
      { client_uuid: ID2 },
      { external_id: "abc" },
      { external_etag: "etag" },
      { external_source: "google" },
      { token_hash: "deadbeef" },
      { href: "/tasks/x" },
    ];
    for (const [type, member] of Object.entries(MEMBERS)) {
      for (const leak of leaks) {
        expect(
          SearchResultSchema.safeParse({ ...member, ...leak }).success,
          `${type} ${Object.keys(leak)[0]}`,
        ).toBe(false);
      }
    }
  });

  it("rejects an unknown type", () => {
    expect(SearchResultSchema.safeParse({ ...RESULT, type: "health_metric" }).success).toBe(false);
  });

  it("requires score and match on every member", () => {
    for (const [type, member] of Object.entries(MEMBERS)) {
      const noScore: Record<string, unknown> = { ...member };
      delete noScore["score"];
      const noMatch: Record<string, unknown> = { ...member };
      delete noMatch["match"];
      expect(SearchResultSchema.safeParse(noScore).success, type).toBe(false);
      expect(SearchResultSchema.safeParse(noMatch).success, type).toBe(false);
      expect(SearchResultSchema.safeParse({ ...member, score: 1.5 }).success, type).toBe(false);
    }
  });

  it("a mail result carries no address or domain field at all", () => {
    const parsed = SearchResultSchema.parse(MEMBERS["mail_message"]);
    expect(Object.keys(parsed).sort()).toEqual([
      "has_attachment",
      "id",
      "match",
      "preview",
      "score",
      "sender",
      "timestamp",
      "title",
      "type",
    ]);
  });

  it("an event result carries ownership and all-day shape, and a pure date for start_date", () => {
    const event = MEMBERS["event"] as Record<string, unknown>;
    expect(SearchResultSchema.safeParse({ ...event, origin: "external" }).success).toBe(true);
    expect(SearchResultSchema.safeParse({ ...event, origin: "imported" }).success).toBe(false);
    expect(
      SearchResultSchema.safeParse({
        ...event,
        all_day: true,
        starts_at: null,
        start_date: "2026-09-21",
      }).success,
    ).toBe(true);
    expect(SearchResultSchema.safeParse({ ...event, start_date: TS }).success).toBe(false);
  });

  it("a project result carries a status from the project vocabulary", () => {
    const project = MEMBERS["project"] as Record<string, unknown>;
    expect(SearchResultSchema.safeParse({ ...project, status: "archived" }).success).toBe(false);
    expect(SearchResultSchema.safeParse({ ...project, target_date: null }).success).toBe(true);
  });
});

describe("match reasons and fields", () => {
  it("the score codes are exactly the core scorer's vocabulary, in order", () => {
    expect(SearchScoreCodeSchema.options).toEqual([...SEARCH_SCORE_CODES]);
  });

  it("the match fields are exactly the core scorer's vocabulary, in order", () => {
    expect(SearchMatchFieldSchema.options).toEqual([...SEARCH_MATCH_FIELDS]);
  });

  it("the type order is exactly the core scorer's tie-break order", () => {
    expect([...SEARCH_RESULT_TYPE_ORDER]).toEqual([...SEARCH_SCORE_TYPE_ORDER]);
  });

  it("a reason has an integer points value, an optional token and nothing else", () => {
    expect(SearchScoreReasonSchema.safeParse({ code: "recency", points: 16 }).success).toBe(true);
    expect(
      SearchScoreReasonSchema.safeParse({ code: "body_token", points: 3, token: "rent" }).success,
    ).toBe(true);
    expect(SearchScoreReasonSchema.safeParse({ code: "recency", points: 1.5 }).success).toBe(false);
    expect(SearchScoreReasonSchema.safeParse({ code: "tfidf", points: 1 }).success).toBe(false);
    expect(
      SearchScoreReasonSchema.safeParse({ code: "recency", points: 1, title: "x" }).success,
    ).toBe(false);
  });

  it("a match object rejects an unknown field name and an unknown key", () => {
    expect(
      SearchResultSchema.safeParse({ ...RESULT, match: { reasons: [], fields: ["from_address"] } })
        .success,
    ).toBe(false);
    expect(
      SearchResultSchema.safeParse({ ...RESULT, match: { reasons: [], fields: [], snippet: "x" } })
        .success,
    ).toBe(false);
    expect(
      SearchResultSchema.safeParse({ ...RESULT, match: { reasons: [], fields: [] } }).success,
    ).toBe(true);
  });

  it("match modes are the four rungs", () => {
    expect(SearchMatchModeSchema.options).toEqual(["all", "all_without_date", "any", "none"]);
  });
});

describe("SearchDateFilterSchema", () => {
  const FILTER = {
    token: "september",
    kind: "month",
    from: "2026-09-01",
    to: "2026-09-30",
    tz: "America/Chicago",
    dropped: false,
  };

  it("accepts every kind and requires pure dates", () => {
    for (const kind of ["day", "month", "year", "iso_date", "iso_month"]) {
      expect(SearchDateFilterSchema.safeParse({ ...FILTER, kind }).success, kind).toBe(true);
    }
    expect(SearchDateFilterSchema.safeParse({ ...FILTER, kind: "week" }).success).toBe(false);
    expect(SearchDateFilterSchema.safeParse({ ...FILTER, from: TS }).success).toBe(false);
    expect(SearchDateFilterSchema.safeParse({ ...FILTER, window: {} }).success).toBe(false);
  });

  it("is nullable on the response and carries `dropped`", () => {
    expect(SearchResponseSchema.safeParse(response({ date_filter: FILTER })).success).toBe(true);
    expect(
      SearchResponseSchema.safeParse(
        response({ match_mode: "all_without_date", date_filter: { ...FILTER, dropped: true } }),
      ).success,
    ).toBe(true);
  });
});

describe("SearchResponseSchema", () => {
  it("accepts a well-formed response", () => {
    expect(SearchResponseSchema.safeParse(response()).success).toBe(true);
    expect(
      SearchResponseSchema.safeParse(response({ results: Object.values(MEMBERS) })).success,
    ).toBe(true);
  });

  it("rejects dishonest counts", () => {
    const dishonest = response({ counts: { ...COUNTS, task: { returned: 3, total: 1 } } });
    expect(SearchResponseSchema.safeParse(dishonest).success).toBe(false);
  });

  it("rejects an unknown top-level key", () => {
    expect(SearchResponseSchema.safeParse(response({ sql: "select 1" })).success).toBe(false);
  });

  it("counts has exactly six keys -- one gained or one lost is a parse failure", () => {
    expect(
      SearchResponseSchema.safeParse(response({ counts: { ...COUNTS, health_metric: ZERO } }))
        .success,
    ).toBe(false);
    const five: Record<string, unknown> = { ...COUNTS };
    delete five["event"];
    expect(SearchResponseSchema.safeParse(response({ counts: five })).success).toBe(false);
  });

  it("requires tokens, dropped, order and match_mode", () => {
    for (const key of ["tokens", "dropped", "order", "match_mode", "date_filter"]) {
      const rest: Record<string, unknown> = { ...response() };
      delete rest[key];
      expect(SearchResponseSchema.safeParse(rest).success, key).toBe(false);
    }
    expect(SearchResponseSchema.safeParse(response({ match_mode: "fuzzy" })).success).toBe(false);
    expect(SearchResponseSchema.safeParse(response({ order: "recency" })).success).toBe(false);
  });

  it("echoes dropped query tokens as a string array, in order", () => {
    const parsed = SearchResponseSchema.parse(response({ dropped: ["ninth", "tenth"] }));
    expect(parsed.dropped).toEqual(["ninth", "tenth"]);
    expect(SearchResponseSchema.safeParse(response({ dropped: "ninth" })).success).toBe(false);
    expect(SearchResponseSchema.safeParse(response({ dropped: [9] })).success).toBe(false);
  });
});

describe("SEARCH_RESULT_TYPE_ORDER", () => {
  it("is the six-entry order: user-authored types, then captures, then mail", () => {
    expect(SEARCH_RESULT_TYPE_ORDER).toEqual([
      "task",
      "note",
      "event",
      "project",
      "inbox_item",
      "mail_message",
    ]);
    expect(SEARCH_RESULT_TYPE_ORDER.at(-1)).toBe("mail_message");
    expect([...SEARCH_RESULT_TYPE_ORDER].sort()).toEqual(
      [...SearchResultTypeSchema.options].sort(),
    );
  });
});

describe("item context", () => {
  const CONTEXT = {
    type: "note",
    id: ID,
    title: "Rent",
    body: "Pay by the 1st",
    body_truncated: false,
    timestamp: TS,
    status: null,
    archived: false,
    origin: null,
    project_id: null,
    citations: [{ type: "note", id: ID }],
  };

  it("has a 1500-character body bound", () => {
    expect(ITEM_CONTEXT_BODY_MAX_CHARS).toBe(1500);
  });

  it("accepts a well-formed context and a null body", () => {
    expect(ItemContextSchema.safeParse(CONTEXT).success).toBe(true);
    expect(ItemContextSchema.safeParse({ ...CONTEXT, body: null }).success).toBe(true);
    expect(
      ItemContextSchema.safeParse({ ...CONTEXT, type: "event", origin: "external", body: null })
        .success,
    ).toBe(true);
  });

  it("requires at least one citation and rejects unknown keys", () => {
    expect(ItemContextSchema.safeParse({ ...CONTEXT, citations: [] }).success).toBe(false);
    expect(ItemContextSchema.safeParse({ ...CONTEXT, external_id: "x" }).success).toBe(false);
    expect(ItemContextSchema.safeParse({ ...CONTEXT, sender_address: "a@b" }).success).toBe(false);
  });

  it("an item ref is a type plus a uuid and nothing else", () => {
    expect(ItemRefSchema.safeParse({ type: "task", id: ID }).success).toBe(true);
    expect(ItemRefSchema.safeParse({ type: "task", id: "not-a-uuid" }).success).toBe(false);
    expect(ItemRefSchema.safeParse({ type: "health_metric", id: ID }).success).toBe(false);
    expect(ItemRefSchema.safeParse({ type: "task", id: ID, href: "/x" }).success).toBe(false);
  });
});
