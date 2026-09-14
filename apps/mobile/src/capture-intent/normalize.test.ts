import { CAPTURE_TEXT_MAX_LENGTH } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { normalizeSharedText } from "./normalize";

// Control characters are built with fromCharCode rather than written as
// literals so this test file contains none itself.
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const VT = String.fromCharCode(11);
const ESC = String.fromCharCode(27);
const DEL = String.fromCharCode(127);
const C1 = String.fromCharCode(0x9b);

// Checkpoint 8.4 Lane 1. Shared text is the first capture input the owner did
// not type, so these pin the bound and the inertness, not just the happy path.
describe("normalizeSharedText", () => {
  it("passes ordinary text through unchanged", () => {
    expect(normalizeSharedText("Buy milk on the way home")).toBe("Buy milk on the way home");
  });

  it("preserves multiline structure, tabs and unicode", () => {
    expect(normalizeSharedText("line one\nline two\tcol")).toBe("line one\nline two\tcol");
    expect(normalizeSharedText("Caf\u00e9 coffee \u65e5\u672c\u8a9e")).toBe(
      "Caf\u00e9 coffee \u65e5\u672c\u8a9e",
    );
  });

  it("strips control characters but keeps tab and newline", () => {
    expect(normalizeSharedText("a" + NUL + "b" + BEL + "c" + VT + "d" + ESC + "e")).toBe("abcde");
    expect(normalizeSharedText("f" + DEL + "g" + C1 + "h")).toBe("fgh");
    expect(normalizeSharedText("keep\tthis\nplease")).toBe("keep\tthis\nplease");
  });

  it("strips control characters BEFORE truncating, so they cannot eat the budget", () => {
    // An adversarial share padded with invisible codepoints: if truncation ran
    // first, almost none of the visible payload would survive.
    const padding = NUL.repeat(CAPTURE_TEXT_MAX_LENGTH);
    expect(normalizeSharedText(padding + "the actual note")).toBe("the actual note");
  });

  it("bounds text to exactly the limit the server enforces", () => {
    const out = normalizeSharedText("x".repeat(CAPTURE_TEXT_MAX_LENGTH + 5000));
    expect(out).toHaveLength(CAPTURE_TEXT_MAX_LENGTH);
  });

  it("never leaves a lone surrogate when an astral character straddles the bound", () => {
    // U+1F600 is two UTF-16 code units. Placed so its high surrogate sits at
    // index CAPTURE_TEXT_MAX_LENGTH - 1, a naive slice keeps the high half and
    // drops the low one -- invalid UTF-8, which Postgres rejects.
    const emoji = "\u{1F600}";
    const out = normalizeSharedText("a".repeat(CAPTURE_TEXT_MAX_LENGTH - 1) + emoji + "tail");
    expect(out).toHaveLength(CAPTURE_TEXT_MAX_LENGTH - 1);
    expect(out.endsWith("a")).toBe(true);
    for (const unit of out) {
      const code = unit.charCodeAt(0);
      expect(code >= 0xd800 && code <= 0xdfff, "lone surrogate").toBe(false);
    }
    // The same emoji fully inside the bound survives intact.
    const inside = normalizeSharedText("a".repeat(CAPTURE_TEXT_MAX_LENGTH - 2) + emoji + "tail");
    expect(inside.endsWith(emoji)).toBe(true);
    expect(inside).toHaveLength(CAPTURE_TEXT_MAX_LENGTH);
  });

  it("accepts text of exactly the limit without truncating", () => {
    expect(normalizeSharedText("y".repeat(CAPTURE_TEXT_MAX_LENGTH))).toHaveLength(
      CAPTURE_TEXT_MAX_LENGTH,
    );
  });

  it("returns empty for whitespace-only and control-only shares", () => {
    expect(normalizeSharedText("   \n\t  ")).toBe("");
    expect(normalizeSharedText(NUL + BEL + DEL)).toBe("");
    expect(normalizeSharedText("")).toBe("");
  });

  it("leaves URL-shaped and markup-shaped text as INERT text, never interpreting it", () => {
    // The renderer keeps this inert (React Native <Text> interprets no markup
    // and this app sets no dataDetectorTypes); normalize must not "helpfully"
    // rewrite or strip it either -- a shared link is legitimate capture text.
    const url = "https://example.com/a?b=c#d";
    expect(normalizeSharedText(url)).toBe(url);
    const markup = "<script>alert(1)</script> **bold** [x](y)";
    expect(normalizeSharedText(markup)).toBe(markup);
  });
});
