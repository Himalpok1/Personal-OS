import { MailSyncErrorCodeSchema, MailSyncFailureClassSchema } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { classifyMailFault, type MailOperation } from "./classify.js";
import { GmailApiError } from "./gmail-client.js";
import { GmailOAuthError } from "./gmail-oauth.js";

function apiError(
  status: number,
  opts: { gmailStatus?: string; retryAfterSeconds?: number | null; reason?: string } = {},
): GmailApiError {
  return new GmailApiError(
    status,
    opts.gmailStatus,
    opts.reason !== undefined ? [{ reason: opts.reason }] : [],
    opts.retryAfterSeconds ?? null,
  );
}

const OPERATIONS: MailOperation[] = [
  "get_profile",
  "list_messages",
  "get_message",
  "list_history",
  "refresh_token",
];

describe("classifyMailFault: the cursor-expiry transition", () => {
  it("classifies a 404 on list_history as cursor expiry, not a missing resource", () => {
    // Confirmed live in Checkpoint 7.2P: startHistoryId=1 returns
    // 404 NOT_FOUND with details: []. This is ADR-053's first-class transition.
    const fault = classifyMailFault(apiError(404, { gmailStatus: "NOT_FOUND" }), "list_history");
    expect(fault.code).toBe("cursor_expired");
    expect(fault.cursorExpired).toBe(true);
    expect(fault.failureClass).toBe("cursor_expired:list_history");
    // NOT retryable: retrying an expired cursor can never succeed, and would
    // delay the resync that fixes it.
    expect(fault.retryable).toBe(false);
  });

  it("classifies the SAME 404 on any other operation as a missing resource", () => {
    // The operation is the only thing that separates these. A message that was
    // deleted between listing and fetching is routine; treating it as cursor
    // expiry would trigger a needless full resync on every deleted message.
    for (const operation of OPERATIONS.filter((o) => o !== "list_history")) {
      const fault = classifyMailFault(apiError(404), operation);
      expect(fault.code).toBe("not_found");
      expect(fault.cursorExpired).toBe(false);
    }
  });
});

describe("classifyMailFault: HTTP status plus operation, never details[].reason", () => {
  it("does not depend on a reason token, because Gmail sends none", () => {
    // 7.2P: every observed failure returned `details: []`. A classifier ported
    // from Health -- which reads error.details[].reason, and was CORRECT to for
    // that API -- would read an always-empty field and always fall through.
    const withReason = classifyMailFault(
      apiError(403, { gmailStatus: "PERMISSION_DENIED", reason: "insufficientPermissions" }),
      "list_messages",
    );
    const withoutReason = classifyMailFault(
      apiError(403, { gmailStatus: "PERMISSION_DENIED" }),
      "list_messages",
    );
    expect(withReason).toEqual(withoutReason);
  });

  it("separates a throttling 403 from a permission 403 using error.status", () => {
    // Gmail overloads 403. `error.status` IS present even though `details` is
    // empty, and it is the only signal that tells these apart.
    const throttled = classifyMailFault(
      apiError(403, { gmailStatus: "RESOURCE_EXHAUSTED", retryAfterSeconds: 12 }),
      "get_message",
    );
    expect(throttled.code).toBe("rate_limited");
    expect(throttled.retryable).toBe(true);
    expect(throttled.retryAfterSeconds).toBe(12);

    const denied = classifyMailFault(
      apiError(403, { gmailStatus: "PERMISSION_DENIED" }),
      "get_message",
    );
    expect(denied.code).toBe("missing_scope");
    expect(denied.retryable).toBe(false);
  });

  it("classifies 401 as a rejected grant that must not be retried at this layer", () => {
    const fault = classifyMailFault(apiError(401), "get_message");
    expect(fault.code).toBe("auth_failed");
    expect(fault.retryable).toBe(false);
  });

  it("classifies 400 as our own request defect rather than a provider fault", () => {
    const fault = classifyMailFault(apiError(400), "list_messages");
    expect(fault.code).toBe("invalid_request");
    expect(fault.failureClass).toBe("invalid_request");
  });

  it("classifies 429 as retryable and carries the hint through", () => {
    const fault = classifyMailFault(apiError(429, { retryAfterSeconds: 30 }), "get_message");
    expect(fault.code).toBe("rate_limited");
    expect(fault.retryable).toBe(true);
    expect(fault.retryAfterSeconds).toBe(30);
  });

  it("classifies 5xx as a transient provider outage", () => {
    for (const status of [500, 502, 503]) {
      const fault = classifyMailFault(apiError(status), "list_history");
      expect(fault.code).toBe("provider_unavailable");
      expect(fault.retryable).toBe(true);
      expect(fault.failureClass).toBe(`provider_unavailable:${status}`);
    }
  });

  it("falls back to provider_error for an unrecognised status", () => {
    const fault = classifyMailFault(apiError(418), "get_profile");
    expect(fault.code).toBe("provider_error");
    expect(fault.failureClass).toBe("provider_error:418");
  });
});

