import { describe, expect, it } from "vitest";
import { FOCUS_MAX_SUGGESTION_CHARS } from "./contracts.js";
import { containsLinkShapedContent, sanitizeFocusSuggestion } from "./output.js";

describe("sanitizeFocusSuggestion (Checkpoint 9.8)", () => {
  it("strips a scheme-bearing URL", () => {
    const result = sanitizeFocusSuggestion("Consider [1], see https://evil.example/reset.");
    expect(result.text).not.toContain("https://");
    expect(result.linksRemoved).toBeGreaterThan(0);
  });

  it("strips a markdown link, keeping the human-readable label", () => {
    const result = sanitizeFocusSuggestion("Check [the renewal page](https://example.com/renew).");
    expect(result.text).toContain("the renewal page");
    expect(result.text).not.toContain("https://");
  });

  it("hard-caps the length", () => {
    const result = sanitizeFocusSuggestion("a".repeat(FOCUS_MAX_SUGGESTION_CHARS + 100));
    expect(result.text.length).toBeLessThanOrEqual(FOCUS_MAX_SUGGESTION_CHARS);
  });

  it("strips control/bidi-override characters", () => {
    const result = sanitizeFocusSuggestion("safe⁦hidden⁩answer");
    expect(result.text).not.toContain("⁦");
  });

  it("does NOT strip a bare-suffix-looking token when it is not in untrustedInputs", () => {
    const result = sanitizeFocusSuggestion("Consider index.ts [1], it's overdue.");
    expect(result.text).toContain("index.ts");
  });

  it("strips a host-shaped token that echoes an external event title/location (provenance layer)", () => {
    const untrusted = ["Sync with vendor at portal.internal"];
    const result = sanitizeFocusSuggestion(
      "Your meeting at portal.internal [1] is overdue.",
      untrusted,
    );
    expect(result.text).not.toContain("portal.internal");
    expect(result.text).toContain("[link removed]");
  });
});

describe("containsLinkShapedContent", () => {
  it("is true for a raw URL", () => {
    expect(containsLinkShapedContent("visit https://example.com now")).toBe(true);
  });

  it("is false for ordinary prose", () => {
    expect(containsLinkShapedContent("Consider finishing task [1] today.")).toBe(false);
  });

  it("honours the same untrustedInputs as the filter", () => {
    expect(containsLinkShapedContent("at portal.internal", ["portal.internal"])).toBe(true);
    expect(containsLinkShapedContent("at portal.internal")).toBe(false);
  });
});
