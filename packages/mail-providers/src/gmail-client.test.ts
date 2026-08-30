import { describe, expect, it } from "vitest";
import { GMAIL_METADATA_HEADERS } from "./gmail-catalog.js";
import { createGmailClient, GmailApiError, parseRetryAfterSeconds } from "./gmail-client.js";
import type { FetchLike } from "./mail-client.js";

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

describe("parseRetryAfterSeconds", () => {
  // ADR-053 requires honouring Retry-After (unlike the Google Health limiter,
  // which uses blind jitter because that API sends no such header) and requires
  // proving it DETERMINISTICALLY -- a real Gmail 429 is not required for
  // acceptance, because provoking one means deliberately abusing the quota.

  it("reads delta-seconds", () => {
    expect(parseRetryAfterSeconds("0")).toBe(0);
    expect(parseRetryAfterSeconds("1")).toBe(1);
    expect(parseRetryAfterSeconds("120")).toBe(120);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRetryAfterSeconds("  30  ")).toBe(30);
  });

  it("reads an HTTP-date against an injected clock, to the exact second", () => {
    const now = Date.parse("2026-08-30T12:00:00Z");
    expect(parseRetryAfterSeconds("Sun, 30 Aug 2026 12:00:30 GMT", now)).toBe(30);
    expect(parseRetryAfterSeconds("Sun, 30 Aug 2026 12:02:00 GMT", now)).toBe(120);
  });

  it("rounds a sub-second remainder UP, never down", () => {
    // Rounding down would return 0 and retry immediately into the same limit.
    const now = Date.parse("2026-08-30T12:00:00.500Z");
    expect(parseRetryAfterSeconds("Sun, 30 Aug 2026 12:00:02 GMT", now)).toBe(2);
  });

  it("clamps a past date to 0 rather than going negative", () => {
    const now = Date.parse("2026-08-30T12:00:00Z");
    expect(parseRetryAfterSeconds("Sun, 30 Aug 2026 11:59:00 GMT", now)).toBe(0);
  });

  it("returns null for anything it cannot read with confidence", () => {
    // The caller then falls back to its own backoff, rather than acting on a
    // misparse. "12.5" and "12s" must NOT be silently truncated to 12.
    for (const bad of [null, undefined, "", "   ", "soon", "12.5", "12s", "-5", "NaN"]) {
      expect(parseRetryAfterSeconds(bad)).toBeNull();
    }
  });
});