describe("classifyMailFault: OAuth and transport", () => {
  it("distinguishes a permanently dead grant from a transient token-endpoint fault", () => {
    const dead = classifyMailFault(new GmailOAuthError("invalid_grant", 400), "refresh_token");
    expect(dead.code).toBe("auth_expired");
    expect(dead.retryable).toBe(false);

    // A 500 from the token endpoint is far likelier to be a Google-side blip
    // than proof the user revoked consent, and marking needs_reauth on it would
    // log them out of mail for a transient fault.
    const transient = classifyMailFault(new GmailOAuthError(undefined, 503), "refresh_token");
    expect(transient.code).toBe("provider_unavailable");
    expect(transient.retryable).toBe(true);
  });

  it("classifies an abort as a retryable timeout", () => {
    const err = new Error("aborted");
    err.name = "TimeoutError";
    const fault = classifyMailFault(err, "get_message");
    expect(fault.code).toBe("network_error");
    expect(fault.failureClass).toBe("transport:timeout");
    expect(fault.retryable).toBe(true);
  });

  it("classifies anything that never reached a response as a retryable transport fault", () => {
    const fault = classifyMailFault(new Error("ECONNRESET"), "list_history");
    expect(fault.code).toBe("network_error");
    expect(fault.failureClass).toBe("transport");
    expect(fault.retryable).toBe(true);
    expect(fault.httpStatus).toBeNull();
  });

  it("classifies a non-Error throw without crashing", () => {
    const fault = classifyMailFault("something odd", "get_profile");
    expect(fault.code).toBe("network_error");
  });
});

describe("classifyMailFault output contracts", () => {
  it("only ever emits codes from the closed MailSyncErrorCode enum", () => {
    const errors: unknown[] = [
      apiError(400),
      apiError(401),
      apiError(403),
      apiError(403, { gmailStatus: "RESOURCE_EXHAUSTED" }),
      apiError(404),
      apiError(429),
      apiError(500),
      apiError(418),
      new GmailOAuthError("invalid_grant", 400),
      new GmailOAuthError("temporarily_unavailable", 503),
      new Error("boom"),
      null,
    ];
    for (const err of errors) {
      for (const operation of OPERATIONS) {
        const fault = classifyMailFault(err, operation);
        // Typed onto the wire, so a prose leak is a parse failure (ADR-053).
        expect(() => MailSyncErrorCodeSchema.parse(fault.code)).not.toThrow();
        expect(() => MailSyncFailureClassSchema.parse(fault.failureClass)).not.toThrow();
      }
    }
  });

  it("never carries provider prose into either output", () => {
    // GmailApiError destroys the provider's message at construction; this
    // asserts nothing here can reintroduce it. The message below is what a real
    // Gmail INVALID_ARGUMENT looks like: it echoes the request back.
    const err = apiError(400);
    Object.defineProperty(err, "message", {
      value: 'Unknown name "startHistoryId": Cannot find field.',
    });
    const fault = classifyMailFault(err, "list_history");
    expect(fault.failureClass).not.toContain("startHistoryId");
    expect(fault.code).not.toContain(" ");
  });
});
