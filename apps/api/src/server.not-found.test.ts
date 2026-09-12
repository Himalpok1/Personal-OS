import type { FastifyInstance } from "fastify";
import { connect } from "node:net";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./test/build-test-app.js";
import type { ErrorBody } from "./test/types.js";

/**
 * Checkpoint 9.0 Part B -- the not-found path must not leak a query string.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * Fastify's default 404 handler (`basic404` in lib/four-oh-four.js) logged
 * `Route ${method}:${request.raw.url} not found` as a PLAIN MESSAGE STRING,
 * which bypasses the `req` serializer that is the only thing scrubbing
 * `?code=`/`&state=`/`?q=` out of the log, and then echoed that raw URL back
 * to the client in the body. logger-options.test.ts proves the serializer
 * covers the "incoming request" line -- it never exercised the default 404
 * handler, because it registers a `/*` catch-all so nothing is ever 404.
 * That is exactly the gap: a mistyped OAuth callback wrote a live
 * authorization code to disk while every scrub test stayed green.
 *
 * So this suite goes through the REAL `buildServer` instance -- the same
 * not-found handler, the same serializer, the same CORS registration --
 * with the logger pointed at a captured stream, and asserts on the ENTIRE
 * captured output, not on one chosen line. A sentinel that survives on any
 * line, under any field name, fails the test.
 */

const chunks: string[] = [];
const stream = new PassThrough();
stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));

let app: FastifyInstance;

/** Everything the logger wrote since the last `beforeEach`. */
async function capturedLogs(): Promise<string> {
  // Pino writes synchronously to a PassThrough, but a `data` event is
  // delivered on the next tick; yield once so the last line is included.
  await new Promise((resolve) => setImmediate(resolve));
  return chunks.join("");
}

beforeAll(async () => {
  app = await buildTestApp({ logDestination: stream });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  chunks.length = 0;
});

