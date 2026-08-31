import { MAIL_SUBJECT_MAX_CHARS } from "@personal-os/core/mail/provider-strings";
import { describe, expect, it } from "vitest";
import { fakeMessage } from "./gmail-client.fake.js";
import type { MailMessageMetadata } from "./mail-client.js";
import { contentHash, mailMessageContentInput, translateMailMessage } from "./translate.js";

function ok(payload: MailMessageMetadata) {
  const result = translateMailMessage(payload);
  if (!result.ok) throw new Error(`expected translation to succeed: ${result.rejection.keyPath}`);
  return result.row;
}

describe("translateMailMessage", () => {
  it("pulls sender, domain, display name and subject out of the allowlisted headers", () => {
    const row = ok(
      fakeMessage({
        id: "m1",
        threadId: "t1",
        from: '"Ada Lovelace" <ada@Mail.Example.com>',
        subject: "Quarterly report",
        internalDate: "1788000000000",
        labelIds: ["UNREAD", "INBOX"],
        sizeEstimate: 4096,
      }),
    );

    expect(row.externalId).toBe("m1");
    expect(row.threadId).toBe("t1");
    expect(row.fromAddress).toBe("ada@mail.example.com");
    expect(row.fromDomain).toBe("mail.example.com");
    expect(row.fromDisplayName).toBe("Ada Lovelace");
    expect(row.subject).toBe("Quarterly report");
    expect(row.internalDate.getTime()).toBe(1_788_000_000_000);
    expect(row.sizeEstimate).toBe(4096);
  });

  it("sorts provider labels so a reordered list is not a content change", () => {
    const a = ok(fakeMessage({ id: "m1", internalDate: "1", labelIds: ["UNREAD", "INBOX"] }));
    const b = ok(fakeMessage({ id: "m1", internalDate: "1", labelIds: ["INBOX", "UNREAD"] }));
    expect(a.providerLabels).toEqual(["INBOX", "UNREAD"]);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("matches header names case-insensitively, because the sender chose the casing", () => {
    const row = ok({
      id: "m1",
      threadId: "t1",
      internalDate: "1",
      payload: {
        headers: [
          { name: "subject", value: "lowercase name" },
          { name: "FROM", value: "ada@example.com" },
        ],
      },
    });
    expect(row.subject).toBe("lowercase name");
    expect(row.fromAddress).toBe("ada@example.com");
  });

  it("truncates a subject at the bound rather than storing it unbounded", () => {
    const row = ok(
      fakeMessage({ id: "m1", internalDate: "1", subject: "x".repeat(MAIL_SUBJECT_MAX_CHARS + 50) }),
    );
    expect(row.subject).toHaveLength(MAIL_SUBJECT_MAX_CHARS);
  });

  it("never splits a surrogate pair when truncating", () => {
    // An emoji in a subject line is enough to produce a lone surrogate, which
    // is invalid UTF-8 and which Postgres rejects outright.
    const subject = "a".repeat(MAIL_SUBJECT_MAX_CHARS - 1) + "\u{1F600}";
    const row = ok(fakeMessage({ id: "m1", internalDate: "1", subject }));
    expect(row.subject).toBe("a".repeat(MAIL_SUBJECT_MAX_CHARS - 1));
    expect(/[\uD800-\uDBFF]$/.test(row.subject ?? "")).toBe(false);
  });

  it("derives the domain from the TRUNCATED address, never from unstored bytes", () => {
    const long = "a".repeat(400) + "@example.com";
    const row = ok(fakeMessage({ id: "m1", internalDate: "1", from: long }));
    // The address is cut before the "@", so no domain is derivable -- which is
    // the honest outcome. A domain extracted from the full string would name a
    // domain the stored address does not contain.
    expect(row.fromAddress).not.toBeNull();
    expect(row.fromDomain).toBeNull();
  });

  it("leaves absent headers null rather than inventing an empty string", () => {
    const row = ok({ id: "m1", threadId: "t1", internalDate: "1" });
    expect(row.fromAddress).toBeNull();
    expect(row.fromDomain).toBeNull();
    expect(row.fromDisplayName).toBeNull();
    expect(row.subject).toBeNull();
    expect(row.providerLabels).toEqual([]);
    expect(row.sizeEstimate).toBeNull();
  });

  it("reports hasAttachment false because it is not derivable under gmail.metadata", () => {
    // Not a bug and not a TODO: payload.parts is absent under this scope, `q`
    // (and therefore has:attachment) is rejected, and Content-Type is
    // deliberately outside the four-header allowlist. The column means "not
    // known to carry an attachment", never "proven to carry none".
    const row = ok(fakeMessage({ id: "m1", internalDate: "1", subject: "with a file" }));
    expect(row.hasAttachment).toBe(false);
  });
});

describe("translateMailMessage rejections", () => {
  it("rejects a missing or unparseable internalDate rather than defaulting it", () => {
    // Defaulting to now() would write a fabricated arrival time that looks
    // exactly like a real one and sorts wrongly in every digest thereafter.
    for (const internalDate of [undefined, "", "not-a-number", "-5", "1.5"]) {
      const payload = { id: "m1", threadId: "t1", internalDate } as MailMessageMetadata;
      const result = translateMailMessage(payload);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.rejection.keyPath).toBe("internalDate");
    }
  });

  it("rejects epoch zero, which Number('') would otherwise produce", () => {
    const result = translateMailMessage({
      id: "m1",
      threadId: "t1",
      internalDate: "0",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing id or threadId", () => {
    expect(translateMailMessage({ id: "", threadId: "t", internalDate: "1" }).ok).toBe(false);
    expect(translateMailMessage({ id: "m", threadId: "", internalDate: "1" }).ok).toBe(false);
  });

  it("carries a key path and a typeof, and NEVER the offending value", () => {
    const secret = "a subject line nobody should see in a log";
    const result = translateMailMessage({
      id: "m1",
      threadId: "t1",
      internalDate: secret as unknown as string,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection).toEqual({ keyPath: "internalDate", received: "string" });
      expect(JSON.stringify(result.rejection)).not.toContain(secret);
    }
  });
});

describe("content hashing", () => {
  it("covers exactly the stored provider values and nothing clock-derived", () => {
    const row = ok(
      fakeMessage({
        id: "m1",
        threadId: "t1",
        from: "ada@example.com",
        subject: "s",
        internalDate: "1788000000000",
        labelIds: ["INBOX"],
        sizeEstimate: 10,
      }),
    );
    const { contentHash: _hash, ...rest } = row;
    // Asserting the INPUT, not only the digest: a test comparing two digests
    // passes just as happily when the function hashes the empty string.
    expect(mailMessageContentInput(rest)).toEqual({
      externalId: "m1",
      threadId: "t1",
      internalDateMs: 1_788_000_000_000,
      fromAddress: "ada@example.com",
      fromDomain: "example.com",
      fromDisplayName: null,
      subject: "s",
      providerLabels: ["INBOX"],
      hasAttachment: false,
      sizeEstimate: 10,
    });
    expect(row.contentHash).toBe(contentHash(mailMessageContentInput(rest)));
  });

  it("changes when any stored field changes", () => {
    const base = ok(fakeMessage({ id: "m1", internalDate: "1", subject: "a" }));
    const changed = [
      ok(fakeMessage({ id: "m1", internalDate: "1", subject: "b" })),
      ok(fakeMessage({ id: "m1", internalDate: "2", subject: "a" })),
      ok(fakeMessage({ id: "m1", internalDate: "1", subject: "a", labelIds: ["INBOX"] })),
      ok(fakeMessage({ id: "m1", internalDate: "1", subject: "a", from: "x@y.com" })),
      ok(fakeMessage({ id: "m1", internalDate: "1", subject: "a", sizeEstimate: 1 })),
    ];
    for (const row of changed) expect(row.contentHash).not.toBe(base.contentHash);
  });

  it("is stable across key ordering in the hashed object", () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });
});
