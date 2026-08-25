import { describe, expect, it, vi } from "vitest";
import {
  createGoogleHealthClient,
  GoogleHealthApiError,
  HEALTH_API_BASE,
} from "./google-health-client.js";
import { civil, createFakeGoogleHealthClient, rollupBucket } from "./google-health-client.fake.js";
import { DATA_SOURCE_FAMILY_ALL } from "./google-health-catalog.js";
import type { FetchLike } from "./google-health-oauth.js";

// fetch's first argument is a union that includes Request, so String() on it
// could yield "[object Object]". Narrow explicitly, and derive the type from
// FetchLike rather than naming a global this tsconfig's lib may not expose.
type FetchInput = Parameters<FetchLike>[0];

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

// Typed as FetchLike so mock.calls is a real tuple, and assertions on the
// request URL and body are actually type-checked.
function ok(body: unknown) {
  return vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
}
function fail(status: number, body: unknown = {}) {
  return vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("createGoogleHealthClient request shaping", () => {
  it("targets v4 and sends a bearer token", async () => {
    const f = ok({ healthUserId: "hu-1" });
    await createGoogleHealthClient(f).getIdentity("tok");
    const call = f.mock.calls[0]!;
    expect(urlOf(call[0])).toBe(`${HEALTH_API_BASE}/users/me/identity`);
    expect(HEALTH_API_BASE).toContain("/v4");
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok");
  });

  it("returns a null legacy id rather than undefined when absent", async () => {
    const f = ok({ healthUserId: "hu-1" });
    await expect(createGoogleHealthClient(f).getIdentity("tok")).resolves.toEqual({
      healthUserId: "hu-1",
      legacyUserId: null,
    });
  });

  it("throws rather than returning a partial identity", async () => {
    const f = ok({});
    await expect(createGoogleHealthClient(f).getIdentity("tok")).rejects.toThrow(/no healthUserId/);
  });

  it("defaults dailyRollUp to one-day windows", async () => {
    const f = ok({ rollupDataPoints: [] });
    await createGoogleHealthClient(f).dailyRollUp({
      accessToken: "t",
      dataType: "steps",
      range: { start: civil("2026-08-20"), end: civil("2026-08-24") },
    });
    const body = JSON.parse(f.mock.calls[0]![1]?.body as string) as {
      windowSizeDays: number;
      range: Record<string, unknown>;
    };
    // CivilTimeInterval uses bare start/end. startTime/endTime -- which the
    // interval ON a record does use -- makes Google reject every rollup with
    // `Unknown name "startTime" at 'range'`. Found live during 6.2P.
    expect(Object.keys(body.range).sort()).toEqual(["end", "start"]);
    // Sending pageSize on a rollup makes Google reject the call outright, with
    // the misleading reason INVALID_ROLLUP_QUERY_DURATION. Verified live, 6.2P.
    expect(body).not.toHaveProperty("pageSize");
    // windowSizeDays > 1 would need alignment arithmetic and destroy per-day
    // resolution, so 1 is the only value used.
    expect(body.windowSizeDays).toBe(1);
    expect(urlOf(f.mock.calls[0]![0])).toContain("dataPoints:dailyRollUp");
  });

  it("puts the kebab dataType in the path and the snake filter in the query", async () => {
    const f = ok({ dataPoints: [] });
    await createGoogleHealthClient(f).list({
      accessToken: "t",
      dataType: "daily-resting-heart-rate",
      filter: 'daily_resting_heart_rate.date >= "2026-08-20"',
    });
    const url = urlOf(f.mock.calls[0]![0]);
    expect(url).toContain("/dataTypes/daily-resting-heart-rate/dataPoints");
    expect(decodeURIComponent(url)).toContain("daily_resting_heart_rate.date");
  });

  it("sends dataSourceFamily on reconcile as a full resource name", async () => {
    const f = ok({ dataPoints: [] });
    await createGoogleHealthClient(f).reconcile({
      accessToken: "t",
      dataType: "heart-rate",
      filter: 'heart_rate.sample_time.civil_time >= "2026-08-20T00:00:00"',
      dataSourceFamily: DATA_SOURCE_FAMILY_ALL,
    });
    const url = decodeURIComponent(urlOf(f.mock.calls[0]![0]));
    expect(url).toContain("dataPoints:reconcile");
    expect(url).toContain("users/me/dataSourceFamilies/all-sources");
  });

  it("normalizes a missing collection to an empty array", async () => {
    const f = ok({});
    await expect(
      createGoogleHealthClient(f).list({ accessToken: "t", dataType: "sleep", filter: "x" }),
    ).resolves.toEqual({ dataPoints: [] });
  });
});

describe("GoogleHealthApiError classification", () => {
  it("classifies 429 as rate-limited and transient", async () => {
    const f = fail(429, { error: { message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } });
    try {
      await createGoogleHealthClient(f).getIdentity("t");
      expect.unreachable();
    } catch (e) {
      const err = e as GoogleHealthApiError;
      expect(err.isRateLimited).toBe(true);
      expect(err.isTransient).toBe(true);
      expect(err.isForbidden).toBe(false);
    }
  });

  // 403 is reported as exactly what it is: forbidden. Whether that means a
  // denied scope is decided in sync/capability.ts from an evidenced reason
  // token -- never from the status, which is equally consistent with a
  // malformed resource name.
  it("classifies 403 as forbidden, not as an auth failure", async () => {
    const f = fail(403, { error: { message: "Insufficient scope", status: "PERMISSION_DENIED" } });
    try {
      await createGoogleHealthClient(f).getIdentity("t");
      expect.unreachable();
    } catch (e) {
      const err = e as GoogleHealthApiError;
      expect(err.isForbidden).toBe(true);
      expect(err.isAuthFailure).toBe(false);
      expect(err.isTransient).toBe(false);
    }
  });

  it("classifies 5xx as transient", async () => {
    const f = fail(503);
    await expect(createGoogleHealthClient(f).getIdentity("t")).rejects.toSatisfy(
      (e) => (e as GoogleHealthApiError).isTransient,
    );
  });

  it("classifies 401 as an auth failure needing re-authorization", async () => {
    const f = fail(401);
    await expect(createGoogleHealthClient(f).getIdentity("t")).rejects.toSatisfy(
      (e) => (e as GoogleHealthApiError).isAuthFailure,
    );
  });

  it("tolerates a non-JSON error body", async () => {
    // An HTML error page from a proxy carries no status token, so the message
    // degrades to the bare status rather than quoting the page.
    const f = vi.fn().mockResolvedValue(new Response("<html>", { status: 500 }));
    await expect(createGoogleHealthClient(f).getIdentity("t")).rejects.toThrow(
      "Google Health API 500",
    );
  });
});

describe("GoogleHealthApiError error surface", () => {
  // Google's error.message is prose; error.details[].reason is the only
  // machine-readable part. Discarding the reason and keeping only the status is
  // what made 6.2P misread two request-shape bugs of ours as eight unsupported
  // metrics.
  it("surfaces error.details reasons and domains, deduped and order-preserved", async () => {
    const f = fail(400, {
      error: {
        message: "Invalid argument",
        status: "INVALID_ARGUMENT",
        details: [
          { reason: "INVALID_ROLLUP_QUERY_DURATION", domain: "googleapis.com" },
          { reason: "INVALID_ROLLUP_QUERY_DURATION", domain: "googleapis.com" },
          { reason: "SECOND_REASON", domain: "health.googleapis.com" },
        ],
      },
    });
    try {
      await createGoogleHealthClient(f).getIdentity("t");
      expect.unreachable();
    } catch (e) {
      const err = e as GoogleHealthApiError;
      expect(err.errorReasons).toEqual(["INVALID_ROLLUP_QUERY_DURATION", "SECOND_REASON"]);
      expect(err.errorDomains).toEqual(["googleapis.com", "health.googleapis.com"]);
      expect(err.googleStatus).toBe("INVALID_ARGUMENT");
    }
  });

  it("reports empty reason and domain lists when details are absent", async () => {
    const f = fail(403, { error: { status: "PERMISSION_DENIED" } });
    try {
      await createGoogleHealthClient(f).getIdentity("t");
      expect.unreachable();
    } catch (e) {
      const err = e as GoogleHealthApiError;
      expect(err.errorReasons).toEqual([]);
      expect(err.errorDomains).toEqual([]);
    }
  });

  it("builds the message from status tokens rather than Google's prose", async () => {
    const f = fail(400, { error: { message: "Unknown name", status: "INVALID_ARGUMENT" } });
    await expect(createGoogleHealthClient(f).getIdentity("t")).rejects.toThrow(
      "Google Health API 400 INVALID_ARGUMENT",
    );
  });

  it("omits the status token entirely when Google sends none", async () => {
    const f = fail(418, { error: { message: "teapot" } });
    await expect(createGoogleHealthClient(f).getIdentity("t")).rejects.toThrow(
      "Google Health API 418",
    );
  });

  // THE reason the message is constructed rather than passed through. Google's
  // INVALID_ARGUMENT prose echoes the offending request, the worker has no log
  // redaction, and pg-boss serializes a thrown error into pgboss.job.output --
  // a durable Postgres table. Anything in this message is stored forever.
  it("lets no part of Google's message survive onto the error, in any field", async () => {
    const f = fail(400, {
      error: {
        message: 'Unknown name "startTime": secret-value-12345 at heart_rate.beats_per_minute',
        status: "INVALID_ARGUMENT",
      },
    });
    try {
      await createGoogleHealthClient(f).getIdentity("t");
      expect.unreachable();
    } catch (e) {
      const err = e as GoogleHealthApiError;
      expect(err.message).toBe("Google Health API 400 INVALID_ARGUMENT");
      // Not merely absent from the message -- absent from every enumerable and
      // non-enumerable own property, so no future field can quietly retain it.
      const everything =
        JSON.stringify(err, Object.getOwnPropertyNames(err)) + String(err.stack ?? "");
      expect(everything).not.toContain("secret-value-12345");
      expect(everything).not.toContain("beats_per_minute");
      expect(everything).not.toContain("startTime");
    }
  });
});

describe("request cancellation", () => {
  // The limiter owns the concurrency budget and therefore owns the deadline.
  // The client adds no default timeout of its own, so a caller that forgets to
  // pass a signal gets an obviously unbounded call rather than a silent one.
  it("passes an AbortSignal through on every method", async () => {
    const controller = new AbortController();

    const rollup = ok({ rollupDataPoints: [] });
    await createGoogleHealthClient(rollup).dailyRollUp({
      accessToken: "t",
      dataType: "steps",
      range: { start: civil("2026-08-20"), end: civil("2026-08-24") },
      signal: controller.signal,
    });
    expect(rollup.mock.calls[0]![1]?.signal).toBe(controller.signal);

    const list = ok({ dataPoints: [] });
    await createGoogleHealthClient(list).list({
      accessToken: "t",
      dataType: "sleep",
      filter: "x",
      signal: controller.signal,
    });
    expect(list.mock.calls[0]![1]?.signal).toBe(controller.signal);

    const reconcile = ok({ dataPoints: [] });
    await createGoogleHealthClient(reconcile).reconcile({
      accessToken: "t",
      dataType: "heart-rate",
      filter: "x",
      signal: controller.signal,
    });
    expect(reconcile.mock.calls[0]![1]?.signal).toBe(controller.signal);
  });

  it("sends no signal key at all when none is supplied", async () => {
    const f = ok({ dataPoints: [] });
    await createGoogleHealthClient(f).list({ accessToken: "t", dataType: "sleep", filter: "x" });
    expect(f.mock.calls[0]![1]).not.toHaveProperty("signal");
  });
});

describe("FakeGoogleHealthClient", () => {
  it("drains queued responses in order", async () => {
    const fake = createFakeGoogleHealthClient();
    fake.queueDailyRollUp("steps", {
      rollupDataPoints: [rollupBucket("2026-08-20", "count", "10")],
    });
    fake.queueDailyRollUp("steps", {
      rollupDataPoints: [rollupBucket("2026-08-21", "count", "20")],
    });
    const a = await fake.dailyRollUp({
      accessToken: "t",
      dataType: "steps",
      range: { start: civil("2026-08-20"), end: civil("2026-08-21") },
    });
    const b = await fake.dailyRollUp({
      accessToken: "t",
      dataType: "steps",
      range: { start: civil("2026-08-21"), end: civil("2026-08-22") },
    });
    expect(a.rollupDataPoints[0]!["count"]).toBe("10");
    expect(b.rollupDataPoints[0]!["count"]).toBe("20");
  });

  // The property that makes the fake trustworthy: an unexpected extra call
  // fails loudly rather than silently returning an empty page and a green test.
  it("throws on an unqueued call instead of returning empty", async () => {
    const fake = createFakeGoogleHealthClient();
    await expect(fake.list({ accessToken: "t", dataType: "sleep", filter: "x" })).rejects.toThrow(
      /nothing queued/,
    );
  });

  it("can script an API error", async () => {
    const fake = createFakeGoogleHealthClient();
    fake.queueList("sleep", new GoogleHealthApiError("nope", 429, "RESOURCE_EXHAUSTED"));
    await expect(
      fake.list({ accessToken: "t", dataType: "sleep", filter: "x" }),
    ).rejects.toMatchObject({ httpStatus: 429 });
  });

  it("records calls for assertion, including the filter used", async () => {
    const fake = createFakeGoogleHealthClient();
    fake.queueList("sleep", { dataPoints: [] });
    await fake.list({
      accessToken: "t",
      dataType: "sleep",
      filter: 'sleep.interval.civil_end_time >= "2026-08-20T00:00:00"',
      pageSize: 25,
    });
    const [call] = fake.callsFor("list");
    expect(call!.filter).toContain("civil_end_time");
    expect(call!.pageSize).toBe(25);
  });

  it("serves a default identity without scripting", async () => {
    const fake = createFakeGoogleHealthClient({
      identity: { healthUserId: "hu-x", legacyUserId: "fb-1" },
    });
    await expect(fake.getIdentity("t")).resolves.toEqual({
      healthUserId: "hu-x",
      legacyUserId: "fb-1",
    });
  });
});
