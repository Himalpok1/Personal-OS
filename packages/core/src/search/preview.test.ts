import { describe, expect, it } from "vitest";
import {
  SEARCH_PREVIEW_MAX_CHARS,
  SEARCH_SENDER_MAX_CHARS,
  SEARCH_TITLE_MAX_CHARS,
  searchPreview,
  searchTitle,
} from "./preview.js";

// Control characters as escape sequences, never literals -- see query.test.ts.
const RLO = "\u202E";
const ZWSP = "\u200B";

describe("searchTitle", () => {
  it("returns ordinary text unchanged", () => {
    expect(searchTitle("Renew the insurance", "(untitled)")).toBe("Renew the insurance");
  });

  it("falls back when the value is null or undefined", () => {
    expect(searchTitle(null, "(no subject)")).toBe("(no subject)");
    expect(searchTitle(undefined, "(no subject)")).toBe("(no subject)");
  });

  it("falls back when the value is empty or normalizes away to nothing", () => {
    expect(searchTitle("", "(no subject)")).toBe("(no subject)");
    expect(searchTitle("   ", "(no subject)")).toBe("(no subject)");
    // A title made entirely of bidi overrides must not render as a blank row.
    expect(searchTitle(`${RLO}${ZWSP}`, "(no subject)")).toBe("(no subject)");
  });

  it("strips control characters BEFORE truncating", () => {
    // Ordering is the point. Truncating first would let a budget's worth of
    // invisible codepoints arrive as an empty title -- the Checkpoint 8.1
    // finding, restated for a different surface.
    const padded = ZWSP.repeat(SEARCH_TITLE_MAX_CHARS) + "actual title";
    expect(searchTitle(padded, "(fallback)")).toBe("actual title");
  });

  it("never exceeds the bound, even with no space to break on", () => {
    const long = "x".repeat(SEARCH_TITLE_MAX_CHARS * 3);
    expect(searchTitle(long, "(fallback)").length).toBeLessThanOrEqual(SEARCH_TITLE_MAX_CHARS);
  });

  it("never exceeds a caller-supplied bound", () => {
    const result = searchTitle("a".repeat(500), "(fallback)", SEARCH_SENDER_MAX_CHARS);
    expect(result.length).toBeLessThanOrEqual(SEARCH_SENDER_MAX_CHARS);
  });

  it("does not split a surrogate pair at the cut", () => {
    // A lone surrogate is invalid UTF-8 and PostgreSQL rejects it outright; an
    // emoji in a mail subject is enough to hit this.
    const result = searchTitle("\u{1F600}".repeat(200), "(fallback)");
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result)).toBe(false);
  });

  it("does NOT strip links -- a search result quotes the user's own stored text", () => {
    // Deliberately unlike sanitizeModelText. Rewriting a note the user wrote
    // into "renew at [link removed]" would be lying about their own content in
    // the one feature whose purpose is finding it.
    expect(searchTitle("renew at https://example.com/billing", "(x)")).toBe(
      "renew at https://example.com/billing",
    );
  });
});

describe("searchPreview", () => {
  it("returns null for absent or empty text rather than an empty string", () => {
    expect(searchPreview(null)).toBeNull();
    expect(searchPreview(undefined)).toBeNull();
    expect(searchPreview("")).toBeNull();
    expect(searchPreview("  ")).toBeNull();
  });

  it("bounds long text", () => {
    const result = searchPreview("word ".repeat(500));
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(SEARCH_PREVIEW_MAX_CHARS);
  });

  it("strips control characters", () => {
    expect(searchPreview(`body with${RLO}controls`)).toBe("body withcontrols");
  });

  it("honours a caller-supplied bound", () => {
    const result = searchPreview("a".repeat(400), SEARCH_SENDER_MAX_CHARS);
    expect(result!.length).toBeLessThanOrEqual(SEARCH_SENDER_MAX_CHARS);
  });
});