describe("an unknown route", () => {
  const CODE = "SECRET-9-0-SENTINEL";
  const STATE = "STATE-9-0-SENTINEL";
  const Q = "SENSITIVE-SENTINEL";
  const NOVEL = "NOVEL-SENTINEL";

  it("answers 404 with the API's own error vocabulary and echoes nothing", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/does-not-exist?code=${CODE}&state=${STATE}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorBody>()).toEqual({ error: "not_found" });
    // The framework body carried `message: "Route GET:<raw url> not found"`
    // and `error: "Not Found"`. Neither the URL nor the prose may come back.
    expect(res.body).not.toContain(CODE);
    expect(res.body).not.toContain(STATE);
    expect(res.body).not.toContain("does-not-exist");
    expect(res.body).not.toContain("Not Found");
  });

  it("writes neither an OAuth code nor a state anywhere in the log stream", async () => {
    await app.inject({ method: "GET", url: `/does-not-exist?code=${CODE}&state=${STATE}` });
    const logs = await capturedLogs();
    expect(logs).not.toContain(CODE);
    expect(logs).not.toContain(STATE);
    // Observability is kept: method, path, and an explicit not-found
    // classification are all still present.
    expect(logs).toContain("incoming request");
    expect(logs).toContain('"method":"GET"');
    expect(logs).toContain("/does-not-exist");
    expect(logs).toContain("route_not_found");
  });

  it("protects a mistyped OAuth callback -- the case this checkpoint was opened for", async () => {
    // `callbak`, not `callback`: no route matches, so before this checkpoint
    // the DEFAULT handler logged the raw URL as a message string and the
    // live authorization code landed on disk.
    const res = await app.inject({
      method: "GET",
      url: `/health-connections/google/callbak?code=${CODE}&state=${STATE}`,
    });
    const logs = await capturedLogs();
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(CODE);
    expect(logs).not.toContain(CODE);
    expect(logs).not.toContain(STATE);
    expect(logs).toContain("/health-connections/google/callbak");
  });

  it("drops a /search-style q on an unknown path", async () => {
    const res = await app.inject({ method: "GET", url: `/foo?q=${Q}` });
    const logs = await capturedLogs();
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(Q);
    expect(logs).not.toContain(Q);
    expect(logs).toContain("/foo");
  });

  it("drops a parameter whose name no scrub list has ever heard of", async () => {
    // This is the reason the unknown-route policy is "drop the whole query"
    // rather than the known-route name list: a mistyped path can carry any
    // parameter name, so an enumerated list can never be complete for it.
    const res = await app.inject({ method: "GET", url: `/does-not-exist?anything=${NOVEL}` });
    const logs = await capturedLogs();
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(NOVEL);
    expect(logs).not.toContain(NOVEL);
    expect(logs).not.toContain("anything=");
    // The log still says a query WAS present, so a mistyped callback is
    // distinguishable from a bare probe of the path.
    expect(logs).toContain("/does-not-exist?[redacted]");
  });

  it("applies the same policy to the incoming-request line, not only the handler's own line", async () => {
    // Fastify logs "incoming request" through the normal lifecycle for a 404
    // route too, and that line uses the `req` serializer. Before this
    // checkpoint the serializer scrubbed by NAME only, so a novel parameter
    // survived on that line even once the handler was fixed. Every line is
    // checked individually here so a regression in either place is caught.
    await app.inject({ method: "GET", url: `/does-not-exist?anything=${NOVEL}&code=${CODE}` });
    const lines = (await capturedLogs())
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const incoming = lines.find((line) => line["msg"] === "incoming request");
    const notFound = lines.find((line) => line["msg"] === "route not found");
    const completed = lines.find((line) => line["msg"] === "request completed");
    expect(incoming).toBeDefined();
    expect(notFound).toBeDefined();
    expect(completed).toBeDefined();
    const req = incoming!["req"] as { method: string; url: string };
    expect(req.method).toBe("GET");
    expect(req.url).toBe("/does-not-exist?[redacted]");
    expect(notFound!["url"]).toBe("/does-not-exist?[redacted]");
    expect(notFound!["method"]).toBe("GET");
    expect(notFound!["classification"]).toBe("route_not_found");
    expect((completed!["res"] as { statusCode: number }).statusCode).toBe(404);
    // Fastify's own message line must be gone entirely -- it is the one
    // line no serializer can reach.
    expect(lines.some((line) => String(line["msg"]).startsWith("Route "))).toBe(false);
  });

  it("holds for a POST and a HEAD to an unknown path as well", async () => {
    for (const method of ["POST", "HEAD", "PATCH", "DELETE"] as const) {
      chunks.length = 0;
      const res = await app.inject({ method, url: `/nope?code=${CODE}` });
      const logs = await capturedLogs();
      expect(res.statusCode, method).toBe(404);
      expect(res.body, method).not.toContain(CODE);
      expect(logs, method).not.toContain(CODE);
      expect(logs, method).toContain("/nope");
    }
  });

  it("holds for a malformed URL, which never reaches the router at all", async () => {
    // A bad percent-escape in the PATH makes find-my-way hand the request to
    // Fastify's main-router `onBadUrl` (fastify.js), bypassing the not-found
    // handler and setErrorHandler alike. Without `frameworkErrors` that path
    // wrote a raw 400 whose `message` quoted the ENTIRE raw URL -- query
    // included -- back to the client, and logged nothing. With it, Fastify
    // logs "incoming request" through the serializer under a context with no
    // `config.url`, so `request.is404` is true and the query is dropped.
    const res = await app.inject({ method: "GET", url: `/bad%zz?code=${CODE}` });
    const logs = await capturedLogs();
    expect(res.statusCode).toBe(400);
    expect(res.json<ErrorBody>()).toEqual({ error: "FST_ERR_BAD_URL" });
    expect(res.body).not.toContain(CODE);
    expect(res.body).not.toContain("not a valid url component");
    expect(logs).not.toContain(CODE);
    expect(logs).not.toContain("not a valid url component");
    expect(logs).toContain("incoming request");
    expect(logs).toContain("/bad%zz?[redacted]");
    expect(logs).toContain("malformed_request_url");
  });

  it("logs a bare path without inventing a query marker", async () => {
    await app.inject({ method: "GET", url: "/does-not-exist" });
    const logs = await capturedLogs();
    expect(logs).toContain('"url":"/does-not-exist"');
    expect(logs).not.toContain("[redacted]");
  });
});

describe("an OPTIONS request", () => {
  // Checkpoint 9.0 Part B review. `request.is404` is false for EVERY OPTIONS
  // request, because @fastify/cors registers a real `OPTIONS *` catch-all
  // (index.js `fastify.options('*', ...)`) whose context has `config.url`
  // set. So `OPTIONS /nope?anything=x` matched a KNOWN route, took the
  // name-based branch, and logged `anything=x` verbatim on the incoming
  // request line -- and the not-found handler never ran, so that was the
  // only line. All three shapes below reach the serializer before the cors
  // hook decides what to answer, so all three must be covered.
  const NOVEL = "NOVEL-OPTIONS-SENTINEL";

  it("without an Origin is rejected by cors and still logs no query", async () => {
    const res = await app.inject({ method: "OPTIONS", url: `/nope?anything=${NOVEL}` });
    const logs = await capturedLogs();
    // strictPreflight: no Origin / Access-Control-Request-Method -> 400.
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain(NOVEL);
    expect(logs).not.toContain(NOVEL);
    expect(logs).toContain('"url":"/nope?[redacted]"');
  });

  it("as a same-origin preflight to an unknown path answers 204 and logs no query", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: `/nope?anything=${NOVEL}`,
      headers: {
        origin: "http://localhost:8081",
        "access-control-request-method": "GET",
      },
    });
    const logs = await capturedLogs();
    expect(res.statusCode).toBe(204);
    expect(logs).not.toContain(NOVEL);
    expect(logs).toContain('"url":"/nope?[redacted]"');
  });

  it("as a foreign-origin preflight is still logged without its query", async () => {
    // cors answers 204 without the allow-origin header for an origin it does
    // not know; the browser then blocks the real request. The log line is
    // written before any of that, so the policy must not depend on it.
    const res = await app.inject({
      method: "OPTIONS",
      url: `/nope?anything=${NOVEL}`,
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "GET",
      },
    });
    const logs = await capturedLogs();
    expect(res.statusCode).toBe(204);
    expect(logs).not.toContain(NOVEL);
    expect(logs).toContain('"url":"/nope?[redacted]"');
  });

  it("to a KNOWN path also loses its query, because nothing reads it", async () => {
    // The serializer keys on the METHOD, not on the path, so this is the
    // case that would regress if someone narrowed it to "OPTIONS on an
    // unknown path" -- there is no such thing; the wildcard matches all.
    const res = await app.inject({
      method: "OPTIONS",
      url: `/tasks?anything=${NOVEL}`,
      headers: {
        origin: "http://localhost:8081",
        "access-control-request-method": "PATCH",
      },
    });
    const logs = await capturedLogs();
    expect(res.statusCode).toBe(204);
    expect(logs).not.toContain(NOVEL);
    expect(logs).toContain('"url":"/tasks?[redacted]"');
  });

  it("is the only method with no route of this API's own, so no diagnostic value is lost", () => {
    // The serializer's OPTIONS rule is justified by "no OPTIONS handler in
    // this API reads a query". That is true today because the cors wildcard
    // is the ONLY OPTIONS route registered. If a real `app.options(...)`
    // route ever appears, this fails and the rule has to be re-argued rather
    // than silently hiding that route's parameters.
    const optionsLines = app
      .printRoutes({ commonPrefix: false })
      .split("\n")
      .filter((line) => line.includes("OPTIONS"));
    expect(optionsLines).toHaveLength(1);
    expect(optionsLines[0]).toContain("* (OPTIONS)");
  });
});

