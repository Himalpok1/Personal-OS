import type { MailDigestCurrentResponse } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  canGenerateDigest,
  digestFailureText,
  resolveDigestCardState,
  type DigestFailureReason,
} from "./digest-card-state";

function response(overrides: Partial<MailDigestCurrentResponse> = {}): MailDigestCurrentResponse {
  return {
    configured: true,
    has_active_mailbox: true,
    digest: null,
    ...overrides,
  };
}

const DIGEST = {
  id: "33333333-3333-4333-8333-333333333333",
  digest_date: "2026-09-01",
  timezone: "UTC",
  content: { text: "Two messages need attention." },
  model_id: null,
  generated_at: "2026-09-01T13:00:00Z",
};

function base(overrides: Record<string, unknown> = {}) {
  return {
    isLoading: false,
    data: response(),
    isLoadError: false,
    isGenerating: false,
    generateError: null,
    ...overrides,
  } as Parameters<typeof resolveDigestCardState>[0];
}

/** Shaped like the real ApiClientError: plain public fields, no class needed. */
function apiError(status: number, code: string) {
  return { status, code, body: { error: code } };
}

describe("the three empty states stay distinct", () => {
  // Collapsing them would tell a user to go set up something already set up --
  // the specific failure the API's three-field response was shaped to prevent.

  it("reports not_configured when the server has no Gmail credentials", () => {
    expect(
      resolveDigestCardState(base({ data: response({ configured: false, has_active_mailbox: false }) })),
    ).toEqual({ kind: "not_configured" });
  });

  it("reports no_mailbox when configured but nothing is connected", () => {
    expect(
      resolveDigestCardState(base({ data: response({ has_active_mailbox: false }) })),
    ).toEqual({ kind: "no_mailbox" });
  });

  it("reports empty when a mailbox is connected and the run just hasn't happened", () => {
    expect(resolveDigestCardState(base())).toEqual({ kind: "empty" });
  });
});

describe("precedence", () => {
  it("loading wins over everything", () => {
    expect(
      resolveDigestCardState(base({ isLoading: true, isGenerating: true, isLoadError: true })),
    ).toEqual({ kind: "loading" });
  });

  it("a generation in flight carries the previous text forward", () => {
    // So the card does not blank out while waiting.
    expect(
      resolveDigestCardState(
        base({ isGenerating: true, data: response({ digest: DIGEST }) }),
      ),
    ).toEqual({ kind: "generating", previousText: "Two messages need attention." });
  });

  it("a FAILED generation never destroys the cached digest", () => {
    // The invariant the brief card established: a failed regeneration must not
    // take the still-valid content the card was already showing.
    const state = resolveDigestCardState(
      base({
        data: response({ digest: DIGEST }),
        generateError: apiError(409, "no_provider_configured"),
      }),
    );
    expect(state).toEqual({
      kind: "failed",
      reason: "no_provider",
      previousText: "Two messages need attention.",
    });
  });

  it("reports unavailable on a load error rather than claiming emptiness", () => {
    expect(resolveDigestCardState(base({ data: undefined, isLoadError: true }))).toEqual({
      kind: "unavailable",
    });
  });

  it("reports present when a digest exists and nothing is in flight", () => {
    expect(resolveDigestCardState(base({ data: response({ digest: DIGEST }) }))).toEqual({
      kind: "present",
      text: "Two messages need attention.",
      digestDate: "2026-09-01",
      timezone: "UTC",
      generatedAt: "2026-09-01T13:00:00Z",
    });
  });
});

describe("error classification", () => {
  it("maps each 409 to its own reason", () => {
    const cases: [string, DigestFailureReason][] = [
      ["mail_not_configured", "not_configured"],
      ["no_active_mailboxes", "no_mailbox"],
      ["no_provider_configured", "no_provider"],
    ];
    for (const [code, reason] of cases) {
      const state = resolveDigestCardState(base({ generateError: apiError(409, code) }));
      expect(state).toMatchObject({ kind: "failed", reason });
    }
  });

  it("maps a 503 to queue_unavailable", () => {
    expect(
      resolveDigestCardState(base({ generateError: apiError(503, "queue_unavailable") })),
    ).toMatchObject({ reason: "queue_unavailable" });
  });

  it("does NOT guess at an unclassified 409", () => {
    // Deliberately unlike brief-card-state, which treats a bare 409 as
    // "no provider" -- correct there, because that endpoint has one 409. This
    // one has three, so guessing would name the wrong cause.
    expect(
      resolveDigestCardState(base({ generateError: { status: 409, body: {} } })),
    ).toMatchObject({ reason: "unknown" });
  });

  it("survives a non-object throw", () => {
    expect(resolveDigestCardState(base({ generateError: "boom" }))).toMatchObject({
      reason: "unknown",
    });
  });
});

