import { describe, expect, it } from "vitest";
import { MAIL_DIGEST_MAX_TEXT_CHARS } from "./contracts.js";
import { containsLinkShapedContent, LINK_PLACEHOLDER, sanitizeDigestText } from "./output.js";

const RLO = "\u202E";
const ZWSP = "\u200B";

describe("sanitizeDigestText: link-shaped content", () => {
  it("strips a scheme URL and says how many it removed", () => {
    // The content-laundering exploit ADR-054 names: attacker text paraphrased
    // into first-party prose, persisted, and rendered in the system's own voice
    // -- carrying a live link the user has every reason to trust.
    const result = sanitizeDigestText(
      "You have a message asking you to verify at https://evil.example/reset?token=abc123 today.",
    );
    expect(result.text).not.toContain("evil.example");
    expect(result.text).not.toContain("https://");
    expect(result.text).toContain(LINK_PLACEHOLDER);
    expect(result.linksRemoved).toBe(1);
  });

  it("strips every scheme, not only http", () => {
    for (const url of [
      "http://a.example/x",
      "https://a.example/x",
      "ftp://a.example/x",
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "mailto:someone@example.com",
    ]) {
      const result = sanitizeDigestText(`See ${url} for details.`);
      expect(result.text, url).toContain(LINK_PLACEHOLDER);
      expect(containsLinkShapedContent(result.text), url).toBe(false);
    }
  });

  it("keeps a markdown link's LABEL and drops its destination", () => {
    const result = sanitizeDigestText("[Secure your account](https://evil.example/phish) now.");
    expect(result.text).toContain("Secure your account");
    expect(result.text).not.toContain("evil.example");
    expect(result.text).toContain(LINK_PLACEHOLDER);
  });

  it("strips a www host with or without a path", () => {
    expect(sanitizeDigestText("visit www.evil.example now").text).not.toContain("evil");
    expect(sanitizeDigestText("visit www.evil.example/go now").text).not.toContain("evil");
  });

  it("strips an email address, which the input contract never supplies", () => {
    // MailDigestInput carries no from_address (ADR-054: "no addresses"), so an
    // address in the OUTPUT was invented or lifted from a subject line. Either
    // way it is not something to render.
    const result = sanitizeDigestText("A message from attacker@evil.example arrived.");
    expect(result.text).not.toContain("attacker@evil.example");
    expect(result.linksRemoved).toBe(1);
  });

  it("strips a bare host that carries a path", () => {
    const result = sanitizeDigestText("Go to evil.example/reset to continue.");
    expect(result.text).not.toContain("evil.example/reset");
  });

  it("removes SEVERAL links from one sentence", () => {
    const result = sanitizeDigestText("See https://a.example/1 and https://b.example/2 today.");
    expect(result.linksRemoved).toBe(2);
    expect(containsLinkShapedContent(result.text)).toBe(false);
  });

  it("REMOVES a bare domain -- the residual this test used to pin as accepted", () => {
    // INVERTED AT CHECKPOINT 8.1, and the inversion is the point. This test
    // previously asserted that a bare domain SURVIVED, on the reasoning that
    // "the residual is narrow by construction: the input carries no domain, so
    // nothing legitimate should produce one".
    //
    // Production falsified that on 2026-09-02: `from_display_name` is in the
    // model's input allowlist and a sender can simply make it a domain, so the
    // scheduled digest emitted one. The premise was false, which means the test
    // was pinning a defect rather than a decision.
    const result = sanitizeDigestText("Three messages arrived from github.com today.");
    expect(result.text).not.toContain("github.com");
    expect(result.linksRemoved).toBe(1);
    expect(containsLinkShapedContent(result.text)).toBe(false);
  });

  it("removes an echoed domain whose suffix the syntactic layer excludes", () => {
    // The exact production shape: the display name IS the domain, and its
    // suffix (`.it`) is one the syntactic layer deliberately excludes because
    // it is also an English word. Provenance is what closes it.
    const untrusted = ["notify.it"];
    expect(sanitizeDigestText("A message from notify.it arrived.").text).toContain("notify.it");
    const result = sanitizeDigestText("A message from notify.it arrived.", untrusted);
    expect(result.text).not.toContain("notify.it");
    expect(containsLinkShapedContent(result.text, untrusted)).toBe(false);
  });

  it("leaves ordinary prose completely alone", () => {
    const prose =
      "You have 12 new messages, 4 of them unread. Two are flagged important, and most are updates.";
    expect(sanitizeDigestText(prose).text).toBe(prose);
    expect(sanitizeDigestText(prose).linksRemoved).toBe(0);
  });

  it("does not mistake ordinary punctuation for a link", () => {
    for (const prose of [
      "You have mail, e.g. two receipts.",
      "Nothing needs attention today.",
      "Check the Updates category (3 unread).",
      "Version 2.5 of the report arrived.",
    ]) {
      expect(sanitizeDigestText(prose).linksRemoved, prose).toBe(0);
    }
  });
});

