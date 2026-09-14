import type { InboxItem } from "@personal-os/schema";
import { describe, expect, it, vi } from "vitest";
import {
  FOLLOW_THROUGH_MAX_POLLS,
  FOLLOW_THROUGH_MAX_WINDOW_MS,
  FOLLOW_THROUGH_POLL_DELAYS_MS,
  FOLLOW_THROUGH_TITLE_MAX_CHARS,
  classifyFollowThrough,
  committedTitle,
  followCaptureThrough,
  followThroughLabel,
  followThroughRoute,
} from "./capture-follow-through";

const ID = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: ID,
    client_uuid: null,
    raw_text: "call mom",
    source: "web",
    captured_at: "2026-09-13T00:00:00.000Z",
    timezone: "America/Chicago",
    status: "pending",
    parse_result: null,
    confidence: null,
    entity_type: null,
    entity_id: null,
    archived_at: null,
    created_at: "2026-09-13T00:00:00.000Z",
    ...overrides,
  };
}

const TASK_RESULT = {
  toolCall: { tool: "create_task", args: { title: "Call mom" } },
  confidenceFlags: [],
};

describe("the bound", () => {
  it("is at most 6 polls over at most 30 seconds", () => {
    expect(FOLLOW_THROUGH_MAX_POLLS).toBeLessThanOrEqual(6);
    expect(FOLLOW_THROUGH_MAX_WINDOW_MS).toBeLessThanOrEqual(30_000);
    expect(FOLLOW_THROUGH_POLL_DELAYS_MS.every((d) => d > 0)).toBe(true);
  });
});

describe("classifyFollowThrough", () => {
  it("keeps polling while pending", () => {
    expect(classifyFollowThrough(item({ status: "pending" }))).toBeNull();
  });

  it("resolves a committed item to its entity with the parser's title", () => {
    const outcome = classifyFollowThrough(
      item({ status: "parsed", entity_type: "task", entity_id: ENTITY, parse_result: TASK_RESULT }),
    );
    expect(outcome).toEqual({
      kind: "filed",
      entityType: "task",
      route: `/tasks/${ENTITY}`,
      title: "Call mom",
    });
  });

  it("keeps polling when parsed/confirmed but the entity id has not landed yet", () => {
    expect(classifyFollowThrough(item({ status: "parsed", entity_type: "task" }))).toBeNull();
    expect(classifyFollowThrough(item({ status: "confirmed" }))).toBeNull();
  });

  it("routes needs_confirm and failed to the inbox item", () => {
    expect(classifyFollowThrough(item({ status: "needs_confirm" }))).toEqual({
      kind: "needs_confirm",
      inboxId: ID,
    });
    expect(classifyFollowThrough(item({ status: "failed" }))).toEqual({ kind: "failed", inboxId: ID });
  });
});

describe("committedTitle", () => {
  it("is null with nothing readable or for an unclear result", () => {
    expect(committedTitle({ parse_result: null })).toBeNull();
    expect(
      committedTitle({
        parse_result: { toolCall: { tool: "unclear", args: { reason: "?" } }, confidenceFlags: [] },
      }),
    ).toBeNull();
  });

  it("control-strips, single-lines and bounds the title", () => {
    const title = committedTitle({
      parse_result: {
        toolCall: {
          tool: "create_note",
          args: { title: "a\u0000b\nc " + "x".repeat(200), body: "" },
        },
        confidenceFlags: [],
      },
    })!;
    expect(title.startsWith("ab c")).toBe(true);
    expect(title).not.toContain("\n");
    expect(title.length).toBeLessThanOrEqual(FOLLOW_THROUGH_TITLE_MAX_CHARS);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("followCaptureThrough", () => {
  it("stops at the first settled poll and never sleeps past it", async () => {
    const sleeps: number[] = [];
    const fetchItem = vi
      .fn<(id: string) => Promise<InboxItem>>()
      .mockResolvedValueOnce(item({ status: "pending" }))
      .mockResolvedValueOnce(
        item({ status: "parsed", entity_type: "note", entity_id: ENTITY, parse_result: TASK_RESULT }),
      );
    const outcome = await followCaptureThrough(ID, {
      fetchItem,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(outcome.kind).toBe("filed");
    expect(fetchItem).toHaveBeenCalledTimes(2);
    expect(fetchItem).toHaveBeenCalledWith(ID);
    expect(sleeps).toEqual(FOLLOW_THROUGH_POLL_DELAYS_MS.slice(0, 2));
  });

  it("gives up as `unresolved` after exactly the bound when the item stays pending", async () => {
    const sleeps: number[] = [];
    const fetchItem = vi.fn(async () => item({ status: "pending" }));
    const outcome = await followCaptureThrough(ID, {
      fetchItem,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(outcome).toEqual({ kind: "unresolved" });
    expect(fetchItem).toHaveBeenCalledTimes(FOLLOW_THROUGH_MAX_POLLS);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(FOLLOW_THROUGH_MAX_WINDOW_MS);
  });

  it("counts a poll that throws against the bound and carries on", async () => {
    const fetchItem = vi
      .fn<(id: string) => Promise<InboxItem>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(item({ status: "needs_confirm" }));
    const outcome = await followCaptureThrough(ID, { fetchItem, sleep: async () => {} });
    expect(outcome).toEqual({ kind: "needs_confirm", inboxId: ID });
    expect(fetchItem).toHaveBeenCalledTimes(2);
  });

  it("never exceeds the bound even when every poll throws", async () => {
    const fetchItem = vi.fn(async () => {
      throw new Error("down");
    });
    const outcome = await followCaptureThrough(ID, { fetchItem, sleep: async () => {} });
    expect(outcome).toEqual({ kind: "unresolved" });
    expect(fetchItem).toHaveBeenCalledTimes(FOLLOW_THROUGH_MAX_POLLS);
  });

  it("resolves unresolved without fetching once cancelled", async () => {
    const fetchItem = vi.fn(async () => item({ status: "needs_confirm" }));
    let cancelled = false;
    const outcome = await followCaptureThrough(ID, {
      fetchItem,
      sleep: async () => {
        cancelled = true;
      },
      isCancelled: () => cancelled,
    });
    expect(outcome).toEqual({ kind: "unresolved" });
    expect(fetchItem).not.toHaveBeenCalled();
  });
});

describe("banner copy and destination", () => {
  it("names the entity and its title, and routes to the entity", () => {
    const filed = {
      kind: "filed" as const,
      entityType: "task" as const,
      route: `/tasks/${ENTITY}` as const,
      title: "Call mom",
    };
    expect(followThroughLabel(filed)).toBe("Filed as task: Call mom");
    expect(followThroughRoute(filed)).toBe(`/tasks/${ENTITY}`);
    expect(followThroughLabel({ ...filed, title: null })).toBe("Filed as task");
  });

  it("routes needs_confirm and failed to the inbox item's own screen", () => {
    expect(followThroughLabel({ kind: "needs_confirm", inboxId: ID })).toBe("Needs confirmation");
    expect(followThroughRoute({ kind: "needs_confirm", inboxId: ID })).toBe(`/inbox/${ID}`);
    expect(followThroughRoute({ kind: "failed", inboxId: ID })).toBe(`/inbox/${ID}`);
  });

  it("shows nothing and goes nowhere after the bound", () => {
    expect(followThroughLabel({ kind: "unresolved" })).toBeNull();
    expect(followThroughRoute({ kind: "unresolved" })).toBeNull();
  });
});
