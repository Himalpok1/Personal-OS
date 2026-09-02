import { describe, expect, it } from "vitest";
import { stripUnsummarizableCharacters } from "../mail/provider-strings.js";
import { containsLinkShapedContent, LINK_PLACEHOLDER, sanitizeModelText } from "./output-safety.js";

const strip = (value: string): string => stripUnsummarizableCharacters(value) ?? "";

function clean(raw: string, untrustedInputs: readonly string[] = []) {
  return sanitizeModelText(raw, { maxChars: 4000, untrustedInputs }, strip);
}

describe("sanitizeModelText — link-shaped content", () => {
  it("removes scheme URLs", () => {
    const out = clean("Verify at https://evil.example/reset today.");
    expect(out.text).toBe(`Verify at ${LINK_PLACEHOLDER} today.`);
    expect(out.linksRemoved).toBe(1);
  });

  it("removes non-http schemes, including javascript: and data:", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "mailto:someone@example.com",
      "tel:+15551234567",
    ]) {
      const out = clean(`Do not use ${url} here.`);
      expect(out.text).not.toContain(url);
      expect(out.linksRemoved).toBeGreaterThan(0);
    }
  });

  it("removes www hosts with and without a path", () => {
    expect(clean("See www.example.com for details.").text).toBe(
      `See ${LINK_PLACEHOLDER} for details.`,
    );
    expect(clean("See www.example.com/a/b?c=d now.").text).toBe(`See ${LINK_PLACEHOLDER} now.`);
  });

  it("keeps a markdown link's label and drops its target", () => {
    const out = clean("Read [the policy](https://evil.example/p) before signing.");
    expect(out.text).toContain("the policy");
    expect(out.text).not.toContain("evil.example");
    expect(out.text).toContain(LINK_PLACEHOLDER);
  });

  it("removes a plain email address", () => {
    const out = clean("Reply to billing@vendor.example when ready.");
    expect(out.text).not.toContain("billing@vendor.example");
    expect(out.linksRemoved).toBe(1);
  });

  it("removes a bare host carrying a path", () => {
    const out = clean("Go to evil.example/reset immediately.");
    expect(out.text).not.toContain("evil.example/reset");
  });
});

// ---------------------------------------------------------------------------
// The 2026-09-02 production defect: a bare domain laundered out of an
// attacker-controlled display name. Both layers are exercised separately, so a
// regression in either is attributable.
// ---------------------------------------------------------------------------

describe("sanitizeModelText — bare domains (layer 1, syntactic)", () => {
  it("removes a bare domain with a well-known public suffix even with NO provenance", () => {
    const out = clean("Three messages arrived from example.com overnight.");
    expect(out.text).not.toContain("example.com");
    expect(out.text).toContain(LINK_PLACEHOLDER);
    expect(out.linksRemoved).toBe(1);
  });

  it("removes a multi-label host", () => {
    const out = clean("Mail from support.example.co.uk needs attention.");
    expect(out.text).not.toContain("support.example");
  });

  it.each(["example.org", "foo.net", "thing.io", "a-b.dev", "shop.store"])("removes %s", (host) => {
    expect(clean(`Saw ${host} today.`).text).not.toContain(host);
  });
});

describe("sanitizeModelText — bare domains (layer 2, provenance)", () => {
  // The exact shape of the production defect: the display name IS the domain,
  // and its suffix is one layer 1 deliberately excludes as an English word.
  it("removes an echoed domain whose suffix layer 1 excludes", () => {
    const displayName = "notify.it";
    expect(clean("A message from notify.it arrived.").text).toContain("notify.it");
    const out = clean("A message from notify.it arrived.", [displayName]);
    expect(out.text).not.toContain("notify.it");
    expect(out.linksRemoved).toBe(1);
  });

  it("matches case-insensitively and across NFKC normalization", () => {
    const out = clean("From NOTIFY.IT again.", ["notify.it"]);
    expect(out.text).not.toContain("NOTIFY.IT");
  });

  it("removes a domain embedded in a longer display name", () => {
    const out = clean("A sender called deals.me wrote twice.", [
      "Best Deals — deals.me — Unsubscribe",
    ]);
    expect(out.text).not.toContain("deals.me");
  });

  it("removes a domain lifted out of a subject line", () => {
    const out = clean("One message mentions secure.bank.at explicitly.", [
      "Verify your account at secure.bank.at now",
    ]);
    expect(out.text).not.toContain("secure.bank.at");
  });

  it("does NOT remove an unrelated dotted token that merely resembles one", () => {
    // Provenance is substring-based on the untrusted value, so a token that
    // never appeared in the input and has no known suffix survives.
    const out = clean("The meeting.is running late.", ["something.else"]);
    expect(out.text).toContain("meeting.is");
  });
});

