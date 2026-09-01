import { MonitorFailureClassSchema } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  classifyHealthPayload,
  classifyTransportFailure,
  daysUntil,
  probeHttp,
  probeTls,
  type FetchLike,
  type TlsProbeFn,
} from "./probe.js";

const NOW = new Date("2026-09-01T12:00:00.000Z");

/** A fetch that returns one scripted response, recording what it was asked. */
function scriptedFetch(response: Response | Error): { fn: FetchLike; calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  const fn: FetchLike = (_url, init) => {
    calls.push(init ?? {});
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  };
  return { fn, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A monotonic fake clock, so latency assertions are exact rather than ranged. */
function clock(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe("probeHttp: success", () => {
  it("reports up when the status matches and records latency", async () => {
    const { fn } = scriptedFetch(new Response("", { status: 200 }));
    const result = await probeHttp(
      {
        url: "http://api:3000/health",
        expectedStatus: 200,
        timeoutMs: 5000,
        expectHealthyPayload: false,
      },
      fn,
      clock(1000, 1042),
    );
    expect(result).toEqual({ status: "up", httpStatus: 200, latencyMs: 42 });
  });

  it("never follows a redirect", async () => {
    // A monitor asks "is THIS endpoint serving?". Silently following a redirect
    // would report the health of a service nobody configured.
    const { fn, calls } = scriptedFetch(new Response("", { status: 200 }));
    await probeHttp(
      {
        url: "http://web:8080/",
        expectedStatus: 200,
        timeoutMs: 5000,
        expectHealthyPayload: false,
      },
      fn,
    );
    expect(calls[0]!.redirect).toBe("manual");
  });

  it("treats a 3xx as a plain status mismatch, so a redirecting target can expect it", async () => {
    const { fn } = scriptedFetch(new Response("", { status: 301 }));
    const mismatch = await probeHttp(
      {
        url: "http://web:8080/",
        expectedStatus: 200,
        timeoutMs: 5000,
        expectHealthyPayload: false,
      },
      fn,
    );
    expect(mismatch.status).toBe("down");

    const { fn: fn2 } = scriptedFetch(new Response("", { status: 301 }));
    const expected = await probeHttp(
      {
        url: "http://web:8080/",
        expectedStatus: 301,
        timeoutMs: 5000,
        expectHealthyPayload: false,
      },
      fn2,
    );
    expect(expected.status).toBe("up");
  });
});

describe("probeHttp: failure", () => {
  it("classifies a status mismatch with the status echoed", async () => {
    const { fn } = scriptedFetch(new Response("", { status: 503 }));
    const result = await probeHttp(
      {
        url: "http://api:3000/health",
        expectedStatus: 200,
        timeoutMs: 5000,
        expectHealthyPayload: false,
      },
      fn,
    );
    expect(result.status).toBe("down");
    if (result.status === "down") {
      // Three digits, incapable of carrying a secret -- the one echoed value.
      expect(result.failureClass).toBe("http_status:503");
      expect(result.httpStatus).toBe(503);
    }
  });

  it("classifies a timeout distinctly from unreachable", async () => {
    const abort = new Error("aborted");
    abort.name = "TimeoutError";
    const timedOut = await probeHttp(
      {
        url: "http://api:3000/health",
        expectedStatus: 200,
        timeoutMs: 1,
        expectHealthyPayload: false,
      },
      scriptedFetch(abort).fn,
    );
    expect(timedOut.status).toBe("down");
    if (timedOut.status === "down") expect(timedOut.failureClass).toBe("timeout");

    const refused = await probeHttp(
      {
        url: "http://api:3000/health",
        expectedStatus: 200,
        timeoutMs: 5000,
        expectHealthyPayload: false,
      },
      scriptedFetch(new Error("ECONNREFUSED")).fn,
    );
    if (refused.status === "down") expect(refused.failureClass).toBe("unreachable");
  });

  it("NEVER lets a transport error's text or the URL escape", async () => {
    // Node's fetch failures carry the URL they failed against, and a target URL
    // may legitimately carry a token in a query string. An error message
    // reaching a durable column is a credential leak with extra steps.
    const leaky = new Error(
      "fetch failed: https://internal.example/health?token=SUPERSECRET (ECONNREFUSED 10.0.0.5:443)",
    );
    const result = await probeHttp(
      {
        url: "https://internal.example/health?token=SUPERSECRET",
        expectedStatus: 200,
        timeoutMs: 5000,
        expectHealthyPayload: false,
      },
      scriptedFetch(leaky).fn,
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SUPERSECRET");
    expect(serialized).not.toContain("internal.example");
    expect(serialized).not.toContain("10.0.0.5");
    expect(serialized).not.toContain("fetch failed");
  });

  it("only ever emits token-shaped failure classes", async () => {
    // Prose has spaces and capitals, so MonitorFailureClassSchema rejects it --
    // a writer reaching for err.message fails at the boundary rather than in
    // Postgres.
    const cases: (Response | Error)[] = [
      new Response("", { status: 404 }),
      new Response("", { status: 500 }),
      new Error("boom"),
      Object.assign(new Error("x"), { name: "AbortError" }),
    ];
    for (const scripted of cases) {
      const result = await probeHttp(
        { url: "http://x/", expectedStatus: 200, timeoutMs: 100, expectHealthyPayload: false },
        scriptedFetch(scripted).fn,
      );
      if (result.status === "down") {
        expect(() => MonitorFailureClassSchema.parse(result.failureClass)).not.toThrow();
      }
    }
  });
});

describe("health payload parsing", () => {
  it("accepts a fully healthy payload", () => {
    expect(
      classifyHealthPayload({ status: "ok", db: "connected", worker: { stale: false } }),
    ).toBeNull();
  });

  it("fails a 200 whose body says the database is unreachable", () => {
    // Recording this as up would make the monitor agree with the outage.
    expect(
      classifyHealthPayload({ status: "degraded", db: "unreachable", worker: { stale: false } }),
    ).toBe("health_db_unreachable");
  });

  it("fails a 200 whose body says the worker is stale", () => {
    expect(classifyHealthPayload({ status: "ok", db: "connected", worker: { stale: true } })).toBe(
      "health_worker_stale",
    );
  });

  it("distinguishes a degraded status from the two specific causes", () => {
    expect(
      classifyHealthPayload({ status: "degraded", db: "connected", worker: { stale: false } }),
    ).toBe("health_degraded");
  });

  it("fails a body that is not a Personal OS health response at all", () => {
    // "The wrong thing is answering on this port" is exactly the outage a
    // monitor exists to catch.
    expect(classifyHealthPayload({ hello: "world" })).toBe("health_payload_unreadable");
    expect(classifyHealthPayload("<html>nginx</html>")).toBe("health_payload_unreadable");
    expect(classifyHealthPayload(null)).toBe("health_payload_unreadable");
  });

  it("fails the whole probe when the body is unreadable", async () => {
    const { fn } = scriptedFetch(new Response("not json", { status: 200 }));
    const result = await probeHttp(
      {
        url: "http://api:3000/health",
        expectedStatus: 200,
        timeoutMs: 5000,
        expectHealthyPayload: true,
      },
      fn,
    );
    expect(result.status).toBe("down");
    if (result.status === "down") expect(result.failureClass).toBe("health_payload_unreadable");
  });

  it("passes a healthy payload end to end", async () => {
    const { fn } = scriptedFetch(
      jsonResponse(200, {
        status: "ok",
        db: "connected",
        worker: { lastBeatAt: null, stale: false },
      }),
    );
    const result = await probeHttp(
      {
        url: "http://api:3000/health",
        expectedStatus: 200,
        timeoutMs: 5000,
        expectHealthyPayload: true,
      },
      fn,
    );
    expect(result.status).toBe("up");
  });

  it("does not parse the body when the target does not ask for it", async () => {
    const { fn } = scriptedFetch(new Response("<html>a web page</html>", { status: 200 }));
    const result = await probeHttp(
      {
        url: "http://web:8080/",
        expectedStatus: 200,
        timeoutMs: 5000,
        expectHealthyPayload: false,
      },
      fn,
    );
    expect(result.status).toBe("up");
  });
});

describe("transport classification", () => {
  it("maps abort-shaped errors to timeout and everything else to unreachable", () => {
    expect(classifyTransportFailure(Object.assign(new Error(""), { name: "TimeoutError" }))).toBe(
      "timeout",
    );
    expect(classifyTransportFailure(Object.assign(new Error(""), { name: "AbortError" }))).toBe(
      "timeout",
    );
    expect(classifyTransportFailure(new Error("ENOTFOUND"))).toBe("unreachable");
    expect(classifyTransportFailure(null)).toBe("unreachable");
  });
});

describe("TLS expiry", () => {
  const tls =
    (validTo: string): TlsProbeFn =>
    () =>
      Promise.resolve({ validTo });

  it("floors days remaining rather than rounding", () => {
    // 0.9 days remaining is "expires today". Reporting it as 1 would let a
    // target sail past a one-day threshold on the last day it could still have
    // been renewed calmly.
    const observation = daysUntil("2026-09-02T09:00:00.000Z", NOW);
    expect(observation!.daysRemaining).toBe(0);
  });

  it("is silent for a comfortably valid certificate", async () => {
    const result = await probeTls(
      { url: "https://host.example/health", warnDays: 21, timeoutMs: 5000 },
      tls("2026-12-01T00:00:00.000Z"),
      NOW,
    );
    expect(result.failureClass).toBeNull();
    expect(result.observation!.daysRemaining).toBeGreaterThan(21);
  });

  it("warns while there is still time to act", async () => {
    const result = await probeTls(
      { url: "https://host.example/health", warnDays: 21, timeoutMs: 5000 },
      tls("2026-09-10T12:00:00.000Z"),
      NOW,
    );
    expect(result.failureClass).toBe("tls_expiring");
    expect(result.observation!.daysRemaining).toBe(9);
  });

  it("warns at exactly the threshold boundary", async () => {
    const at = await probeTls(
      { url: "https://host.example/", warnDays: 21, timeoutMs: 5000 },
      tls("2026-09-22T12:00:00.000Z"),
      NOW,
    );
    expect(at.observation!.daysRemaining).toBe(21);
    expect(at.failureClass).toBe("tls_expiring");

    const past = await probeTls(
      { url: "https://host.example/", warnDays: 21, timeoutMs: 5000 },
      tls("2026-09-23T12:00:00.000Z"),
      NOW,
    );
    expect(past.observation!.daysRemaining).toBe(22);
    expect(past.failureClass).toBeNull();
  });

  it("reports an already-expired certificate distinctly from an expiring one", async () => {
    const result = await probeTls(
      { url: "https://host.example/", warnDays: 21, timeoutMs: 5000 },
      tls("2026-08-01T00:00:00.000Z"),
      NOW,
    );
    expect(result.failureClass).toBe("tls_expired");
    expect(result.observation!.daysRemaining).toBeLessThan(0);
  });

  it("distinguishes an unreachable TLS endpoint from the service being down", async () => {
    const unreachable = await probeTls(
      { url: "https://host.example/", warnDays: 21, timeoutMs: 5000 },
      () => Promise.reject(new Error("ECONNREFUSED")),
      NOW,
    );
    expect(unreachable.failureClass).toBe("tls_unreachable");

    const timedOut = await probeTls(
      { url: "https://host.example/", warnDays: 21, timeoutMs: 5000 },
      () => Promise.reject(Object.assign(new Error(""), { name: "TimeoutError" })),
      NOW,
    );
    expect(timedOut.failureClass).toBe("tls_timeout");
  });

  it("never leaks a TLS error's text", async () => {
    const result = await probeTls(
      { url: "https://internal.example:8443/", warnDays: 21, timeoutMs: 5000 },
      () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:8443 for internal.example")),
      NOW,
    );
    expect(JSON.stringify(result)).not.toContain("10.0.0.5");
    expect(JSON.stringify(result)).not.toContain("internal.example");
  });

  it("handles an unparseable certificate date and a malformed url", async () => {
    const unreadable = await probeTls(
      { url: "https://host.example/", warnDays: 21, timeoutMs: 5000 },
      tls("not a date"),
      NOW,
    );
    expect(unreadable.failureClass).toBe("tls_unreadable");

    const invalid = await probeTls(
      { url: "not-a-url", warnDays: 21, timeoutMs: 5000 },
      tls("2026-12-01T00:00:00.000Z"),
      NOW,
    );
    expect(invalid.failureClass).toBe("tls_target_invalid");
  });

  it("defaults to port 443 and honours an explicit one", async () => {
    const seen: { host: string; port: number }[] = [];
    const capture: TlsProbeFn = (host, port) => {
      seen.push({ host, port });
      return Promise.resolve({ validTo: "2026-12-01T00:00:00.000Z" });
    };
    await probeTls(
      { url: "https://host.example/health", warnDays: 21, timeoutMs: 1 },
      capture,
      NOW,
    );
    await probeTls({ url: "https://host.example:8443/", warnDays: 21, timeoutMs: 1 }, capture, NOW);
    expect(seen).toEqual([
      { host: "host.example", port: 443 },
      { host: "host.example", port: 8443 },
    ]);
  });

  it("only ever emits token-shaped failure classes", async () => {
    for (const validTo of ["2026-08-01T00:00:00.000Z", "2026-09-10T12:00:00.000Z", "bad"]) {
      const result = await probeTls(
        { url: "https://host.example/", warnDays: 21, timeoutMs: 1 },
        tls(validTo),
        NOW,
      );
      if (result.failureClass !== null) {
        expect(() => MonitorFailureClassSchema.parse(result.failureClass)).not.toThrow();
      }
    }
  });
});

describe("latency is null when nothing responded (Checkpoint 7.7 live proof)", () => {
  // Found by the live proof, not by review: a real 1000ms timeout against a real
  // hanging server recorded `latency_ms: 1006`. That is the duration of OUR
  // timeout, not a measurement of the service -- the service answered nothing --
  // and it would put a fictional point in any latency view. The column is
  // nullable precisely so this case can be expressed.

  it("records NO latency for a timeout", async () => {
    const outcome = await probeHttp(
      {
        url: "https://host.example/health",
        expectedStatus: 200,
        timeoutMs: 50,
        expectHealthyPayload: false,
      },
      () => {
        const err = new Error("aborted");
        err.name = "TimeoutError";
        return Promise.reject(err);
      },
    );
    expect(outcome.status).toBe("down");
    expect(outcome.latencyMs).toBeNull();
  });

  it("records NO latency for an unreachable host", async () => {
    const outcome = await probeHttp(
      {
        url: "https://host.example/health",
        expectedStatus: 200,
        timeoutMs: 50,
        expectHealthyPayload: false,
      },
      () => Promise.reject(new Error("ECONNREFUSED")),
    );
    expect(outcome.status).toBe("down");
    expect(outcome.latencyMs).toBeNull();
  });

  it("STILL records latency when a response arrived but was unhealthy", async () => {
    // The distinction that makes the null meaningful: a real round trip happened
    // here, so there is a real number to report.
    const outcome = await probeHttp(
      {
        url: "https://host.example/health",
        expectedStatus: 200,
        timeoutMs: 500,
        expectHealthyPayload: false,
      },
      () => Promise.resolve(new Response("", { status: 503 })),
    );
    // Narrowed rather than asserted-through: `ProbeOutcome` is a union and the
    // `up` variant carries no `failureClass`, so reaching for it without this
    // guard is a type error -- one that vitest would have run straight past.
    if (outcome.status !== "down") throw new Error("expected a down outcome");
    expect(outcome.failureClass).toBe("http_status:503");
    expect(typeof outcome.latencyMs).toBe("number");
  });

  it("records latency on success", async () => {
    const outcome = await probeHttp(
      {
        url: "https://host.example/health",
        expectedStatus: 200,
        timeoutMs: 500,
        expectHealthyPayload: false,
      },
      () => Promise.resolve(new Response("", { status: 200 })),
    );
    expect(outcome.status).toBe("up");
    expect(typeof outcome.latencyMs).toBe("number");
  });
});
