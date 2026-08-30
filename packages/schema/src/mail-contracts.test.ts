import {
  MAIL_ADDRESS_MAX_CHARS,
  MAIL_LABELS_MAX_COUNT,
  MAIL_SUBJECT_MAX_CHARS,
} from "@personal-os/core/mail/provider-strings";
import { describe, expect, it } from "vitest";
import {
  MailConnectionSchema,
  MailConnectionStatusSchema,
  MailCursorKindSchema,
  MailProviderSchema,
  MailSyncCursorSchema,
  MailSyncRunKindSchema,
} from "./mail-connections.js";
import { MailDigestRecordSchema } from "./mail-digests.js";
import { MailMessageMetadataSchema } from "./mail-messages.js";

const CONNECTION = {
  id: "11111111-1111-4111-8111-111111111111",
  provider: "gmail",
  external_account_id: "person@example.com",
  status: "active",
  granted_scope: "https://www.googleapis.com/auth/gmail.metadata",
  identity_verified_at: "2026-08-30T12:00:00Z",
  last_sync_error: null,
  last_sync_error_at: null,
  created_at: "2026-08-30T12:00:00Z",
  updated_at: "2026-08-30T12:00:00Z",
};

const CURSOR = {
  id: "22222222-2222-4222-8222-222222222222",
  connection_id: CONNECTION.id,
  scope_key: "INBOX",
  cursor_value: "987654321",
  cursor_kind: "gmail_history_id",
  needs_full_resync: false,
  last_successful_sync_at: "2026-08-30T12:00:00Z",
  last_full_sync_at: null,
};

const MESSAGE = {
  id: "33333333-3333-4333-8333-333333333333",
  connection_id: CONNECTION.id,
  external_id: "18f2a1b3c4d5e6f7",
  thread_id: "18f2a1b3c4d5e6f0",
  internal_date: "2026-08-30T09:15:00Z",
  from_address: "sender@example.com",
  from_domain: "example.com",
  from_display_name: "A Sender",
  subject: "Quarterly report",
  provider_labels: ["INBOX", "UNREAD", "CATEGORY_UPDATES"],
  has_attachment: false,
  size_estimate: 4096,
  deleted_at: null,
};

describe("MailProvider", () => {
  it("accepts gmail and rejects a provider that is deferred, not implemented", () => {
    expect(MailProviderSchema.parse("gmail")).toBe("gmail");
    // Microsoft Graph is deferred by ADR-052. Widening this enum is a one-line
    // change with NO migration, because provider deliberately carries no
    // database CHECK constraint (ADR-050).
    expect(() => MailProviderSchema.parse("microsoft_graph")).toThrow();
  });
});