describe("sanitizeDigestText: unicode and shape", () => {
  it("strips bidi overrides from the OUTPUT too", () => {
    // A bidi override in the stored text would let a laundered sentence render
    // as something other than what was stored -- which defeats reviewing the
    // stored text at all.
    const result = sanitizeDigestText(`You have mail ${RLO}txt.exe waiting.`);
    expect(result.text).not.toContain(RLO);
    expect(result.text).toBe("You have mail txt.exe waiting.");
  });

  it("strips zero-width padding", () => {
    const result = sanitizeDigestText(`Twelve${ZWSP} messages${ZWSP} arrived.`);
    expect(result.text).toBe("Twelve messages arrived.");
  });

  it("collapses the whitespace a replacement leaves behind", () => {
    const result = sanitizeDigestText("See   https://a.example/1    now.");
    expect(result.text).not.toMatch(/ {2}/);
  });

  it("hard-caps the persisted length", () => {
    const long = "word ".repeat(5000);
    const result = sanitizeDigestText(long);
    expect(result.text.length).toBeLessThanOrEqual(MAIL_DIGEST_MAX_TEXT_CHARS);
  });

  it("returns an empty string for input that was entirely control characters", () => {
    // The generator treats an empty result as a FAILURE, so this is the shape
    // that must not silently become a persisted digest.
    expect(sanitizeDigestText(`${RLO}${ZWSP}`).text).toBe("");
    expect(sanitizeDigestText("   ").text).toBe("");
  });
});

describe("containsLinkShapedContent", () => {
  it("is the post-condition the generator asserts rather than assumes", () => {
    expect(containsLinkShapedContent("plain prose with no links")).toBe(false);
    expect(containsLinkShapedContent("go to https://evil.example")).toBe(true);
    expect(containsLinkShapedContent("mail from a@b.example")).toBe(true);
  });

  it("is STATELESS across repeated calls", () => {
    // A /g regex advances lastIndex between `test` calls, so a shared instance
    // would return true, then false, then true for the same string -- and the
    // generator calls this on every attempt.
    const text = "go to https://evil.example/x";
    expect(containsLinkShapedContent(text)).toBe(true);
    expect(containsLinkShapedContent(text)).toBe(true);
    expect(containsLinkShapedContent(text)).toBe(true);
  });

  it("does not flag the placeholder the filter itself inserts", () => {
    // Otherwise every filtered digest would fail its own post-condition and be
    // refused -- the filter would have made itself unusable.
    expect(containsLinkShapedContent(`You have mail. ${LINK_PLACEHOLDER}`)).toBe(false);
  });

  it("agrees with sanitizeDigestText on every corpus entry", () => {
    // The property that matters: whatever the filter emits must pass the
    // post-condition, or the generator refuses a digest it just produced.
    const corpus = [
      "Verify at https://evil.example/reset?token=abc",
      "[Click here](https://evil.example/phish)",
      "Mail from attacker@evil.example",
      "Go to evil.example/reset",
      "visit www.evil.example/go",
      "javascript:alert(1) and data:text/html,x",
      "You have 12 messages.",
    ];
    for (const raw of corpus) {
      const { text } = sanitizeDigestText(raw);
      expect(containsLinkShapedContent(text), raw).toBe(false);
    }
  });
});
