import { describe, expect, it } from "vitest";
import type { FetchLike } from "./canvas-client.js";
import {
  CanvasApiError,
  CanvasTokenFormatError,
  createCanvasClient,
  isHeaderSafeToken,
} from "./canvas-client.js";
import { CanvasUrlBlockedError } from "./ssrf.js";

/** Records every request and replies with a scripted body. */
function stubFetch(
  replies: { status?: number; body?: unknown; headers?: Record<string, string> }[],
): { fetchFn: FetchLike; urls: string[]; inits: (RequestInit | undefined)[] } {
  const urls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  let i = 0;
  const fetchFn: FetchLike = (url, init) => {
    urls.push(url);
    inits.push(init);
    const reply = replies[i++] ?? { status: 200, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(reply.body ?? {}), {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json", ...(reply.headers ?? {}) },
      }),
    );
  };
  return { fetchFn, urls, inits };
}

describe("createCanvasClient: request shape", () => {
  it("hits base URL + /api/v1 + path, with a Bearer token and Accept: application/json", async () => {
    const { fetchFn, urls, inits } = stubFetch([{ status: 200, body: { id: 1 } }]);
    const client = createCanvasClient(fetchFn);
    await client.getSelf("https://uta.instructure.com", "pat-token-123");

    expect(urls[0]).toBe("https://uta.instructure.com/api/v1/users/self");
    const headers = new Headers(inits[0]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer pat-token-123");
    expect(headers.get("Accept")).toBe("application/json");
  });

  it("strips a trailing slash from baseUrl rather than producing a double slash", async () => {
    const { fetchFn, urls } = stubFetch([{ status: 200, body: { id: 1 } }]);
    const client = createCanvasClient(fetchFn);
    await client.getSelf("https://uta.instructure.com/", "tok");
    expect(urls[0]).toBe("https://uta.instructure.com/api/v1/users/self");
  });

  it("requests active courses with enrollment_state, per_page and include[]=term", async () => {
    const { fetchFn, urls } = stubFetch([{ status: 200, body: [] }]);
    const client = createCanvasClient(fetchFn);
    await client.listActiveCourses("https://uta.instructure.com", "tok");

    const url = new URL(urls[0]!);
    expect(url.pathname).toBe("/api/v1/courses");
    expect(url.searchParams.get("enrollment_state")).toBe("active");
    expect(url.searchParams.get("per_page")).toBe("100");
    expect(url.searchParams.getAll("include[]")).toEqual(["term"]);
  });

  it("requests assignments scoped to the course, with include[]=submission", async () => {
    const { fetchFn, urls } = stubFetch([{ status: 200, body: [] }]);
    const client = createCanvasClient(fetchFn);
    await client.listAssignments("https://uta.instructure.com", "tok", 12345);

    const url = new URL(urls[0]!);
    expect(url.pathname).toBe("/api/v1/courses/12345/assignments");
    expect(url.searchParams.getAll("include[]")).toEqual(["submission"]);
  });

  it("requests announcements scoped by context_codes[]=course_<id>", async () => {
    const { fetchFn, urls } = stubFetch([{ status: 200, body: [] }]);
    const client = createCanvasClient(fetchFn);
    await client.listAnnouncements("https://uta.instructure.com", "tok", 12345);

    const url = new URL(urls[0]!);
    expect(url.pathname).toBe("/api/v1/announcements");
    expect(url.searchParams.getAll("context_codes[]")).toEqual(["course_12345"]);
  });

  it("requests calendar events with type=event and context_codes[]=course_<id>", async () => {
    const { fetchFn, urls } = stubFetch([{ status: 200, body: [] }]);
    const client = createCanvasClient(fetchFn);
    await client.listCalendarEvents("https://uta.instructure.com", "tok", 12345);

    const url = new URL(urls[0]!);
    expect(url.pathname).toBe("/api/v1/calendar_events");
    expect(url.searchParams.get("type")).toBe("event");
    expect(url.searchParams.getAll("context_codes[]")).toEqual(["course_12345"]);
  });
});

describe("createCanvasClient: error classification, never the raw body", () => {
  it("classifies 401 as auth_failed", async () => {
    const { fetchFn } = stubFetch([
      { status: 401, body: { errors: [{ message: "Invalid access token." }] } },
    ]);
    const client = createCanvasClient(fetchFn);
    await expect(client.getSelf("https://x.instructure.com", "tok")).rejects.toMatchObject({
      httpStatus: 401,
      code: "auth_failed",
    });
  });

  it("classifies a 403 with the documented rate-limit status token as rate_limited", async () => {
    const { fetchFn } = stubFetch([{ status: 403, body: { status: "rate limit exceeded" } }]);
    const client = createCanvasClient(fetchFn);
    await expect(client.getSelf("https://x.instructure.com", "tok")).rejects.toMatchObject({
      httpStatus: 403,
      code: "rate_limited",
    });
  });

  it("classifies a 403 with X-Rate-Limit-Remaining: 0 as rate_limited even without the status token", async () => {
    const { fetchFn } = stubFetch([
      { status: 403, body: {}, headers: { "X-Rate-Limit-Remaining": "0" } },
    ]);
    const client = createCanvasClient(fetchFn);
    await expect(client.getSelf("https://x.instructure.com", "tok")).rejects.toMatchObject({
      httpStatus: 403,
      code: "rate_limited",
    });
  });

  it("classifies an ordinary 403 (no rate-limit signal) as auth_failed", async () => {
    const { fetchFn } = stubFetch([
      {
        status: 403,
        body: { errors: [{ message: "user not authorized to perform that action" }] },
        headers: { "X-Rate-Limit-Remaining": "699" },
      },
    ]);
    const client = createCanvasClient(fetchFn);
    await expect(client.getSelf("https://x.instructure.com", "tok")).rejects.toMatchObject({
      httpStatus: 403,
      code: "auth_failed",
    });
  });

  it("classifies 404 as not_found", async () => {
    const { fetchFn } = stubFetch([{ status: 404, body: {} }]);
    const client = createCanvasClient(fetchFn);
    await expect(
      client.listAssignments("https://x.instructure.com", "tok", 999),
    ).rejects.toMatchObject({ httpStatus: 404, code: "not_found" });
  });

  it("classifies 429 as rate_limited", async () => {
    const { fetchFn } = stubFetch([{ status: 429, body: {} }]);
    const client = createCanvasClient(fetchFn);
    await expect(client.getSelf("https://x.instructure.com", "tok")).rejects.toMatchObject({
      httpStatus: 429,
      code: "rate_limited",
    });
  });

  it("classifies a 5xx as provider_error", async () => {
    const { fetchFn } = stubFetch([{ status: 503, body: {} }]);
    const client = createCanvasClient(fetchFn);
    await expect(client.getSelf("https://x.instructure.com", "tok")).rejects.toMatchObject({
      httpStatus: 503,
      code: "provider_error",
    });
  });

  it("never carries the provider's message text -- even a message containing a token-like fragment", async () => {
    const { fetchFn } = stubFetch([
      {
        status: 401,
        body: { errors: [{ message: "Invalid access token 7~AbCdEf123456 for owner@uta.edu" }] },
      },
    ]);
    const client = createCanvasClient(fetchFn);
    try {
      await client.getSelf("https://x.instructure.com", "tok");
      throw new Error("expected getSelf to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(CanvasApiError);
      const message = (err as CanvasApiError).message;
      expect(message).toBe("Canvas API 401 (auth_failed)");
      expect(message).not.toMatch(/token|owner@uta\.edu/i);
    }
  });

  it("does not throw when the error body is not JSON", async () => {
    const urls: string[] = [];
    const fetchFn: FetchLike = (url) => {
      urls.push(url);
      return Promise.resolve(
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      );
    };
    const client = createCanvasClient(fetchFn);
    await expect(client.getSelf("https://x.instructure.com", "tok")).rejects.toMatchObject({
      httpStatus: 502,
      code: "provider_error",
    });
  });
});

// Checkpoint 10.1's own adversarial security review found `request()` made a
// live, unvalidated outbound call carrying the PAT to whatever base URL was
// submitted. These prove the fix is actually wired into the client every
// caller uses, not just present in the standalone validator (ssrf.test.ts).
describe("createCanvasClient: SSRF protection", () => {
  it("never calls fetch at all for a blocked base URL", async () => {
    let called = false;
    const fetchFn: FetchLike = () => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    };
    const client = createCanvasClient(fetchFn);
    await expect(client.getSelf("https://169.254.169.254", "tok")).rejects.toBeInstanceOf(
      CanvasUrlBlockedError,
    );
    expect(called).toBe(false);
  });

  it("rejects a non-HTTPS base URL the same way", async () => {
    const fetchFn: FetchLike = () => Promise.resolve(new Response("{}", { status: 200 }));
    const client = createCanvasClient(fetchFn);
    await expect(
      client.getSelf("http://not-a-real-canvas.example.com", "tok"),
    ).rejects.toBeInstanceOf(CanvasUrlBlockedError);
  });

  it("follows a same-origin redirect and forwards Authorization to it", async () => {
    const { fetchFn, urls, inits } = stubFetch([
      { status: 302, headers: { location: "https://uta.instructure.com/api/v1/users/self/" } },
      { status: 200, body: { id: 1, name: "Jane" } },
    ]);
    const client = createCanvasClient(fetchFn);
    const self = await client.getSelf("https://uta.instructure.com", "pat-token-123");
    expect(self.name).toBe("Jane");
    expect(urls).toEqual([
      "https://uta.instructure.com/api/v1/users/self",
      "https://uta.instructure.com/api/v1/users/self/",
    ]);
    const secondHeaders = new Headers(inits[1]?.headers);
    expect(secondHeaders.get("Authorization")).toBe("Bearer pat-token-123");
  });

  it("DROPS Authorization when a redirect leaves the original origin", async () => {
    const { fetchFn, inits } = stubFetch([
      { status: 302, headers: { location: "https://evil.example.com/steal" } },
      { status: 200, body: {} },
    ]);
    const client = createCanvasClient(fetchFn);
    await client.getSelf("https://uta.instructure.com", "pat-token-123");
    const firstHeaders = new Headers(inits[0]?.headers);
    const secondHeaders = new Headers(inits[1]?.headers);
    expect(firstHeaders.get("Authorization")).toBe("Bearer pat-token-123");
    expect(secondHeaders.has("Authorization")).toBe(false);
  });

  it("re-validates a redirect target, blocking one that points at a metadata IP", async () => {
    const { fetchFn } = stubFetch([
      { status: 302, headers: { location: "https://169.254.169.254/steal" } },
    ]);
    const client = createCanvasClient(fetchFn);
    await expect(
      client.getSelf("https://uta.instructure.com", "pat-token-123"),
    ).rejects.toBeInstanceOf(CanvasUrlBlockedError);
  });

  it("caps redirect chains rather than looping forever", async () => {
    const replies = Array.from({ length: 10 }, () => ({
      status: 302,
      headers: { location: "https://uta.instructure.com/loop" },
    }));
    const { fetchFn } = stubFetch(replies);
    const client = createCanvasClient(fetchFn);
    await expect(client.getSelf("https://uta.instructure.com", "tok")).rejects.toBeInstanceOf(
      CanvasUrlBlockedError,
    );
  });
});

describe("createCanvasClient: header-unsafe tokens are refused before any request (10.2 hotfix)", () => {
  const LEAK = "1234~SENTINELleakcheckAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  it("isHeaderSafeToken accepts a PAT and rejects whitespace/control characters", () => {
    expect(isHeaderSafeToken("1234~abcDEF0123")).toBe(true);
    for (const bad of ["", "a b", "a\nb", "a\rb", "a\tb", "a\u0000b", "\n1234~abc"]) {
      expect(isHeaderSafeToken(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("throws CanvasTokenFormatError without calling fetch, and the error carries no part of the token", async () => {
    const { fetchFn, urls } = stubFetch([{ status: 200, body: { id: 1 } }]);
    const client = createCanvasClient(fetchFn);
    const token = `\n${LEAK}`;
    let caught: unknown;
    try {
      await client.getSelf("https://uta.instructure.com", token);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanvasTokenFormatError);
    expect(urls).toHaveLength(0);
    const text = `${(caught as Error).message}\n${(caught as Error).stack ?? ""}`;
    expect(text).not.toContain("SENTINEL");
    expect(text).not.toContain("leakcheck");
  });

  it("applies to every method, including the ones the worker's sync calls", async () => {
    const { fetchFn, urls } = stubFetch([{ status: 200, body: [] }]);
    const client = createCanvasClient(fetchFn);
    await expect(
      client.listActiveCourses("https://uta.instructure.com", "12~ab cd"),
    ).rejects.toBeInstanceOf(CanvasTokenFormatError);
    expect(urls).toHaveLength(0);
  });
});
