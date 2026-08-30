import { describe, expect, it } from "vitest";
import { z } from "zod";

// Phase 7 Checkpoint 7.2 — the Gmail configuration shape.
//
// Deliberately restates the shape rather than importing `env`, exactly as
// apps/worker/src/env.test.ts does and for the same reason: importing `env`
// parses the real process environment, which in this workspace HAS the
// variables set, so the unconfigured cases would be unreachable.
//
// What is being guarded is the Checkpoint 6.3 audit finding, one integration
// over. docker-compose passes these as `${GMAIL_OAUTH_CLIENT_ID:-}`, which
// renders an EMPTY STRING rather than omitting the key. `z.string().min(1)
// .optional()` tolerates `undefined` but THROWS on "" — and because env.ts is
// parsed at module load, that combination killed BOTH api and worker at import
// on a host without Health credentials, taking capture, calendar, notifications
// and reminders down with them.
//
// An unconfigured Gmail integration must degrade to a structured 409, never to
// a process that will not start.

function optionalNonEmpty() {
  return z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());
}

/** The exact shape env.ts declares for the Gmail trio. */
const GmailEnvShape = z.object({
  GMAIL_OAUTH_CLIENT_ID: optionalNonEmpty(),
  GMAIL_OAUTH_CLIENT_SECRET: optionalNonEmpty(),
  GMAIL_OAUTH_REDIRECT_URI: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined
        ? []
        : value
            .split(",")
            .map((uri) => uri.trim())
            .filter((uri) => uri.length > 0),
    ),
});

/** Mirrors getMailOAuthConfig's all-or-nothing rule. */
function isConfigured(parsed: z.infer<typeof GmailEnvShape>): boolean {
  return (
    Boolean(parsed.GMAIL_OAUTH_CLIENT_ID) &&
    Boolean(parsed.GMAIL_OAUTH_CLIENT_SECRET) &&
    parsed.GMAIL_OAUTH_REDIRECT_URI.length > 0
  );
}

describe("Gmail env config shape", () => {
  it("the naive shape rejects an empty string — the bug this guards", () => {
    expect(() => z.string().min(1).optional().parse("")).toThrow();
  });

  it("PARSES when Gmail is omitted entirely, so the API can start", () => {
    const parsed = GmailEnvShape.parse({});
    expect(parsed.GMAIL_OAUTH_CLIENT_ID).toBeUndefined();
    expect(parsed.GMAIL_OAUTH_CLIENT_SECRET).toBeUndefined();
    expect(parsed.GMAIL_OAUTH_REDIRECT_URI).toEqual([]);
    expect(isConfigured(parsed)).toBe(false);
  });

  it("PARSES when docker-compose interpolates empty strings, so the API can start", () => {
    // This is the literal shape `${VAR:-}` produces for all three.
    const parsed = GmailEnvShape.parse({
      GMAIL_OAUTH_CLIENT_ID: "",
      GMAIL_OAUTH_CLIENT_SECRET: "",
      GMAIL_OAUTH_REDIRECT_URI: "",
    });
    expect(parsed.GMAIL_OAUTH_CLIENT_ID).toBeUndefined();
    expect(parsed.GMAIL_OAUTH_CLIENT_SECRET).toBeUndefined();
    expect(parsed.GMAIL_OAUTH_REDIRECT_URI).toEqual([]);
    expect(isConfigured(parsed)).toBe(false);
  });

  it("accepts a complete configuration", () => {
    const parsed = GmailEnvShape.parse({
      GMAIL_OAUTH_CLIENT_ID: "client-id",
      GMAIL_OAUTH_CLIENT_SECRET: "client-secret",
      GMAIL_OAUTH_REDIRECT_URI: "https://host.example.ts.net/mail-connections/gmail/callback",
    });
    expect(isConfigured(parsed)).toBe(true);
    expect(parsed.GMAIL_OAUTH_REDIRECT_URI).toEqual([
      "https://host.example.ts.net/mail-connections/gmail/callback",
    ]);
  });

  it("treats every PARTIAL configuration as unconfigured rather than half-usable", () => {
    // A half-configured client cannot complete a flow. Failing at the route
    // with one clear 409 beats failing at Google with three different errors.
    const complete = {
      GMAIL_OAUTH_CLIENT_ID: "id",
      GMAIL_OAUTH_CLIENT_SECRET: "secret",
      GMAIL_OAUTH_REDIRECT_URI: "https://h.example.ts.net/mail-connections/gmail/callback",
    };
    for (const missing of [
      "GMAIL_OAUTH_CLIENT_ID",
      "GMAIL_OAUTH_CLIENT_SECRET",
      "GMAIL_OAUTH_REDIRECT_URI",
    ] as const) {
      const partial = { ...complete, [missing]: "" };
      // It still PARSES -- the process must boot either way...
      const parsed = GmailEnvShape.parse(partial);
      // ...but it is not configured, so routes 409 instead of half-working.
      expect(isConfigured(parsed), `${missing} blank should be unconfigured`).toBe(false);
    }
  });

  it("splits a comma-separated redirect allowlist and trims each entry", () => {
    const parsed = GmailEnvShape.parse({
      GMAIL_OAUTH_REDIRECT_URI:
        " http://127.0.0.1:3000/mail-connections/gmail/callback , https://host.example.ts.net/mail-connections/gmail/callback ",
    });
    expect(parsed.GMAIL_OAUTH_REDIRECT_URI).toEqual([
      "http://127.0.0.1:3000/mail-connections/gmail/callback",
      "https://host.example.ts.net/mail-connections/gmail/callback",
    ]);
  });

  it("drops empty entries rather than admitting an empty-string redirect", () => {
    // An empty allowlist entry would match an empty redirect_uri under an
    // exact-match check, which is exactly the hole the allowlist exists to
    // close.
    const parsed = GmailEnvShape.parse({ GMAIL_OAUTH_REDIRECT_URI: "a,,b, ," });
    expect(parsed.GMAIL_OAUTH_REDIRECT_URI).toEqual(["a", "b"]);
  });

  it("still rejects a non-string", () => {
    expect(() => GmailEnvShape.parse({ GMAIL_OAUTH_CLIENT_ID: 42 })).toThrow();
  });
});
