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

  it("strips the stack's header line, which is a verbatim copy of the message", () => {
    const err = new GoogleOAuthError(GOOGLE_PROSE, 400, "invalid_grant");
    const out = serializeErrorForLog(err);
    expect(out.stack).not.toContain(GOOGLE_PROSE);
    // Frames survive, so the log is still navigable.
    expect(out.stack.split("\n").every((line) => line.trimStart().startsWith("at "))).toBe(true);
  });

  it("survives a multi-line provider message without leaking its tail", () => {
    const multi = `${GOOGLE_PROSE}\n  contained token: ${TOKEN}`;
    const out = serializeErrorForLog(new GoogleOAuthError(multi, 400, undefined));
    expect(flatten(out)).not.toContain(TOKEN);
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
});
