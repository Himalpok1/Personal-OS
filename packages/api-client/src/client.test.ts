import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClientError, buildQuery, fetchJson } from "./client.js";

const StringSchema = z.object({ ok: z.boolean() });

describe("fetchJson", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("parses a successful response through the given schema", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await fetchJson("http://localhost:3000", "/health", StringSchema);
    expect(result).toEqual({ ok: true });
  });

  it("sends the given method/body/headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    global.fetch = fetchMock;

    await fetchJson("http://localhost:3000", "/tasks", StringSchema, {
      method: "POST",
      body: JSON.stringify({ title: "x" }),
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:3000/tasks");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  // Regression test: the action endpoints (archive/activate/complete/drop)
  // are called with no body at all. Fastify's JSON body parser rejects
  // "Content-Type: application/json" paired with an empty body as a 400 --
  // this bug shipped past every automated test (route tests call the
  // handler via Fastify's .inject(), which never goes through this
  // Content-Type logic) and was only caught by exercising the real UI
  // against a real server.
  it("omits Content-Type when there's no body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    global.fetch = fetchMock;

    await fetchJson("http://localhost:3000", "/tasks/1/archive", StringSchema, {
      method: "POST",
    });

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("throws ApiClientError with status/code/issues on a non-2xx response", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: "validation_failed", issues: [{ path: ["title"] }] }),
          { status: 400 },
        ),
      );

    await expect(fetchJson("http://localhost:3000", "/tasks", StringSchema)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(400);
        expect(apiErr.code).toBe("validation_failed");
        expect(apiErr.issues).toEqual([{ path: ["title"] }]);
        return true;
      },
    );
  });

  it("carries endpoint-specific error fields on ApiClientError.body", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: "recurring_task_use_occurrence", occurrence_id: "abc-123" }),
          { status: 409 },
        ),
      );

    try {
      await fetchJson("http://localhost:3000", "/tasks/1/complete", StringSchema, {
        method: "POST",
      });
      expect.unreachable("expected fetchJson to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).body).toMatchObject({ occurrence_id: "abc-123" });
    }
  });
});

describe("buildQuery", () => {
  it("omits undefined entries", () => {
    expect(buildQuery({ a: "x", b: undefined })).toBe("?a=x");
  });

  it("returns an empty string when nothing is set", () => {
    expect(buildQuery({ a: undefined })).toBe("");
  });

  it("joins array values with commas", () => {
    expect(buildQuery({ status: ["active", "inbox"] })).toBe("?status=active%2Cinbox");
  });
});