describe("a query introduced by # instead of ?", () => {
  // Checkpoint 9.0 Part B review. find-my-way's url-sanitizer splits the
  // query on `#` as well as `?`, so `/nope#code=x` is a 404 on `/nope`
  // carrying `code=x`, and `/search#q=x` is a REAL search on `x`. Neither
  // scrubber knew `#`, so both logged the whole string as if it were the
  // path -- including, for /search, the text the 8.6A scrub exists to hide.
  //
  // `app.inject` (and every browser, curl, fetch and the api-client) strips
  // a fragment before it reaches the server, so the only way to exercise
  // this is a raw socket writing the request line ourselves. The listen is
  // on an ephemeral loopback port and closes with the app.
  const CODE = "SECRET-HASH-SENTINEL";
  const Q = "SEARCH-HASH-SENTINEL";
  let port: number;

  beforeAll(async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    port = address.port;
  });

  function rawRequest(target: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let raw = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        raw += chunk;
      });
      socket.on("error", reject);
      socket.on("close", () => {
        const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1]);
        const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
        resolve({ status, body });
      });
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
  }

  it("on an unknown path is a 404 whose query is dropped on every line", async () => {
    const res = await rawRequest(`/nope#code=${CODE}`);
    const logs = await capturedLogs();
    expect(res.status).toBe(404);
    expect(res.body).not.toContain(CODE);
    expect(logs).not.toContain(CODE);
    expect(logs).toContain('"url":"/nope#[redacted]"');
    expect(logs).toContain("route_not_found");
  });

  it("on /search runs the search and still scrubs q by name", async () => {
    const res = await rawRequest(`/search#q=${Q}`);
    const logs = await capturedLogs();
    // The router really does treat `#` as the query: this is a 200 search.
    expect(res.status).toBe(200);
    expect(logs).not.toContain(Q);
    expect(logs).toContain('"url":"/search#q=[redacted]"');
  });
});

describe("a known route's logging is unchanged", () => {
  // The unknown-route policy is branched on `request.is404` INSIDE the
  // serializer, so the cases below prove the branch is taken only for the
  // not-found context: known routes keep name-based scrubbing and their
  // non-sensitive parameters stay readable, exactly as before.
  const Q = "SENSITIVE-SENTINEL";

  it("still scrubs /search?q= by name to [redacted]", async () => {
    const res = await app.inject({ method: "GET", url: `/search?q=${Q}&limit=5` });
    const logs = await capturedLogs();
    expect(res.statusCode).toBe(200);
    expect(logs).not.toContain(Q);
    expect(logs).toContain("/search?q=[redacted]&limit=5");
  });

  it("still shows /tasks?limit=5 verbatim", async () => {
    const res = await app.inject({ method: "GET", url: "/tasks?limit=5" });
    const logs = await capturedLogs();
    expect(res.statusCode).toBe(200);
    expect(logs).toContain('"url":"/tasks?limit=5"');
    // No not-found classification on a route that exists.
    expect(logs).not.toContain("route_not_found");
  });

  it("answers a missing entity with the same body a missing route now uses", async () => {
    // One vocabulary: `ApiClientError.code` is `not_found` whether the row or
    // the route is missing, so no client has to special-case framework prose.
    const res = await app.inject({
      method: "GET",
      url: "/tasks/00000000-0000-4000-8000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorBody>()).toEqual({ error: "not_found" });
  });
});