describe("GmailApiError", () => {
  it("constructs its message and NEVER carries the provider's prose", async () => {
    const { fetchFn } = stubFetch([
      {
        status: 400,
        body: {
          error: {
            status: "INVALID_ARGUMENT",
            // Gmail's real prose echoes the offending request value back. This
            // is exactly the string that must not survive into pgboss.job.output
            // or an unredacted worker log line.
            message: "Invalid startHistoryId 987654321 for user person@example.com",
            errors: [{ reason: "invalidArgument", domain: "global" }],
          },
        },
      },
    ]);
    const client = createGmailClient(fetchFn);
    await expect(client.listHistory("tok", { startHistoryId: "1" })).rejects.toBeInstanceOf(
      GmailApiError,
    );

    let caught: GmailApiError | undefined;
    try {
      await createGmailClient(
        stubFetch([
          {
            status: 400,
            body: {
              error: {
                status: "INVALID_ARGUMENT",
                message: "Invalid startHistoryId 987654321 for user person@example.com",
                errors: [{ reason: "invalidArgument", domain: "global" }],
              },
            },
          },
        ]).fetchFn,
      ).listHistory("tok", { startHistoryId: "1" });
    } catch (e) {
      caught = e as GmailApiError;
    }

    expect(caught).toBeDefined();
    // The whole point: the message is constructed from a status code and token.
    expect(caught?.message).toBe("Gmail API 400 INVALID_ARGUMENT");
    // Serialize the error the way pg-boss's serialize-error would -- by walking
    // own-enumerable properties plus message and stack -- and prove the prose
    // is absent from every one of them.
    const serialized = JSON.stringify({
      message: caught?.message,
      stack: caught?.stack,
      ...Object.fromEntries(Object.entries(caught ?? {})),
    });
    expect(serialized).not.toContain("startHistoryId 987654321");
    expect(serialized).not.toContain("person@example.com");
    // The machine-readable half is not lost.
    expect(caught?.reasons).toEqual(["invalidArgument"]);
    expect(caught?.domains).toEqual(["global"]);
  });

  it("classifies status codes into actionable predicates", () => {
    const at = (s: number) => new GmailApiError(s, undefined, [], null);
    expect(at(429).isRateLimited).toBe(true);
    expect(at(401).isAuthFailure).toBe(true);
    expect(at(403).isForbidden).toBe(true);
    expect(at(404).isNotFound).toBe(true);
    expect(at(429).isTransient).toBe(true);
    expect(at(503).isTransient).toBe(true);
    expect(at(400).isTransient).toBe(false);
    expect(at(404).isTransient).toBe(false);
  });

  it("carries Retry-After off a real 429 response", async () => {
    const { fetchFn } = stubFetch([
      {
        status: 429,
        body: {
          error: { status: "RESOURCE_EXHAUSTED", errors: [{ reason: "rateLimitExceeded" }] },
        },
        headers: { "retry-after": "42" },
      },
    ]);
    let caught: GmailApiError | undefined;
    try {
      await createGmailClient(fetchFn).getProfile("tok");
    } catch (e) {
      caught = e as GmailApiError;
    }
    expect(caught?.isRateLimited).toBe(true);
    expect(caught?.retryAfterSeconds).toBe(42);
    expect(caught?.reasons).toEqual(["rateLimitExceeded"]);
  });

  it("survives a non-JSON error body without losing the status", async () => {
    const fetchFn: FetchLike = () =>
      Promise.resolve(new Response("<html>502</html>", { status: 502 }));
    let caught: GmailApiError | undefined;
    try {
      await createGmailClient(fetchFn).getProfile("tok");
    } catch (e) {
      caught = e as GmailApiError;
    }
    expect(caught?.httpStatus).toBe(502);
    expect(caught?.isTransient).toBe(true);
    expect(caught?.message).toBe("Gmail API 502");
  });

  it("dedupes reason tokens in the order returned", () => {
    const err = new GmailApiError(
      403,
      "PERMISSION_DENIED",
      [{ reason: "forbidden" }, { reason: "forbidden" }, { reason: "insufficientPermissions" }],
      null,
    );
    expect(err.reasons).toEqual(["forbidden", "insufficientPermissions"]);
  });
});

