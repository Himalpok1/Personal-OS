import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./client.js";
import { generateBrief, getCurrentBrief } from "./brief.js";

const briefRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  brief_date: "2026-08-21",
  timezone: "America/Chicago",
  content: { text: "Good morning. You have 3 overdue tasks." },
  model_id: "22222222-2222-4222-8222-222222222222",
  generated_at: "2026-08-21T09:00:00.000Z",
};

function mockFetchWith(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  global.fetch = fetchMock;
  return fetchMock;
}

describe("brief api client", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("generateBrief", () => {
    it("POSTs /briefs with a JSON body of {tz} and parses the returned record", async () => {
      const fetchMock = mockFetchWith(briefRecord);

      const res = await generateBrief("http://localhost:3000", "America/Chicago");
      expect(res).toEqual(briefRecord);

      const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
      expect(url.toString()).toBe("http://localhost:3000/briefs");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ tz: "America/Chicago" });
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    });

    it("sends the exact request path with no query string -- tz travels in the body", async () => {
      const fetchMock = mockFetchWith(briefRecord);

      await generateBrief("http://localhost:3000", "Pacific/Auckland");

      const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
      expect(url.pathname).toBe("/briefs");
      expect(url.search).toBe("");
    });

    it("throws on an invalid timezone before ever calling fetch", async () => {
      const fetchMock = mockFetchWith(briefRecord);

      await expect(generateBrief("http://localhost:3000", "Not/AZone")).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("getCurrentBrief", () => {
    it("GETs /briefs/current with the tz URL-encoded in the query string", async () => {
      const fetchMock = mockFetchWith(briefRecord);

      await getCurrentBrief("http://localhost:3000", "America/Chicago");

      const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
      expect(url.toString()).toBe("http://localhost:3000/briefs/current?tz=America%2FChicago");
    });

    it("parses a successful response against DailyBriefRecordSchema", async () => {
      mockFetchWith(briefRecord);

      const res = await getCurrentBrief("http://localhost:3000", "America/Chicago");
      expect(res).toEqual(briefRecord);
    });

    it("returns null on a 404 response", async () => {
      mockFetchWith({ error: "not_found" }, 404);

      const res = await getCurrentBrief("http://localhost:3000", "America/Chicago");
      expect(res).toBeNull();
    });

    it("re-throws a 500 as ApiClientError", async () => {
      mockFetchWith({ error: "internal_error" }, 500);

      await expect(getCurrentBrief("http://localhost:3000", "America/Chicago")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiClientError);
          expect((err as ApiClientError).status).toBe(500);
          return true;
        },
      );
    });

    it("throws when the server payload fails schema validation (client-side boundary parse)", async () => {
      const malformed: Record<string, unknown> = { ...briefRecord };
      delete malformed["generated_at"];
      mockFetchWith(malformed);

      await expect(getCurrentBrief("http://localhost:3000", "America/Chicago")).rejects.toThrow();
    });
  });
});
