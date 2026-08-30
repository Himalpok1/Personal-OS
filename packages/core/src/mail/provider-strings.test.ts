import { describe, expect, it } from "vitest";
import {
  extractEmailDomain,
  MAIL_DOMAIN_MAX_CHARS,
  truncateProviderString,
} from "./provider-strings.js";

describe("truncateProviderString", () => {
  it("returns null for null and undefined so a nullable header passes through", () => {
    expect(truncateProviderString(null, 10)).toBeNull();
    expect(truncateProviderString(undefined, 10)).toBeNull();
  });

  it("distinguishes an empty string from an absent one", () => {
    // "the sender set no subject" and "there is no subject field" are
    // different facts; only the caller knows which it has.
    expect(truncateProviderString("", 10)).toBe("");
    expect(truncateProviderString(null, 10)).toBeNull();
  });

  it("leaves a string at or under the bound untouched", () => {
    expect(truncateProviderString("hello", 10)).toBe("hello");
    expect(truncateProviderString("exactly-10", 10)).toBe("exactly-10");
  });

  it("truncates a string over the bound", () => {
    expect(truncateProviderString("abcdefghijk", 5)).toBe("abcde");
  });

  it("never splits a surrogate pair", () => {
    // "ab" + rocket (2 code units). Cutting at 3 would leave a lone high
    // surrogate, which is invalid UTF-8 and which Postgres rejects with
    // 'invalid byte sequence for encoding "UTF8"'.
    const value = "ab\u{1F680}";
    expect(value.length).toBe(4);
    const cut = truncateProviderString(value, 3);
    expect(cut).toBe("ab");
    // The real assertion: no lone surrogate survives.
    expect([...(cut ?? "")].length).toBe(2);
    for (const ch of cut ?? "") {
      const code = ch.charCodeAt(0);
      expect(code >= 0xd800 && code <= 0xdfff).toBe(false);
    }
  });

  it("keeps a whole surrogate pair when it fits exactly", () => {
    expect(truncateProviderString("ab\u{1F680}", 4)).toBe("ab\u{1F680}");
  });

  it("returns an empty string for a non-positive bound", () => {
    expect(truncateProviderString("abc", 0)).toBe("");
    expect(truncateProviderString("abc", -1)).toBe("");
  });
});

describe("extractEmailDomain", () => {
  it("lowercases the domain", () => {
    expect(extractEmailDomain("Person@Example.COM")).toBe("example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(extractEmailDomain("  person@example.com  ")).toBe("example.com");
  });

  it("splits on the LAST @ so a quoted local part does not confuse it", () => {
    // RFC 5322 permits a quoted local part containing '@'.
    expect(extractEmailDomain('"a@b"@example.com')).toBe("example.com");
  });

  it("returns null rather than guessing when there is no usable domain", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "no-at-sign",
      "@example.com", // empty local part
      "person@", // empty domain
      "person@localhost", // single label is not a routable grouping key
      "person@exa mple.com", // whitespace in domain
      "person@.example.com",
      "person@example.com.",
      "person@exa..mple.com",
    ]) {
      expect(extractEmailDomain(bad)).toBeNull();
    }
  });

  it("rejects a domain over the RFC 1035 length cap", () => {
    const long = "a".repeat(MAIL_DOMAIN_MAX_CHARS) + ".com";
    expect(extractEmailDomain(`person@${long}`)).toBeNull();
  });

  it("accepts a subdomain", () => {
    expect(extractEmailDomain("person@mail.corp.example.com")).toBe("mail.corp.example.com");
  });
});