describe("createGmailClient request shapes", () => {
  it("sends the bearer token and asks for JSON", async () => {
    const { fetchFn, inits } = stubFetch([{ body: { emailAddress: "a@b.com", historyId: "5" } }]);
    await createGmailClient(fetchFn).getProfile("secret-token");
    const headers = inits[0]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer secret-token");
    expect(headers["Accept"]).toBe("application/json");
  });

  it("getProfile hits the profile endpoint", async () => {
    const { fetchFn, urls } = stubFetch([{ body: { emailAddress: "a@b.com", historyId: "5" } }]);
    await createGmailClient(fetchFn).getProfile("tok");
    expect(urls[0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/profile");
  });

  it("getMessageMetadata always requests format=metadata and never format=full", async () => {
    const { fetchFn, urls } = stubFetch([{ body: { id: "m1", threadId: "t1" } }]);
    await createGmailClient(fetchFn).getMessageMetadata("tok", { id: "m1" });
    const url = new URL(urls[0]!);
    expect(url.searchParams.get("format")).toBe("metadata");
    // format is not a caller-settable field at all, so FULL/RAW -- which Gmail
    // rejects under gmail.metadata -- are unrepresentable rather than merely
    // discouraged.
    expect(url.searchParams.getAll("format")).toEqual(["metadata"]);
  });

  it("getMessageMetadata defaults to the four-header allowlist", async () => {
    const { fetchFn, urls } = stubFetch([{ body: { id: "m1", threadId: "t1" } }]);
    await createGmailClient(fetchFn).getMessageMetadata("tok", { id: "m1" });
    const url = new URL(urls[0]!);
    expect(url.searchParams.getAll("metadataHeaders")).toEqual([...GMAIL_METADATA_HEADERS]);
  });

  it("getMessageMetadata percent-encodes the message id", async () => {
    const { fetchFn, urls } = stubFetch([{ body: { id: "a/b", threadId: "t" } }]);
    await createGmailClient(fetchFn).getMessageMetadata("tok", { id: "a/b?c" });
    expect(urls[0]).toContain("/messages/a%2Fb%3Fc?");
  });

  it("listMessages repeats labelIds and never sends a q parameter", async () => {
    const { fetchFn, urls } = stubFetch([{ body: { messages: [] } }]);
    await createGmailClient(fetchFn).listMessages("tok", {
      labelIds: ["INBOX", "UNREAD"],
      maxResults: 50,
    });
    const url = new URL(urls[0]!);
    expect(url.searchParams.getAll("labelIds")).toEqual(["INBOX", "UNREAD"]);
    expect(url.searchParams.get("maxResults")).toBe("50");
    // Gmail rejects `q` under gmail.metadata with
    // "403 Metadata scope does not support 'q' parameter". It is not a field on
    // ListMessagesRequest, so it cannot be sent by accident.
    expect(url.searchParams.has("q")).toBe(false);
  });

  it("clamps maxResults to the provider cap on both list endpoints", async () => {
    const { fetchFn, urls } = stubFetch([{ body: { messages: [] } }, { body: { historyId: "9" } }]);
    const client = createGmailClient(fetchFn);
    await client.listMessages("tok", { maxResults: 10_000 });
    await client.listHistory("tok", { startHistoryId: "1", maxResults: 10_000 });
    expect(new URL(urls[0]!).searchParams.get("maxResults")).toBe("500");
    expect(new URL(urls[1]!).searchParams.get("maxResults")).toBe("500");
  });

  it("listHistory sends the opaque cursor verbatim", async () => {
    const { fetchFn, urls } = stubFetch([{ body: { historyId: "12346" } }]);
    await createGmailClient(fetchFn).listHistory("tok", {
      startHistoryId: "12345",
      labelId: "INBOX",
      historyTypes: ["messageAdded", "labelAdded"],
    });
    const url = new URL(urls[0]!);
    // Verbatim: not parsed, not coerced to a number, not re-serialized.
    expect(url.searchParams.get("startHistoryId")).toBe("12345");
    expect(url.searchParams.get("labelId")).toBe("INBOX");
    expect(url.searchParams.getAll("historyTypes")).toEqual(["messageAdded", "labelAdded"]);
  });

  it("omits optional parameters entirely when not supplied", async () => {
    const { fetchFn, urls } = stubFetch([{ body: { messages: [] } }]);
    await createGmailClient(fetchFn).listMessages("tok", {});
    const url = new URL(urls[0]!);
    for (const key of ["labelIds", "maxResults", "pageToken", "includeSpamTrash"]) {
      expect(url.searchParams.has(key)).toBe(false);
    }
  });

  it("is a single-page primitive: it returns the page token and does not loop", async () => {
    const { fetchFn, urls } = stubFetch([
      { body: { messages: [{ id: "1", threadId: "t" }], nextPageToken: "PAGE2" } },
    ]);
    const page = await createGmailClient(fetchFn).listMessages("tok", {});
    expect(page.nextPageToken).toBe("PAGE2");
    // Exactly one request. The pagination loop, its cap and its truncation
    // reporting belong to the caller that owns the concurrency budget.
    expect(urls).toHaveLength(1);
  });

  it("threads an AbortSignal through when given one", async () => {
    const { fetchFn, inits } = stubFetch([{ body: { emailAddress: "a@b.com", historyId: "1" } }]);
    const controller = new AbortController();
    await createGmailClient(fetchFn).getProfile("tok", controller.signal);
    expect(inits[0]?.signal).toBe(controller.signal);
  });

  it("omits signal entirely when none is given", async () => {
    const { fetchFn, inits } = stubFetch([{ body: { emailAddress: "a@b.com", historyId: "1" } }]);
    await createGmailClient(fetchFn).getProfile("tok");
    expect("signal" in (inits[0] ?? {})).toBe(false);
  });
});
