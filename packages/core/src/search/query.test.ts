import { describe, expect, it } from "vitest";
import {
  LIKE_ESCAPE_CHARACTER,
  SEARCH_QUERY_MAX_CHARS,
  SEARCH_QUERY_MIN_CHARS,
  SEARCH_QUERY_RAW_MAX_CHARS,
  buildContainsPattern,
  escapeLikePattern,
  normalizeSearchQuery,
} from "./query.js";

// Control characters are written as ESCAPE SEQUENCES throughout this file,
// never as literals -- the same rule provider-strings.ts states for itself: a
// file you cannot safely cat, grep or review in a diff is a poor place to keep
// a security control.
const RLO = "\u202E"; // right-to-left override
const ZWSP = "\u200B"; // zero-width space
const LRI = "\u2066"; // left-to-right isolate
const BOM = "\uFEFF";

describe("normalizeSearchQuery", () => {
  it("trims and collapses whitespace runs", () => {
    expect(normalizeSearchQuery("  hello   world  ")).toBe("hello world");
  });

  it("reduces a whitespace-only query to the empty string", () => {
    // The bound that rejects it lives in the schema; what matters here is that
    // nothing survives normalization for the schema to accept.
    expect(normalizeSearchQuery("   ")).toBe("");
    expect(normalizeSearchQuery("\t\n\r ")).toBe("");
  });

  it("reduces a query made only of bidi/zero-width controls to the empty string", () => {
    expect(normalizeSearchQuery(`${RLO}${ZWSP}${LRI}${BOM}`)).toBe("");
  });

  it("strips a bidi override embedded in an otherwise real query", () => {
    expect(normalizeSearchQuery(`rent${RLO}due`)).toBe("rentdue");
  });

  it("turns a newline into a separator rather than welding words together", () => {
    // Deleting the control outright would produce "callmom", a word neither
    // the user nor anyone else typed.
    expect(normalizeSearchQuery("call\nmom")).toBe("call mom");
  });

  it("PRESERVES case -- matching is the operator's job, not the normalizer's", () => {
    expect(normalizeSearchQuery("Insurance")).toBe("Insurance");
  });

  it("preserves the LIKE metacharacters -- escaping is a separate step", () => {
    expect(normalizeSearchQuery("50% _off_")).toBe("50% _off_");
  });
});

describe("escapeLikePattern", () => {
  it("escapes the percent wildcard", () => {
    expect(escapeLikePattern("50%")).toBe("50\\%");
  });

  it("escapes the single-character wildcard", () => {
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
  });

  it("escapes a literal backslash", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("does NOT double-escape: one pass handles backslash and wildcards together", () => {
    // The bug this pins: escaping backslashes first and wildcards second would
    // re-escape the backslash the second pass just introduced.
    expect(escapeLikePattern("%")).toBe("\\%");
    expect(escapeLikePattern("\\%")).toBe("\\\\\\%");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLikePattern("insurance renewal")).toBe("insurance renewal");
  });

  it("leaves other regex-looking characters untouched -- LIKE has only three", () => {
    expect(escapeLikePattern("a.b*c[d]e$f^g")).toBe("a.b*c[d]e$f^g");
  });
});

describe("buildContainsPattern", () => {
  it("wraps the escaped query in wildcards that are OURS", () => {
    expect(buildContainsPattern("rent")).toBe("%rent%");
  });

  it("a query of a bare percent cannot become a match-everything pattern", () => {
    // Without escaping this would be "%%%" -- which matches every row in every
    // searched table, silently, forever.
    expect(buildContainsPattern("%")).toBe("%\\%%");
  });

  it("a query of a bare underscore cannot become a single-character wildcard", () => {
    expect(buildContainsPattern("_")).toBe("%\\_%");
  });

  it("only the two outer characters are unescaped wildcards", () => {
    const pattern = buildContainsPattern("100%_x");
    expect(pattern.startsWith("%")).toBe(true);
    expect(pattern.endsWith("%")).toBe(true);
    expect(pattern.slice(1, -1)).toBe("100\\%\\_x");
  });
});

describe("bounds", () => {
  it("declares a raw ceiling above the normalized ceiling", () => {
    // Normalization collapses whitespace, so a legitimate query can arrive
    // longer than it ends up; the raw bound must not reject those first.
    expect(SEARCH_QUERY_RAW_MAX_CHARS).toBeGreaterThan(SEARCH_QUERY_MAX_CHARS);
  });

  it("declares a minimum above one character", () => {
    expect(SEARCH_QUERY_MIN_CHARS).toBeGreaterThan(1);
  });

  it("names backslash as the escape character, matching escapeLikePattern", () => {
    expect(LIKE_ESCAPE_CHARACTER).toBe("\\");
    expect(escapeLikePattern("%")).toBe(`${LIKE_ESCAPE_CHARACTER}%`);
  });
});
