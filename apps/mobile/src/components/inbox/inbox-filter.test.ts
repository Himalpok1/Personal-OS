import type { InboxItem } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  INBOX_SEGMENTS,
  inboxEmptyCopy,
  inboxQueryParams,
  visibleInboxItems,
} from "./inbox-filter";

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    client_uuid: null,
    raw_text: "x",
    source: "web",
    captured_at: "2026-09-01T00:00:00.000Z",
    timezone: "America/Chicago",
    status: "parsed",
    parse_result: null,
    confidence: null,
    entity_type: null,
    entity_id: null,
    archived_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const OPEN = item({ id: "22222222-2222-4222-8222-222222222222" });
const DISMISSED = item({
  id: "33333333-3333-4333-8333-333333333333",
  archived_at: "2026-09-02T00:00:00.000Z",
});

describe("the Inbox segment (Checkpoint 10.6)", () => {
  it("offers exactly Open and Dismissed, Open first, each with a spoken label", () => {
    expect(INBOX_SEGMENTS.map((s) => s.value)).toEqual(["open", "dismissed"]);
    expect(INBOX_SEGMENTS.map((s) => s.label)).toEqual(["Open", "Dismissed"]);
    for (const segment of INBOX_SEGMENTS) expect(segment.accessibilityLabel).toBeTruthy();
  });

  it("fetches with the same params the old Show-dismissed toggle sent", () => {
    // The server owns the filter: Open sends nothing, Dismissed asks for the
    // archived rows too (GET /inbox?include_archived=true).
    expect(inboxQueryParams("open")).toEqual({});
    expect(inboxQueryParams("dismissed")).toEqual({ include_archived: true });
  });

  it("shows only open rows under Open and only dismissed rows under Dismissed", () => {
    expect(visibleInboxItems([OPEN, DISMISSED], "open")).toEqual([OPEN]);
    expect(visibleInboxItems([OPEN, DISMISSED], "dismissed")).toEqual([DISMISSED]);
  });

  it("keeps the server's own order within a segment", () => {
    const first = item({ id: "44444444-4444-4444-8444-444444444444" });
    expect(visibleInboxItems([first, DISMISSED, OPEN], "open").map((i) => i.id)).toEqual([
      first.id,
      OPEN.id,
    ]);
  });

  it("names the empty state per segment", () => {
    expect(inboxEmptyCopy("open").title).toBe("Inbox is clear");
    expect(inboxEmptyCopy("dismissed").title).toBe("Nothing dismissed");
  });
});
