import { APICallError, TypeValidationError } from "ai";
import { describe, expect, it } from "vitest";
import { serializeErrorForLog } from "./serialize-error.js";

// Sentinels chosen to look like the real things that were reachable here: a
// Google access token, a Google error_description, and a Postgres `detail`
// carrying a user's own capture text.
const TOKEN = "ya29.SENTINEL-not-a-real-token";
const GOOGLE_PROSE = "Token has been expired or revoked.";
const PG_DETAIL = "Failing row contains (7, call the insurance guy at 3pm, ...).";

function flatten(value: unknown): string {
  return JSON.stringify(value);
}

class GoogleOAuthError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly googleErrorCode: string | undefined,
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

class CalDavError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly responseBody?: string,
  ) {
    super(message);
    this.name = "CalDavError";
  }
}

describe("serializeErrorForLog", () => {
  it("withholds a provider-authored message", () => {
    const out = serializeErrorForLog(new GoogleOAuthError(GOOGLE_PROSE, 400, "invalid_grant"));
    expect(out.message).toBe("[GoogleOAuthError message withheld]");
    expect(flatten(out)).not.toContain(GOOGLE_PROSE);
  });

  it("drops a CalDAV response body, which pino's default serializer copied verbatim", () => {
    // pino.stdSerializers.err does `for (const key in err)` and also attaches
    // `.raw = err`, so responseBody reached the log line whole.
    const out = serializeErrorForLog(new CalDavError("PUT failed", 500, TOKEN));
    const flat = flatten(out);
    expect(flat).not.toContain(TOKEN);
    expect(flat).not.toContain("responseBody");
    expect(flat).not.toContain("raw");
  });

  it("drops a Postgres `detail`, which embeds the user's own row data", () => {
    const err = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      detail: PG_DETAIL,
      table: "tasks",
      where: "PL/pgSQL function",
    });
    const out = serializeErrorForLog(err);
    const flat = flatten(out);
    expect(flat).not.toContain(PG_DETAIL);
    expect(flat).not.toContain("insurance");
    expect(flat).not.toContain("table");
    // The SQLSTATE survives, because it is the whole diagnostic value and
    // carries no user content.
    expect(out.code).toBe("23505");
  });

  it("keeps our OWN message — that is the point of a log line", () => {
    const out = serializeErrorForLog(new Error("upsert into calendar_connections returned no row"));
    expect(out.message).toBe("upsert into calendar_connections returned no row");
  });

  it("withholds a provider-authored error's stack entirely", () => {
    // This previously asserted the stack kept its frames with the header
    // stripped. Adversarial review showed header-stripping by SHAPE is
    // defeatable, so for the five provider classes the stack is now withheld
    // outright -- their frames land inside undici and are worth little, while
    // `type` and the request log line already say which route threw.
    const out = serializeErrorForLog(new GoogleOAuthError(GOOGLE_PROSE, 400, "invalid_grant"));
    expect(out.stack).toBe("");
  });

  it("keeps frames for OUR OWN errors, so a log line stays navigable", () => {
    const out = serializeErrorForLog(new Error("upsert returned no row"));
    expect(out.stack).not.toBe("");
    expect(out.stack.split("\n").every((line) => line.trimStart().startsWith("at "))).toBe(true);
  });

  it("survives a multi-line provider message without leaking its tail", () => {
    const multi = `${GOOGLE_PROSE}\n  contained token: ${TOKEN}`;
    const out = serializeErrorForLog(new GoogleOAuthError(multi, 400, undefined));
    expect(flatten(out)).not.toContain(TOKEN);
  });

  it("resists a provider message disguised as a stack frame", () => {
    // Found by adversarial review of the first version of this file: keeping
    // only lines that start with "at " does NOT remove the header, because a
    // message can contain a line shaped exactly like a frame. Google's
    // error_description is provider-controlled text, so this is reachable.
    const disguised = `boom\n    at attacker (leak-${TOKEN}.js:1:1)`;
    const out = serializeErrorForLog(new GoogleOAuthError(disguised, 400, undefined));
    expect(out.stack).not.toContain(TOKEN);
    expect(flatten(out)).not.toContain(TOKEN);
  });

  it("removes the header from OUR OWN error's stack by length, not by shape", () => {
    // The same disguise on an error we authored: the header must still go, so
    // the defence does not depend on which class threw.
    const err = new Error(`our own failure\n    at notreallyaframe (marker-${TOKEN}.js:1:1)`);
    const out = serializeErrorForLog(err);
    expect(out.stack).not.toContain(TOKEN);
    // Our message is still reported -- that is the point of keeping it.
    expect(out.message).toContain("our own failure");
    expect(out.stack).toContain("at ");
  });

  it("emits exactly the allowlisted keys and nothing else", () => {
    const err = Object.assign(new Error("boom"), {
      code: "23505",
      secretHeaders: { authorization: `Bearer ${TOKEN}` },
    });
    expect(Object.keys(serializeErrorForLog(err)).sort()).toEqual([
      "code",
      "message",
      "stack",
      "type",
    ]);
  });

  it("handles a thrown non-Error without crashing the logger", () => {
    const out = serializeErrorForLog("just a string");
    expect(out.type).toBe("string");
    expect(out.stack).toBe("");
  });

  it("rejects a code that is not a short machine token", () => {
    const err = Object.assign(new Error("boom"), { code: GOOGLE_PROSE });
    expect(serializeErrorForLog(err).code).toBeUndefined();
  });

  // Checkpoint 8.6B (finding #23): AI_APICallError was previously reachable to
  // the generic handler's request.log.error({ err }) with no allowlist
  // protection at all, because it was absent from the name-only list. These
  // pin the STRUCTURAL fix -- `instanceof AISDKError` -- against real SDK
  // classes rather than a hand-rolled stand-in, so a future SDK error class
  // this file has never heard of is covered by construction.
  describe("AI SDK errors (Checkpoint 8.6B)", () => {
    const PROMPT_SECRET = "the user's raw capture text, never to be logged";

    it("withholds an APICallError's message, which can echo the request body", () => {
      const err = new APICallError({
        message: `upstream rejected: ${PROMPT_SECRET}`,
        url: "https://api.openai.example/v1/chat/completions",
        requestBodyValues: { prompt: PROMPT_SECRET },
        responseBody: `{"error":"contains ${PROMPT_SECRET}"}`,
      });
      const out = serializeErrorForLog(err);
      expect(out.type).toBe("AI_APICallError");
      expect(out.message).toBe("[AI_APICallError message withheld]");
      const flat = flatten(out);
      expect(flat).not.toContain(PROMPT_SECRET);
      expect(flat).not.toContain("requestBodyValues");
      expect(flat).not.toContain("responseBody");
    });

    it("withholds an APICallError's stack entirely, like the five hand-named classes", () => {
      const err = new APICallError({
        message: "boom",
        url: "https://api.openai.example",
        requestBodyValues: {},
      });
      expect(serializeErrorForLog(err).stack).toBe("");
    });

    it("withholds a TypeValidationError's message, which embeds the validated VALUE verbatim", () => {
      // Not a hypothetical: this SDK class's own message literally contains
      // `Value: ${JSON.stringify(value)}` -- verified against the installed
      // ai@7.0.66 -- so a tool-call validation failure on a capture would
      // otherwise put the capture's own text straight into a log line.
      const err = new TypeValidationError({
        value: { prompt: PROMPT_SECRET },
        cause: new Error("bad shape"),
      });
      expect(err.message).toContain(PROMPT_SECRET); // sanity: the SDK really does this
      const out = serializeErrorForLog(err);
      expect(out.type).toBe("AI_TypeValidationError");
      expect(out.message).toBe("[AI_TypeValidationError message withheld]");
      expect(flatten(out)).not.toContain(PROMPT_SECRET);
    });

    it("emits only the allowlisted keys for an AI SDK error, same as every other class", () => {
      const err = new APICallError({
        message: "boom",
        url: "https://api.openai.example",
        requestBodyValues: { prompt: PROMPT_SECRET },
        statusCode: 400,
      });
      expect(Object.keys(serializeErrorForLog(err)).sort()).toEqual(["message", "stack", "type"]);
    });
  });
});