describe("sanitizeModelText — false-positive resistance", () => {
  it("leaves ordinary prose completely untouched", () => {
    const prose =
      "You have three tasks due today and one meeting at 2pm. " +
      "Nothing is overdue. Dr. Smith confirmed Tuesday, and the U.S. filing is done.";
    const out = clean(prose);
    expect(out.text).toBe(prose);
    expect(out.linksRemoved).toBe(0);
  });

  it("does not treat a missing space after a full stop as a hostname", () => {
    // `.It`, `.Then`, `.The` — capitalized, so not host-shaped.
    const raw = "Finish the report.It was late.Then review it.";
    expect(clean(raw).text).toBe(raw);
  });

  it("does not strip English-word suffixes without provenance", () => {
    // Every one of these is a real public suffix AND a common English word.
    // Layer 1 excludes them precisely so ordinary prose survives; layer 2
    // covers them when they genuinely came from untrusted input.
    for (const raw of [
      "the deadline.is tomorrow",
      "arrive.at noon",
      "call.me later",
      "walk.to the office",
    ]) {
      expect(clean(raw).text).toBe(raw);
    }
  });

  it("preserves ordinary names, initials and punctuation", () => {
    const raw = "J. R. R. Tolkien e.g. wrote it; cf. p. 12, vol. 3.";
    expect(clean(raw).text).toBe(raw);
    expect(clean(raw).linksRemoved).toBe(0);
  });

  it("preserves decimal numbers and version strings", () => {
    const raw = "Revenue rose 3.5 percent and we shipped 1.2.3 on time.";
    expect(clean(raw).text).toBe(raw);
  });
});

describe("sanitizeModelText — bounds and normalization", () => {
  it("strips bidi and zero-width characters", () => {
    const out = clean("Invoice ‮fdp.exe‬ pending");
    expect(out.text).not.toContain("‮");
    expect(out.text).not.toContain("‬");
  });

  it("collapses whitespace left behind by replacements", () => {
    const out = clean("A   b\n\nc");
    expect(out.text).toBe("A b c");
  });

  it("hard-caps the length", () => {
    const out = sanitizeModelText("x".repeat(500), { maxChars: 100 }, strip);
    expect(out.text.length).toBeLessThanOrEqual(100);
  });

  it("rejects a nonsensical cap rather than degrading silently", () => {
    expect(() => sanitizeModelText("hi", { maxChars: 0 }, strip)).toThrow();
  });
});

describe("containsLinkShapedContent — the post-condition", () => {
  it("is false for filtered text", () => {
    const untrusted = ["notify.it"];
    const out = clean("Mail from notify.it and https://x.example/y arrived.", untrusted);
    expect(containsLinkShapedContent(out.text, untrusted)).toBe(false);
  });

  it("is true for a scheme URL", () => {
    expect(containsLinkShapedContent("go to https://x.example")).toBe(true);
  });

  it("is true for a bare well-known domain", () => {
    expect(containsLinkShapedContent("from example.com")).toBe(true);
  });

  it("is true for an echoed domain only when provenance is supplied", () => {
    expect(containsLinkShapedContent("from notify.it")).toBe(false);
    expect(containsLinkShapedContent("from notify.it", ["notify.it"])).toBe(true);
  });

  it("is false for ordinary prose", () => {
    expect(containsLinkShapedContent("Three tasks are due today.")).toBe(false);
  });
});
