import { describe, expect, it } from "vitest";
import { truncateField } from "./text-bounds.js";

describe("truncateField", () => {
  it("returns the value verbatim when under the limit", () => {
    expect(truncateField("hello", 10)).toEqual({ text: "hello", truncated: false });
  });

  it("returns the value verbatim when exactly at the limit (no ellipsis)", () => {
    expect(truncateField("hello", 5)).toEqual({ text: "hello", truncated: false });
  });

  it("truncates when one character over the limit", () => {
    const result = truncateField("hellox", 5);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("hell…");
    expect(result.text.length).toBeLessThanOrEqual(5);
  });

  it("returns an empty string verbatim, never truncated", () => {
    expect(truncateField("", 1)).toEqual({ text: "", truncated: false });
    expect(truncateField("", 100)).toEqual({ text: "", truncated: false });
  });

  it("strips trailing whitespace exposed by the cut before appending the ellipsis", () => {
    // "hello     world" sliced to 7 chars is "hello  " (trailing spaces);
    // those must be trimmed before the ellipsis is appended.
    const result = truncateField("hello     world", 8);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("hello…");
    expect(result.text.length).toBeLessThanOrEqual(8);
  });

  it("handles a slice that is entirely whitespace, collapsing to just the ellipsis", () => {
    const result = truncateField("          x", 5);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("…");
    expect(result.text.length).toBeLessThanOrEqual(5);
  });

  it("never splits a surrogate pair at the cut boundary (emoji)", () => {
    // "ab" + U+1F600 (grinning face, a surrogate pair: 😀) + "cd".
    // slice(0, maxChars - 1) with maxChars=4 takes code units [a, b, \uD83D]
    // -- landing exactly on the dangling high surrogate, which must be
    // dropped rather than emitted as a lone surrogate.
    const withEmoji = "ab😀cd";
    const result = truncateField(withEmoji, 4);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("ab…");
    expect(result.text.length).toBeLessThanOrEqual(4);
    // No lone surrogate anywhere in the result.
    for (let i = 0; i < result.text.length; i++) {
      const code = result.text.charCodeAt(i);
      expect(code >= 0xd800 && code <= 0xdbff).toBe(false);
    }
  });

  it("preserves a complete surrogate pair when the cut lands just after it", () => {
    const withEmoji = "ab😀cd";
    const result = truncateField(withEmoji, 5);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("ab😀…");
    expect(result.text.length).toBeLessThanOrEqual(5);
  });

  it("handles maxChars === 1", () => {
    const result = truncateField("hello", 1);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("…");
    expect(result.text.length).toBe(1);
  });

  it("maxChars === 1 with a value already length 1 returns verbatim", () => {
    expect(truncateField("h", 1)).toEqual({ text: "h", truncated: false });
  });

  it("throws a clear Error for maxChars < 1", () => {
    expect(() => truncateField("hello", 0)).toThrow(/maxChars/);
    expect(() => truncateField("hello", -5)).toThrow(/maxChars/);
  });

  it("throws for a non-integer maxChars", () => {
    expect(() => truncateField("hello", 3.5)).toThrow(/maxChars/);
  });

  it("is pure and deterministic across repeated calls", () => {
    const a = truncateField("a long enough string to truncate", 10);
    const b = truncateField("a long enough string to truncate", 10);
    expect(a).toEqual(b);
  });

  it("never returns text longer than maxChars, across many lengths and inputs", () => {
    const samples = [
      "",
      "x",
      "hello world",
      "a".repeat(500),
      "     leading and trailing whitespace     ",
      "mixed 😀 emoji 🎉 content 🔥 here",
      "😀".repeat(50),
      "\t\n  whitespace-only-ish  \t\n",
    ];

    for (const sample of samples) {
      for (let maxChars = 1; maxChars <= 60; maxChars++) {
        const result = truncateField(sample, maxChars);
        expect(result.text.length).toBeLessThanOrEqual(maxChars);
        // truncated flag is consistent with whether the input actually fit.
        expect(result.truncated).toBe(sample.length > maxChars);
      }
    }
  });
});
