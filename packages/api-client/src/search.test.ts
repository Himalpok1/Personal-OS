import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./client.js";
import { search } from "./search.js";

const BASE = "http://api.test";

const EMPTY_COUNT = { returned: 0, total: 0 };

const RESPONSE = {
  query: "rent",
  limit: 20,
  truncated: false,
  counts: {
    task: { returned: 1, total: 1 },
    note: EMPTY_COUNT,
    inbox_item: EMPTY_COUNT,
    mail_message: EMPTY_COUNT,
  },
  results: [
    {
      type: "task",
      id: "11111111-1111-4111-8111-111111111111",
      title: "Pay the rent",
      preview: null,
      timestamp: "2026-08-20T15:00:00.000Z",
      status: "active",
      archived: false,
    },
  ],
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

describe("search", () => {
  it("serializes the query and returns the parsed response", async () => {
    const fetchMock = stubFetch(RESPONSE);
    const result = await search(BASE, { q: "rent" });

    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${BASE}/search?q=rent`);
    expect(result.results[0]!.title).toBe("Pay the rent");
  });

  it("omits optional params when they are absent, and sends them when present", async () => {
    const fetchMock = stubFetch(RESPONSE);
    await search(BASE, { q: "rent", limit: 5, include_archived: true });

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `${BASE}/search?q=rent&limit=5&include_archived=true`,
    );
  });

  it("sends include_archived=false explicitly rather than dropping it", async () => {
    // The server reads this with booleanQueryParam precisely so an explicit
    // "false" works; dropping it here would hide that.
    const fetchMock = stubFetch(RESPONSE);
    await search(BASE, { q: "rent", include_archived: false });

    expect(String(fetchMock.mock.calls[0]![0])).toContain("include_archived=false");
  });

  it("percent-encodes without double-escaping a query full of URL metacharacters", async () => {
    const fetchMock = stubFetch(RESPONSE);
    await search(BASE, { q: "50% off & more + extra" });

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    // Round-trips back to exactly what was asked for -- the property that
    // pre-encoding would break.
    expect(url.searchParams.get("q")).toBe("50% off & more + extra");
  });

  it("does not send a Content-Type header for a bodyless GET", async () => {
    const fetchMock = stubFetch(RESPONSE);
    await search(BASE, { q: "rent" });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("throws ApiClientError with the server's code on a 400", async () => {
    stubFetch({ error: "validation_failed" }, 400);
    await expect(search(BASE, { q: "a" })).rejects.toMatchObject({
      name: "ApiClientError",
      status: 400,
      code: "validation_failed",
    });
    await expect(search(BASE, { q: "a" })).rejects.toBeInstanceOf(ApiClientError);
  });

  it("fails at the boundary when the server returns a shape the contract forbids", async () => {
    // A result carrying an extra field is a parse failure here, which is what
    // makes the strict schemas a real client-side guard rather than a comment.
    stubFetch({
      ...RESPONSE,
      results: [{ ...RESPONSE.results[0], from_address: "leak@example.com" }],
    });
    await expect(search(BASE, { q: "rent" })).rejects.toThrow();
  });
});
