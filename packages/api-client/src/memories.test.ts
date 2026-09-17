import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemory,
  decideMemorySuggestion,
  deleteAllMemories,
  deleteMemory,
  getMemorySettings,
  listMemories,
  listMemorySuggestions,
  updateMemory,
} from "./memories.js";

const BASE = "http://localhost:3000";
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function stub(body: unknown, status = 200) {
  const f = vi.fn().mockResolvedValue(
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
  );
  global.fetch = f;
  return f;
}

const ID = "11111111-1111-4111-8111-111111111111";
const ITEM = {
  id: ID,
  kind: "preference",
  statement: "I work best in the evening",
  note: null,
  source: "user",
  suggestion_id: null,
  project_id: null,
  canvas_course_id: null,
  created_at: "2026-09-17T12:00:00Z",
  updated_at: "2026-09-17T12:00:00Z",
  project: null,
  course: null,
};

describe("memories api-client", () => {
  it("lists with query params and parses the paginated shape", async () => {
    const f = stub({ items: [ITEM], limit: 50, offset: 0, total: 1 });
    const result = await listMemories(BASE, { kind: "preference", limit: 50 });
    expect(result.items[0]?.statement).toBe("I work best in the evening");
    const url = String(f.mock.calls[0]?.[0]);
    expect(url).toContain("/memories?");
    expect(url).toContain("kind=preference");
  });

  it("creates with POST and never sends provenance", async () => {
    const f = stub(ITEM, 201);
    await createMemory(BASE, { kind: "preference", statement: "I work best in the evening" });
    const init = f.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      kind: "preference",
      statement: "I work best in the evening",
    });
  });

  it("updates with PATCH", async () => {
    const f = stub({ ...ITEM, note: "why" });
    const result = await updateMemory(BASE, ID, { note: "why" });
    expect(result.note).toBe("why");
    expect((f.mock.calls[0]?.[1] as RequestInit).method).toBe("PATCH");
    expect(String(f.mock.calls[0]?.[0])).toContain(`/memories/${ID}`);
  });

  it("deletes with DELETE and resolves on 204", async () => {
    const f = stub(undefined, 204);
    await expect(deleteMemory(BASE, ID)).resolves.toBeUndefined();
    expect((f.mock.calls[0]?.[1] as RequestInit).method).toBe("DELETE");
  });

  it("delete-all POSTs the literal confirmation", async () => {
    const f = stub({ deleted: 3 });
    const result = await deleteAllMemories(BASE);
    expect(result.deleted).toBe(3);
    const init = f.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ confirm: true });
    expect(String(f.mock.calls[0]?.[0])).toContain("/memories/delete-all");
  });

  it("reads the settings shape strictly", async () => {
    stub({ enabled: true, memory_count: 2 });
    expect(await getMemorySettings(BASE)).toEqual({ enabled: true, memory_count: 2 });
    stub({ enabled: true, memory_count: 2, tracking: true });
    await expect(getMemorySettings(BASE)).rejects.toThrow();
  });

  it("lists suggestions and decides one with the key URL-encoded", async () => {
    stub({
      items: [
        {
          key: `project_goal:${ID}`,
          kind: "project_goal",
          memory_kind: "goal",
          statement: "Finish the thesis",
          evidence: "From the goal you set on Thesis",
          project: { id: ID, name: "Thesis" },
        },
      ],
    });
    const list = await listMemorySuggestions(BASE);
    expect(list.items[0]?.evidence).toContain("Thesis");

    const f = stub({ key: `project_goal:${ID}`, decision: "never", memory: null }, 200);
    const decided = await decideMemorySuggestion(BASE, `project_goal:${ID}`, { decision: "never" });
    expect(decided.memory).toBeNull();
    expect(String(f.mock.calls[0]?.[0])).toContain(
      `/memory-suggestions/${encodeURIComponent(`project_goal:${ID}`)}/decide`,
    );
  });
});
