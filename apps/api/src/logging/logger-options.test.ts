import Fastify from "fastify";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildLoggerOptions } from "./logger-options.js";

/**
 * Captures everything the logger writes while one request is served.
 *
 * This asserts against the REAL log stream rather than against the redact
 * config, because a config-level assertion is precisely what would have passed
 * while an authorization code was still being written to disk.
 */
async function captureLogsFor(url: string): Promise<string> {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));

  // The `stream` option is a valid Pino transport target but is not part of
  // Fastify's narrowed FastifyLoggerOptions type, hence the single cast.
  const options = { ...buildLoggerOptions(), level: "info", stream } as Parameters<
    typeof Fastify
  >[0]["logger"];

  const app = Fastify({ logger: options });
  app.get("/*", () => ({ ok: true }));
  await app.ready();
  await app.inject({ method: "GET", url });
  await app.close();
  await new Promise((resolve) => setImmediate(resolve));
  return chunks.join("");
}

describe("request logging suppresses OAuth credentials", () => {
  const CODE = "4/0AbCdEfGhIjKlMnOpQrStUvWxYz";
  const STATE = "Zm9yZ2VkLXN0YXRlLXZhbHVl";

  it("never writes an authorization code, even though Fastify logs before handlers run", async () => {
    const logs = await captureLogsFor(
      `/health-connections/google/callback?code=${CODE}&state=${STATE}`,
    );
    expect(logs).toContain("incoming request");
    expect(logs).not.toContain(CODE);
    expect(logs).not.toContain(STATE);
    expect(logs).toContain("[redacted]");
  });

  it("still records the path, so a callback remains observable", async () => {
    const logs = await captureLogsFor(`/health-connections/google/callback?code=${CODE}`);
    expect(logs).toContain("/health-connections/google/callback");
  });

  it("leaves an ordinary request's query intact", async () => {
    const logs = await captureLogsFor("/today?tz=America/Chicago");
    expect(logs).toContain("tz=America");
  });

  it("emits no query or body field at all in the req object", async () => {
    const logs = await captureLogsFor(`/x?code=${CODE}`);
    const line = logs.split("\n").find((l) => l.includes("incoming request"))!;
    const parsed = JSON.parse(line) as { req: Record<string, unknown> };
    // The point is what is ABSENT: no query object and no body object, so a
    // credential cannot reach a log line even via a future redact-path typo.
    // (remotePort is omitted under .inject(), which has no real socket, so an
    // exact key list would be asserting an artefact of the test harness.)
    for (const forbidden of ["query", "body", "headers", "params"]) {
      expect(parsed.req).not.toHaveProperty(forbidden);
    }
    expect(Object.keys(parsed.req)).toContain("url");
    expect(Object.keys(parsed.req)).toContain("method");
  });
});

describe("the Gmail callback inherits the same suppression", () => {
  // Phase 7 Checkpoint 7.2. The scrubber is registered globally and is
  // path-independent BY DESIGN -- scrub-url.ts says so: "Applied on EVERY
  // route, not just the callback, so a future route that gains a sensitive
  // parameter is covered without anyone having to remember." These cases prove
  // the new route is in fact covered rather than assuming inheritance, and
  // assert against the REAL captured stream, not against the redact config.
  const CODE = "4/0AeaYSHZgmail-authorization-code";
  const STATE = "bWFpbC1zdGF0ZS12YWx1ZQ";
  const ACCESS = "ya29.a0AfB_mail-access-token";

  it("never writes the Gmail authorization code or state", async () => {
    const logs = await captureLogsFor(
      `/mail-connections/gmail/callback?code=${CODE}&state=${STATE}`,
    );
    expect(logs).toContain("incoming request");
    expect(logs).not.toContain(CODE);
    expect(logs).not.toContain(STATE);
    expect(logs).toContain("[redacted]");
  });

  it("still records the callback path, so a connect attempt remains observable", async () => {
    const logs = await captureLogsFor(`/mail-connections/gmail/callback?code=${CODE}`);
    expect(logs).toContain("/mail-connections/gmail/callback");
    expect(logs).toContain("code=[redacted]");
  });

  it("redacts an access_token appearing anywhere in a mail route's query", async () => {
    const logs = await captureLogsFor(`/mail-connections?access_token=${ACCESS}`);
    expect(logs).not.toContain(ACCESS);
  });

  it("leaves a mail route's non-sensitive query intact", async () => {
    // redirect_uri is not a secret and stays readable, which is what makes an
    // allowlist rejection diagnosable from the logs.
    const logs = await captureLogsFor(
      "/mail-connections/gmail/authorize-url?redirect_uri=https%3A%2F%2Fhost.example.ts.net%2Fcb",
    );
    expect(logs).toContain("redirect_uri=");
  });
});
