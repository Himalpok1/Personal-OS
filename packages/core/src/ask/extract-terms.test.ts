import { describe, expect, it } from "vitest";
import { ASK_MAX_TERMS, ASK_TERM_MIN_CHARS, extractAskTerms } from "./extract-terms.js";

describe("extractAskTerms", () => {
  it("lowercases, splits on punctuation, and drops stopwords", () => {
    expect(extractAskTerms("What did I say about the insurance renewal?")).toEqual([
      "say",
      "insurance",
      "renewal",
    ]);
  });

  it("drops terms shorter than the minimum", () => {
    expect(ASK_TERM_MIN_CHARS).toBe(3);
    // "re" and "up" are exactly the 2-char survivors the design review found
    // matching most of a corpus.
    expect(extractAskTerms("re up ok go rent")).toEqual(["rent"]);
  });

  it("deduplicates, keeping first occurrence order", () => {
    expect(extractAskTerms("renew renew the renewal renew")).toEqual(["renew", "renewal"]);
  });

  it("caps at the maximum term count", () => {
    const question = Array.from({ length: 20 }, (_, i) => `term${i}`).join(" ");
    const terms = extractAskTerms(question);
    expect(terms).toHaveLength(ASK_MAX_TERMS);
    expect(terms).toEqual(["term0", "term1", "term2", "term3", "term4", "term5", "term6", "term7"]);
  });

  it("returns an empty array for an empty, punctuation-only, or all-stopword question", () => {
    expect(extractAskTerms("")).toEqual([]);
    expect(extractAskTerms("   ")).toEqual([]);
    expect(extractAskTerms("???...!!!")).toEqual([]);
    expect(extractAskTerms("the and for with")).toEqual([]);
  });

  it("returns an empty array for a wildcard-shaped question -- no term to over-match on", () => {
    // Not a SQL/LIKE hazard by itself (this module never builds SQL), but the
    // caller relies on "no terms -> no query at all" as the same fail-closed
    // shape ADR-059 established for /search.
    expect(extractAskTerms("%")).toEqual([]);
    expect(extractAskTerms("%%")).toEqual([]);
  });

  it("strips control and bidi-override characters before splitting", () => {
    const terms = extractAskTerms("rent‮reminder due");
    expect(terms.join(" ")).not.toContain("‮");
  });
});
