import { describe, expect, it } from "vitest";
import { extractCitationRefs, extractCitations, validateCitations } from "./citations.js";

describe("extractCitationRefs (Checkpoint 9.7)", () => {
  it("returns an empty list for an answer with no brackets", () => {
    expect(extractCitationRefs("Nothing is due today.")).toEqual([]);
  });

  it("extracts single refs in first-seen order", () => {
    expect(extractCitationRefs("Renew insurance [2] then call the agent [1].")).toEqual([2, 1]);
  });

  it("extracts adjacent groups [1][2], spaced groups [1] [2], a padded group [ 1 ] and a nested [[1]]", () => {
    expect(extractCitations("Two things [1][2].")).toEqual({ refs: [1, 2], invalid: 0 });
    expect(extractCitations("Two things [1] [2].")).toEqual({ refs: [1, 2], invalid: 0 });
    expect(extractCitations("One [ 1 ].")).toEqual({ refs: [1], invalid: 0 });
    expect(extractCitations("One [[1]].")).toEqual({ refs: [1], invalid: 0 });
  });

  it("expands a comma list, with and without spaces", () => {
    expect(extractCitationRefs("See [1, 2] and [3,4].")).toEqual([1, 2, 3, 4]);
  });

  it("treats a whitespace-separated list [1 2] as the refs 1 and 2", () => {
    expect(extractCitations("[1 2]")).toEqual({ refs: [1, 2], invalid: 0 });
  });

  it("expands a hyphen range and an en-dash range", () => {
    expect(extractCitationRefs("All of [1-3].")).toEqual([1, 2, 3]);
    expect(extractCitationRefs("All of [4–6].")).toEqual([4, 5, 6]);
  });

  it("expands a range with whitespace around the dash", () => {
    expect(extractCitations("[1 - 2]")).toEqual({ refs: [1, 2], invalid: 0 });
  });

  it("handles a mixed group of lists and ranges", () => {
    expect(extractCitationRefs("[1, 3-5, 8]")).toEqual([1, 3, 4, 5, 8]);
    expect(extractCitations("[1 3-5 8]")).toEqual({ refs: [1, 3, 4, 5, 8], invalid: 0 });
  });

  it("deduplicates repeated refs", () => {
    expect(extractCitationRefs("[1] and again [1] and [1, 2]")).toEqual([1, 2]);
  });

  it("ignores non-numeric bracket groups, including the sanitizer's own [link removed]", () => {
    expect(extractCitations("Go to [link removed] for details [1].")).toEqual({
      refs: [1],
      invalid: 0,
    });
    expect(extractCitations("[a] [ref 1] [1a] [x-y]")).toEqual({ refs: [], invalid: 0 });
  });

  it("a group of only separators or an empty pair is not a citation", () => {
    expect(extractCitations("[,] [ , ] [-] [] [.]")).toEqual({ refs: [], invalid: 0 });
  });

  describe("malformed numeric groups are COUNTED as invalid, never dropped (9.7 review)", () => {
    it.each([
      ["[1-3-5]", 1],
      ["[-1]", 1],
      ["[1.5]", 1],
      ["[0]", 1],
      ["[3–1]", 1],
      ["[3-1]", 1],
      ["[1-999999]", 1],
      ["[99999999999999999999]", 1],
      ["[1.]", 1],
    ])("%s -> invalid %i, no refs", (answer, invalid) => {
      expect(extractCitations(answer)).toEqual({ refs: [], invalid });
    });

    it.each([
      ["[1,]", { refs: [1], invalid: 1 }],
      ["[,1]", { refs: [1], invalid: 1 }],
      ["[1 -]", { refs: [1], invalid: 1 }],
    ])("%s keeps the real ref and counts the malformed slot", (answer, expected) => {
      expect(extractCitations(answer)).toEqual(expected);
    });

    it("keeps the well-formed refs beside the malformed token in one group", () => {
      expect(extractCitations("[1, 2.5, 3]")).toEqual({ refs: [1, 3], invalid: 1 });
      expect(extractCitations("[2, 0]")).toEqual({ refs: [2], invalid: 1 });
    });

    it("an absurdly wide range never becomes a huge array", () => {
      const { refs } = extractCitations("[1-999999]");
      expect(refs.length).toBeLessThan(10);
    });
  });
});

describe("validateCitations (Checkpoint 9.7)", () => {
  it("resolves every cited ref against the valid set and reports the rest", () => {
    const result = validateCitations("Do [1] and [3], not [7].", new Set([1, 2, 3]));
    expect(result).toEqual({ unresolved: [7], cited: [1, 3] });
  });

  it("an answer with no citations is valid with nothing cited", () => {
    expect(validateCitations("Nothing is due.", new Set([1]))).toEqual({
      unresolved: [],
      cited: [],
    });
  });

  it("a range that overruns the valid set reports the overrun refs", () => {
    expect(validateCitations("[1-4]", new Set([1, 2])).unresolved).toEqual([3, 4]);
  });

  it("ignores [link removed] entirely", () => {
    expect(validateCitations("See [link removed].", new Set([1]))).toEqual({
      unresolved: [],
      cited: [],
    });
  });

  describe("every malformed shape is unresolved (the old parser let these vanish)", () => {
    it.each(["[0]", "[1 2 -]", "[1-3-5]", "[-1]", "[99999999999999999999]", "[1.5]", "[1,]"])(
      "%s is not a clean answer against {1, 2}",
      (answer) => {
        const result = validateCitations(answer, new Set([1, 2]));
        expect(result.unresolved.length).toBeGreaterThan(0);
      },
    );

    it("reports one NaN sentinel per malformed token, beside any real unresolved refs", () => {
      const result = validateCitations("[1] [0] [7]", new Set([1]));
      expect(result.cited).toEqual([1]);
      expect(result.unresolved).toHaveLength(2);
      expect(result.unresolved).toContain(7);
      expect(result.unresolved.some((n) => Number.isNaN(n))).toBe(true);
    });
  });
});