describe("canGenerateDigest", () => {
  it("withholds the action where the button provably cannot help", () => {
    // No credentials and no mailbox are setup steps: the button could only ever
    // return the same 409 again.
    expect(canGenerateDigest({ kind: "not_configured" })).toBe(false);
    expect(canGenerateDigest({ kind: "no_mailbox" })).toBe(false);
    expect(canGenerateDigest({ kind: "unavailable" })).toBe(false);
    expect(canGenerateDigest({ kind: "loading" })).toBe(false);
    expect(canGenerateDigest({ kind: "generating", previousText: null })).toBe(false);
  });

  it("offers the action in empty and present", () => {
    expect(canGenerateDigest({ kind: "empty" })).toBe(true);
    expect(
      canGenerateDigest({
        kind: "present",
        text: "x",
        digestDate: "2026-09-01",
        timezone: "UTC",
        generatedAt: "2026-09-01T13:00:00Z",
      }),
    ).toBe(true);
  });

  it("is NOT a dead end after a failure the user may have just fixed", () => {
    // Same reasoning that gave the brief card its "Try again": without it the
    // card is stuck until the whole app reloads.
    for (const reason of ["no_provider", "queue_unavailable", "unknown"] as const) {
      expect(canGenerateDigest({ kind: "failed", reason, previousText: null }), reason).toBe(true);
    }
    // ...but still withheld for the two the button cannot change.
    for (const reason of ["not_configured", "no_mailbox"] as const) {
      expect(canGenerateDigest({ kind: "failed", reason, previousText: null }), reason).toBe(false);
    }
  });
});

describe("digestFailureText", () => {
  it("has fixed words for every reason and leaks nothing", () => {
    const reasons: DigestFailureReason[] = [
      "not_configured",
      "no_mailbox",
      "no_provider",
      "queue_unavailable",
      "unknown",
    ];
    for (const reason of reasons) {
      const text = digestFailureText(reason);
      expect(text.length).toBeGreaterThan(10);
      // No provider text, no address, no URL, and never the raw code.
      expect(text).not.toContain("@");
      expect(text).not.toContain("http");
      expect(text).not.toContain(reason);
    }
  });
});

describe("the requested state — a 202 is not a digest", () => {
  // `isGenerating` is the mutation's isPending, which ends at the route's 202
  // -- an HTTP round trip. Without a separate state the "preparing" message
  // would flash for a few hundred milliseconds while the worker had not started.

  it("reports requested after a 202 with no newer digest", () => {
    expect(resolveDigestCardState(base({ hasPendingRequest: true }))).toEqual({
      kind: "requested",
      previousText: null,
    });
  });

  it("keeps the cached prose visible while requested", () => {
    expect(
      resolveDigestCardState(
        base({ hasPendingRequest: true, data: response({ digest: DIGEST }) }),
      ),
    ).toEqual({ kind: "requested", previousText: "Two messages need attention." });
  });

  it("is outranked by an in-flight request and by a failure", () => {
    expect(
      resolveDigestCardState(base({ hasPendingRequest: true, isGenerating: true })).kind,
    ).toBe("generating");
    expect(
      resolveDigestCardState(
        base({ hasPendingRequest: true, generateError: apiError(409, "no_provider_configured") }),
      ).kind,
    ).toBe("failed");
  });

  it("offers no button while requested -- the work is already queued", () => {
    expect(canGenerateDigest({ kind: "requested", previousText: null })).toBe(false);
  });

  it("falls through to present once the request is no longer pending", () => {
    expect(
      resolveDigestCardState(
        base({ hasPendingRequest: false, data: response({ digest: DIGEST }) }),
      ).kind,
    ).toBe("present");
  });
});
