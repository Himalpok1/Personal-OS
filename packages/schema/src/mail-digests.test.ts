import { describe, expect, it } from "vitest";
import {
  MailDigestCurrentResponseSchema,
  MailDigestGenerateAcceptedSchema,
} from "./mail-digests.js";

// ---------------------------------------------------------------------------
// READ / GENERATE CONTRACTS (Checkpoint 7.6)
// ---------------------------------------------------------------------------

describe("MailDigestCurrentResponseSchema", () => {
  const DIGEST = {
    id: "33333333-3333-4333-8333-333333333333",
    digest_date: "2026-09-01",
    timezone: "UTC",
    content: { text: "Two messages need attention." },
    model_id: null,
    generated_at: "2026-09-01T13:00:00Z",
  };

  it("carries all three facts an honest empty state needs", () => {
    // "No digest yet" means something different depending on the first two, and
    // a screen that had to guess between them would guess wrong.
    const parsed = MailDigestCurrentResponseSchema.parse({
      configured: true,
      has_active_mailbox: false,
      digest: null,
    });
    expect(parsed).toEqual({ configured: true, has_active_mailbox: false, digest: null });
  });

  it("requires every field, so a consumer cannot read undefined as false", () => {
    expect(MailDigestCurrentResponseSchema.safeParse({ digest: null }).success).toBe(false);
  });

  it("accepts a digest carrying its own date and zone", () => {
    const parsed = MailDigestCurrentResponseSchema.parse({
      configured: true,
      has_active_mailbox: true,
      digest: DIGEST,
    });
    expect(parsed.digest?.digest_date).toBe("2026-09-01");
  });

  it("REJECTS a digest_date that is an instant rather than a calendar date", () => {
    // The identity is a civil date; a UTC slice of an instant would be a
    // different key on a different day.
    expect(
      MailDigestCurrentResponseSchema.safeParse({
        configured: true,
        has_active_mailbox: true,
        digest: { ...DIGEST, digest_date: "2026-09-01T00:00:00Z" },
      }).success,
    ).toBe(false);
  });

  it("REJECTS an unknown timezone", () => {
    expect(
      MailDigestCurrentResponseSchema.safeParse({
        configured: true,
        has_active_mailbox: true,
        digest: { ...DIGEST, timezone: "America/Nowhere" },
      }).success,
    ).toBe(false);
  });
});

describe("MailDigestGenerateAcceptedSchema", () => {
  it("is an ACKNOWLEDGEMENT and carries no digest_date", () => {
    // The API cannot know the date: the zone is the worker's configuration, so
    // inventing one from the API's clock would be a claim about a row that does
    // not exist yet and may be keyed differently.
    const parsed = MailDigestGenerateAcceptedSchema.parse({ accepted: true });
    expect(Object.keys(parsed)).toEqual(["accepted"]);
  });

  it("REJECTS accepted:false -- a refusal is a 4xx, not a 202 body", () => {
    expect(MailDigestGenerateAcceptedSchema.safeParse({ accepted: false }).success).toBe(false);
  });
});