describe("MailConnectionStatus", () => {
  it("accepts each of the four lifecycle states", () => {
    for (const s of ["active", "needs_reauth", "revoked", "disconnected"]) {
      expect(MailConnectionStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects a state outside the closed lifecycle", () => {
    for (const s of ["pending", "connected", "error", "ACTIVE", ""]) {
      expect(() => MailConnectionStatusSchema.parse(s)).toThrow();
    }
  });
});

describe("MailConnectionSchema", () => {
  it("parses a valid connection in each status", () => {
    for (const status of MailConnectionStatusSchema.options) {
      expect(MailConnectionSchema.parse({ ...CONNECTION, status }).status).toBe(status);
    }
  });

  it("rejects an invalid status", () => {
    expect(() => MailConnectionSchema.parse({ ...CONNECTION, status: "connected" })).toThrow();
  });

  it("accepts a known error code and REJECTS provider prose in last_sync_error", () => {
    expect(
      MailConnectionSchema.parse({ ...CONNECTION, last_sync_error: "cursor_expired" })
        .last_sync_error,
    ).toBe("cursor_expired");
    // The load-bearing assertion of this whole file: because the field is typed
    // to the closed enum rather than z.string(), a leak is a parse failure at
    // the API boundary, not a silently-passing string on a user's screen.
    expect(() =>
      MailConnectionSchema.parse({
        ...CONNECTION,
        last_sync_error: "Token has been expired or revoked.",
      }),
    ).toThrow();
  });

  it("bounds external_account_id", () => {
    const tooLong = "a".repeat(MAIL_ADDRESS_MAX_CHARS) + "@example.com";
    expect(() =>
      MailConnectionSchema.parse({ ...CONNECTION, external_account_id: tooLong }),
    ).toThrow();
  });

  it("carries no credential-shaped field, structurally", () => {
    // The same proof health-metrics.test.ts runs: walk the schema's own keys
    // rather than trusting review. A credential must be inexpressible here, not
    // merely absent today.
    const forbidden =
      /(token|ciphertext|iv|auth_tag|secret|password|credential|client_id|client_secret|state_hash|redirect_uri)/i;
    const seen: string[] = [];
    // Reads only the public `.shape`, and recurses into any nested object
    // schema. Deliberately does NOT reach into Zod's private `_def`: that is
    // version-coupled internals, and a proof that breaks on a Zod upgrade is a
    // proof that will be deleted rather than fixed.
    const walk = (schema: unknown, depth: number): void => {
      if (depth > 8 || schema === null || typeof schema !== "object") return;
      const shape = (schema as { shape?: unknown }).shape;
      if (shape === null || typeof shape !== "object") return;
      for (const [key, child] of Object.entries(shape as Record<string, unknown>)) {
        seen.push(key);
        walk(child, depth + 1);
      }
    };
    for (const schema of [MailConnectionSchema, MailSyncCursorSchema, MailMessageMetadataSchema]) {
      walk(schema, 0);
    }
    // Positive control: the walk actually visited fields.
    expect(seen).toContain("external_account_id");
    expect(seen).toContain("cursor_value");
    expect(seen).toContain("subject");
    expect(seen.filter((k) => forbidden.test(k))).toEqual([]);
  });
});

describe("MailSyncCursorSchema", () => {
  it("parses a cursor and treats the value as an opaque string", () => {
    const parsed = MailSyncCursorSchema.parse(CURSOR);
    expect(parsed.cursor_value).toBe("987654321");
    // Opaque means opaque: it stays a string. Gmail's historyId is decimal
    // today, but that is one provider's implementation detail and coercing it
    // to a number would bake it into the contract.
    expect(typeof parsed.cursor_value).toBe("string");
  });

  it("represents the never-synced state: no cursor, full resync required", () => {
    const fresh = MailSyncCursorSchema.parse({
      ...CURSOR,
      cursor_value: null,
      needs_full_resync: true,
      last_successful_sync_at: null,
    });
    expect(fresh.cursor_value).toBeNull();
    expect(fresh.needs_full_resync).toBe(true);
  });

  it("represents cursor expiry: a stale cursor retained alongside the resync flag", () => {
    // ADR-053's first-class transition. The old cursor is deliberately still
    // representable while needs_full_resync is true -- it is replaced by the
    // bounded full sync, not erased on detection.
    const expired = MailSyncCursorSchema.parse({ ...CURSOR, needs_full_resync: true });
    expect(expired.cursor_value).toBe("987654321");
    expect(expired.needs_full_resync).toBe(true);
  });

  it("rejects an empty cursor value, which is not the same as no cursor", () => {
    expect(() => MailSyncCursorSchema.parse({ ...CURSOR, cursor_value: "" })).toThrow();
  });

  it("rejects an unknown cursor kind", () => {
    expect(MailCursorKindSchema.parse("gmail_history_id")).toBe("gmail_history_id");
    expect(() => MailSyncCursorSchema.parse({ ...CURSOR, cursor_kind: "graph_delta" })).toThrow();
  });

  it("has no date-watermark field, unlike health_metric_streams", () => {
    const keys = Object.keys(MailSyncCursorSchema.shape);
    for (const forbidden of [
      "verified_through_date",
      "earliest_verified_date",
      "first_data_date",
      "backfill_cursor_date",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("MailSyncRunKind", () => {
  it("separates a bounded resync from a deliberate backfill", () => {
    expect(MailSyncRunKindSchema.options).toEqual(["incremental", "full", "backfill", "manual"]);
  });
});

describe("MailMessageMetadataSchema", () => {
  it("parses a complete metadata message", () => {
    expect(MailMessageMetadataSchema.parse(MESSAGE).subject).toBe("Quarterly report");
  });

  it("is metadata only: body, snippet and attachment content are inexpressible", () => {
    const keys = Object.keys(MailMessageMetadataSchema.shape);
    for (const forbidden of [
      "body",
      "body_html",
      "body_text",
      "snippet",
      "payload",
      "raw",
      "attachments",
      "attachment_data",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    // ...and an object carrying one is rejected rather than silently stripped
    // only if the schema is strict; it is not, so assert the shape instead.
    expect(keys).toContain("has_attachment");
    expect(keys).not.toContain("attachment_content");
  });

  it("uses provider_labels, not Gmail's label_ids vocabulary", () => {
    const keys = Object.keys(MailMessageMetadataSchema.shape);
    expect(keys).toContain("provider_labels");
    expect(keys).not.toContain("label_ids");
  });

  it("bounds the two attacker-authored fields", () => {
    // subject and from_display_name are chosen by whoever sent the mail. They
    // are the entire untrusted-text surface Phase 7 introduces (ADR-054).
    expect(() =>
      MailMessageMetadataSchema.parse({
        ...MESSAGE,
        subject: "x".repeat(MAIL_SUBJECT_MAX_CHARS + 1),
      }),
    ).toThrow();
    expect(() =>
      MailMessageMetadataSchema.parse({ ...MESSAGE, from_display_name: "x".repeat(1000) }),
    ).toThrow();
  });

  it("bounds the label array in both element length and count", () => {
    expect(() =>
      MailMessageMetadataSchema.parse({
        ...MESSAGE,
        provider_labels: Array.from({ length: MAIL_LABELS_MAX_COUNT + 1 }, (_, i) => `L${i}`),
      }),
    ).toThrow();
    expect(() =>
      MailMessageMetadataSchema.parse({ ...MESSAGE, provider_labels: ["x".repeat(200)] }),
    ).toThrow();
  });

  it("allows a header-stripped message: nullable sender and subject", () => {
    const bare = MailMessageMetadataSchema.parse({
      ...MESSAGE,
      from_address: null,
      from_domain: null,
      from_display_name: null,
      subject: null,
    });
    expect(bare.subject).toBeNull();
    expect(bare.from_domain).toBeNull();
  });

  it("distinguishes an empty subject from an absent one", () => {
    expect(MailMessageMetadataSchema.parse({ ...MESSAGE, subject: "" }).subject).toBe("");
    expect(MailMessageMetadataSchema.parse({ ...MESSAGE, subject: null }).subject).toBeNull();
  });

  it("rejects a negative size estimate", () => {
    expect(() => MailMessageMetadataSchema.parse({ ...MESSAGE, size_estimate: -1 })).toThrow();
  });

  it("carries internal_date as an instant, not a civil date", () => {
    // Gmail supplies a real instant; storing a civil date here would discard
    // precision the provider already gave us (unlike ADR-048's health case).
    expect(() =>
      MailMessageMetadataSchema.parse({ ...MESSAGE, internal_date: "2026-08-30" }),
    ).toThrow();
  });
});

describe("MailDigestRecordSchema", () => {
  const DIGEST = {
    id: "44444444-4444-4444-8444-444444444444",
    digest_date: "2026-08-30",
    timezone: "America/Chicago",
    content: { text: "Four threads await a reply." },
    model_id: "55555555-5555-4555-8555-555555555555",
    generated_at: "2026-08-30T13:00:00Z",
  };

  it("parses a digest", () => {
    expect(MailDigestRecordSchema.parse(DIGEST).content.text).toBe("Four threads await a reply.");
  });

  it("is GLOBAL: there is no connection_id in the identity", () => {
    // ADR-053. A per-mailbox digest would make "what needs my attention today"
    // depend on how many mailboxes happen to be connected.
    expect(Object.keys(MailDigestRecordSchema.shape)).not.toContain("connection_id");
  });

  it("requires a real IANA timezone", () => {
    expect(() => MailDigestRecordSchema.parse({ ...DIGEST, timezone: "Mars/Olympus" })).toThrow();
  });

  it("requires a calendar date, not an instant, for digest_date", () => {
    expect(() =>
      MailDigestRecordSchema.parse({ ...DIGEST, digest_date: "2026-08-30T00:00:00Z" }),
    ).toThrow();
  });

  it("allows a null model_id so a deleted model does not take history with it", () => {
    expect(MailDigestRecordSchema.parse({ ...DIGEST, model_id: null }).model_id).toBeNull();
  });
});
