import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./client.js";
import { getExport } from "./export.js";

const BASE = "http://api.test";

const RESPONSE = {
  format_version: 1,
  generated_at: "2026-09-03T12:00:00.000Z",
  scope: "user_authored_core",
  truncated: false,
  counts: {
    projects: { returned: 0, total: 0 },
    tasks: { returned: 0, total: 0 },
    notes: { returned: 1, total: 1 },
    inbox_items: { returned: 0, total: 0 },
    memories: { returned: 0, total: 0 },
    action_requests: { returned: 0, total: 0 },
  },
  projects: [],
  tasks: [],
  notes: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Roof quotes",
      body: "three so far",
      project_id: null,
      archived_at: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
  ],
  inbox_items: [],
  memories: [],
  action_requests: [],
};

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getExport", () => {
  it("requests /export with no query string at all", async () => {
    const fetchMock = stubFetch(RESPONSE);
    const result = await getExport(BASE);

    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${BASE}/export`);
    expect(result.notes[0]!.body).toBe("three so far");
    expect(result.scope).toBe("user_authored_core");
  });

  it("does not send a Content-Type header for a bodyless GET", async () => {
    const fetchMock = stubFetch(RESPONSE);
    await getExport(BASE);

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("throws ApiClientError on a non-2xx", async () => {
    stubFetch({ error: "internal_error" }, 500);
    await expect(getExport(BASE)).rejects.toBeInstanceOf(ApiClientError);
  });

  it("rejects a response carrying an entity the export contract does not declare", async () => {
    // If a future server widened the scope, the client refuses it rather than
    // handing an unexpected table to a caller.
    stubFetch({ ...RESPONSE, mail_messages: [{ subject: "nope" }] });
    await expect(getExport(BASE)).rejects.toThrow();
  });

  it("rejects a response whose counts are dishonest", async () => {
    stubFetch({
      ...RESPONSE,
      counts: { ...RESPONSE.counts, notes: { returned: 5, total: 1 } },
    });
    await expect(getExport(BASE)).rejects.toThrow();
  });
});
