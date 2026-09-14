import { describe, expect, it } from "vitest";
import { InboxArchiveResponseSchema, InboxItemSchema, InboxListQuerySchema } from "./inbox.js";

// Checkpoint 9.3: inbox_items gains an archive axis (migration 0017). These
// pin the wire contract -- `archived_at` is REQUIRED on every item (nullable,
// never optional), so a server that forgot to project the column fails to
// parse rather than silently reporting every row as live.
const ITEM = {
  id: "11111111-1111-4111-8111-111111111111",
  client_uuid: null,
  raw_text: "x",
  source: "web",
  captured_at: "2026-09-01T00:00:00.000Z",
  timezone: "America/Chicago",
  status: "parsed",
  parse_result: null,
  confidence: null,
  entity_type: "task",
  entity_id: "22222222-2222-4222-8222-222222222222",
  created_at: "2026-09-01T00:00:00.000Z",
};

describe("InboxItemSchema.archived_at", () => {
  it("accepts null (live) and an ISO instant (archived)", () => {
    expect(InboxItemSchema.parse({ ...ITEM, archived_at: null }).archived_at).toBeNull();
    expect(
      InboxItemSchema.parse({ ...ITEM, archived_at: "2026-09-13T10:00:00.000Z" }).archived_at,
    ).toBe("2026-09-13T10:00:00.000Z");
  });

  it("is required, not optional -- an omitted field is a parse failure", () => {
    expect(InboxItemSchema.safeParse(ITEM).success).toBe(false);
  });

  it("rejects a non-instant value", () => {
    expect(InboxItemSchema.safeParse({ ...ITEM, archived_at: "yesterday" }).success).toBe(false);
    expect(InboxItemSchema.safeParse({ ...ITEM, archived_at: true }).success).toBe(false);
  });
});

describe("InboxListQuerySchema.include_archived", () => {
  it("defaults to false", () => {
    expect(InboxListQuerySchema.parse({}).include_archived).toBe(false);
  });

  it("parses the two exact query-string spellings", () => {
    expect(InboxListQuerySchema.parse({ include_archived: "true" }).include_archived).toBe(true);
    // The pagination.ts hazard: z.coerce.boolean() would read "false" as true.
    expect(InboxListQuerySchema.parse({ include_archived: "false" }).include_archived).toBe(false);
  });

  it("rejects a malformed value rather than guessing", () => {
    expect(InboxListQuerySchema.safeParse({ include_archived: "yes" }).success).toBe(false);
  });

  it("composes with the existing status filter and pagination", () => {
    expect(
      InboxListQuerySchema.parse({ status: "failed", include_archived: "true", limit: "5" }),
    ).toEqual({ status: "failed", include_archived: true, limit: 5, offset: 0 });
  });
});

describe("InboxArchiveResponseSchema", () => {
  it("carries the id and the stamped instant, nothing else", () => {
    const parsed = InboxArchiveResponseSchema.parse({
      id: ITEM.id,
      archived_at: "2026-09-13T10:00:00.000Z",
      extra: "dropped",
    });
    expect(parsed).toEqual({ id: ITEM.id, archived_at: "2026-09-13T10:00:00.000Z" });
  });

  it("never carries a null archived_at -- a 200 means the row IS archived", () => {
    expect(InboxArchiveResponseSchema.safeParse({ id: ITEM.id, archived_at: null }).success).toBe(
      false,
    );
  });
});
