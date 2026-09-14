import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./client.js";
import { archiveInboxItem, getInboxItem, listInbox } from "./inbox.js";

const BASE = "http://localhost:3000";
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function stub(body: unknown, status = 200) {
  const f = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  global.fetch = f;
  return f;
}

const ITEM = {
  id: "11111111-1111-4111-8111-111111111111",
  client_uuid: null,
  raw_text: "remind me to chase the quote",
  source: "web",
  captured_at: "2026-09-01T00:00:00.000Z",
  timezone: "America/Chicago",
  status: "parsed",
  parse_result: null,
  confidence: null,
  entity_type: "task",
  entity_id: "22222222-2222-4222-8222-222222222222",
  archived_at: null,
  created_at: "2026-09-01T00:00:00.000Z",
};

// Checkpoint 9.3: inbox_items gained an archive axis (migration 0017).
describe("listInbox (include_archived)", () => {
  it("omits the flag by default so the server's default (hidden) applies", async () => {
    const f = stub({ items: [ITEM], limit: 50, offset: 0, total: 1 });
    await listInbox(BASE);
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/inbox`);
  });

  it("sends include_archived=true alongside the existing params", async () => {
    const f = stub({ items: [], limit: 50, offset: 0, total: 0 });
    await listInbox(BASE, { include_archived: true, status: "failed", limit: 10 });
    const url = new URL(String(f.mock.calls[0]![0]));
    expect(url.pathname).toBe("/inbox");
    expect(url.searchParams.get("include_archived")).toBe("true");
    expect(url.searchParams.get("status")).toBe("failed");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("sends an explicit include_archived=false, which the server treats as hidden", async () => {
    const f = stub({ items: [], limit: 50, offset: 0, total: 0 });
    await listInbox(BASE, { include_archived: false });
    expect(new URL(String(f.mock.calls[0]![0])).searchParams.get("include_archived")).toBe("false");
  });

  it("parses archived_at on every item, null or instant", async () => {
    stub({
      items: [
        ITEM,
        {
          ...ITEM,
          id: "33333333-3333-4333-8333-333333333333",
          archived_at: "2026-09-13T10:00:00.000Z",
        },
      ],
      limit: 50,
      offset: 0,
      total: 2,
    });
    const result = await listInbox(BASE, { include_archived: true });
    expect(result.items.map((item) => item.archived_at)).toEqual([
      null,
      "2026-09-13T10:00:00.000Z",
    ]);
  });

  it("rejects a server that stopped projecting archived_at -- the field is required", async () => {
    const withoutArchivedAt: Partial<typeof ITEM> = { ...ITEM };
    delete withoutArchivedAt.archived_at;
    stub({ items: [withoutArchivedAt], limit: 50, offset: 0, total: 1 });
    await expect(listInbox(BASE)).rejects.toThrow();
  });
});

describe("getInboxItem", () => {
  it("returns an archived item with its archived_at intact", async () => {
    stub({ ...ITEM, archived_at: "2026-09-13T10:00:00.000Z" });
    const item = await getInboxItem(BASE, ITEM.id);
    expect(item.archived_at).toBe("2026-09-13T10:00:00.000Z");
  });
});

describe("archiveInboxItem", () => {
  it("POSTs to the dedicated action route with no body and parses the response", async () => {
    const f = stub({ id: ITEM.id, archived_at: "2026-09-13T10:00:00.000Z" });
    const result = await archiveInboxItem(BASE, ITEM.id);
    expect(result).toEqual({ id: ITEM.id, archived_at: "2026-09-13T10:00:00.000Z" });
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/inbox/${ITEM.id}/archive`);
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("rejects a response whose archived_at is null -- a 200 means the row IS archived", async () => {
    stub({ id: ITEM.id, archived_at: null });
    await expect(archiveInboxItem(BASE, ITEM.id)).rejects.toThrow();
  });

  it("surfaces a 404 as a typed ApiClientError", async () => {
    stub({ error: "not_found" }, 404);
    const error = await archiveInboxItem(BASE, ITEM.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("not_found");
  });
});
