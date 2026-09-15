import { describe, expect, it } from "vitest";
import { ASK_MAX_ANSWER_CHARS } from "./contracts.js";
import { containsLinkShapedContent, sanitizeAskAnswer } from "./output.js";

describe("sanitizeAskAnswer (Checkpoint 8.6B design §8)", () => {
  it("strips a scheme-bearing URL", () => {
    const result = sanitizeAskAnswer("See https://evil.example/reset for details.");
    expect(result.text).not.toContain("https://");
    expect(result.linksRemoved).toBeGreaterThan(0);
  });

  it("strips a markdown link, keeping the human-readable label", () => {
    const result = sanitizeAskAnswer("Check [the renewal page](https://example.com/renew).");
    expect(result.text).toContain("the renewal page");
    expect(result.text).not.toContain("https://");
  });

  it("does NOT run the provenance layer against first-party text -- ADR-059's rule", () => {
    // The provenance layer would need untrustedInputs to strip a bare-suffix
    // host; Ask deliberately passes none (see output.ts's module comment), so
    // an ordinary-looking version number or filename in the user's OWN note,
    // echoed back by the model, must survive.
    const result = sanitizeAskAnswer("Your note mentions upgrading to v18.2.1 in index.ts.");
    expect(result.text).toContain("v18.2.1");
    expect(result.text).toContain("index.ts");
  });

  it("still strips an INVENTED or genuinely link-shaped bare domain via the syntactic layer", () => {
    const result = sanitizeAskAnswer("Go to malicious-site.com for more.");
    expect(result.text).not.toContain("malicious-site.com");
  });

  it("hard-caps the length", () => {
    const result = sanitizeAskAnswer("a".repeat(ASK_MAX_ANSWER_CHARS + 500));
    expect(result.text.length).toBeLessThanOrEqual(ASK_MAX_ANSWER_CHARS);
  });

  it("strips control/bidi-override characters", () => {
    const result = sanitizeAskAnswer("safe⁦hidden⁩answer");
    expect(result.text).not.toContain("⁦");
  });
});

describe("containsLinkShapedContent", () => {
  it("is true for a raw URL", () => {
    expect(containsLinkShapedContent("visit https://example.com now")).toBe(true);
  });

  it("is false for ordinary prose, including version-shaped and filename-shaped tokens", () => {
    expect(containsLinkShapedContent("You have 2 tasks, one about v18.2.1 in index.ts.")).toBe(
      false,
    );
  });
});

describe("sanitizeAskAnswer -- Checkpoint 9.7 untrustedInputs (external event text)", () => {
  it("with no untrustedInputs a dotted token echoing nothing survives (8.6B behaviour unchanged)", () => {
    const result = sanitizeAskAnswer("Meeting at portal.internal at 14:30.");
    expect(result.text).toContain("portal.internal");
  });

  it("strips a host-shaped token that echoes an external event title/location (provenance layer)", () => {
    const untrusted = ["Sync with vendor at portal.internal"];
    const result = sanitizeAskAnswer("Your 14:30 meeting is at portal.internal [1].", untrusted);
    expect(result.text).not.toContain("portal.internal");
    expect(result.text).toContain("[link removed]");
    expect(result.linksRemoved).toBe(1);
  });

  it("does not strip the owner's own dotted text when it is NOT in untrustedInputs", () => {
    const untrusted = ["Dentist"];
    const result = sanitizeAskAnswer("Your note mentions v18.2.1 in index.ts [2].", untrusted);
    expect(result.text).toContain("v18.2.1");
    expect(result.text).toContain("index.ts");
  });

  it("containsLinkShapedContent honours the same untrustedInputs as the filter", () => {
    expect(containsLinkShapedContent("at portal.internal", ["portal.internal"])).toBe(true);
    expect(containsLinkShapedContent("at portal.internal")).toBe(false);
  });
});
