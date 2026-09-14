import { describe, expect, it } from "vitest";
import {
  SEARCH_MAX_TOKENS,
  SEARCH_TOKEN_MIN_CHARS,
  foldSearchCase,
  textTokenValues,
  tokenizeSearchQuery,
} from "./tokenize.js";
import type { TokenizeOptions } from "./tokenize.js";

const TZ: TokenizeOptions = { tz: "America/Chicago", today: "2026-09-14" };
const NO_TZ: TokenizeOptions = { tz: null, today: null };

function values(normalized: string, options: TokenizeOptions = TZ): string[] {
  return tokenizeSearchQuery(normalized, options).tokens.map((token) => token.value);
}

/** The recognised date window, or a failing assertion when there is none. */
function dateWindow(normalized: string, options: TokenizeOptions = TZ) {
  const token = tokenizeSearchQuery(normalized, options).dateToken;
  if (token === null || token.kind !== "date") throw new Error(`no date token in "${normalized}"`);
  return token.window;
}

describe("constants", () => {
  it("are the contract's numbers", () => {
    expect(SEARCH_MAX_TOKENS).toBe(8);
    expect(SEARCH_TOKEN_MIN_CHARS).toBe(2);
  });
});

describe("tokenizeSearchQuery -- text rules", () => {
  it("splits on whitespace and lowercases", () => {
    const query = tokenizeSearchQuery("Pay Rent", NO_TZ);
    expect(query.tokens).toEqual([
      { kind: "text", value: "pay" },
      { kind: "text", value: "rent" },
    ]);
    expect(query.phrase).toBe("pay rent");
    expect(query.dropped).toEqual([]);
    expect(query.dateToken).toBeNull();
  });

  it("applies NFKC before lowercasing", () => {
    // Full-width Latin and a compatibility ligature both fold to plain ASCII.
    expect(values("Ｒｅｎｔ ﬁle")).toEqual(["rent", "file"]);
    // Full-width digits become ASCII digits.
    expect(values("５０ units")).toEqual(["50", "units"]);
  });

  it("keeps diacritics -- NFKC is not a diacritic stripper", () => {
    expect(values("café résumé")).toEqual(["café", "résumé"]);
    expect(values("ÉCOLE")).toEqual(["école"]);
  });

  it("splits a word on punctuation and symbols", () => {
    expect(values("don't")).toEqual(["don"]);
    expect(values("rent,due")).toEqual(["rent", "due"]);
    expect(values("foo/bar-baz")).toEqual(["foo", "bar", "baz"]);
    expect(values("a_b")).toEqual([]);
    expect(values("hello_world")).toEqual(["hello", "world"]);
  });

  it("keeps the digits of '50%' and drops the symbol", () => {
    expect(values("50%")).toEqual(["50"]);
    expect(values("$100")).toEqual(["100"]);
  });

  it("drops fragments under the minimum unless all-digit or CJK", () => {
    expect(values("a b c")).toEqual([]);
    expect(values("x ab")).toEqual(["ab"]);
    expect(values("5")).toEqual(["5"]);
    expect(values("1 2 3")).toEqual(["1", "2", "3"]);
    expect(values("水")).toEqual(["水"]);
    expect(values("水 を 飲む")).toEqual(["水", "を", "飲む"]);
    expect(values("한")).toEqual(["한"]);
    expect(values("ア")).toEqual(["ア"]);
  });

  it("does not treat a single Latin letter or a lone diacritic as a token", () => {
    expect(values("é")).toEqual([]);
    expect(values("i")).toEqual([]);
  });

  it("yields nothing for emoji-only or all-punctuation input", () => {
    expect(tokenizeSearchQuery("🎉🎉", NO_TZ)).toEqual({
      tokens: [],
      phrase: "",
      fullPhrase: "",
      dropped: [],
      dateToken: null,
    });
    expect(values("!!!")).toEqual([]);
    expect(values("--- ***")).toEqual([]);
    expect(values("rent 🎉")).toEqual(["rent"]);
  });

  it("treats a hyphenated non-date as separate words", () => {
    expect(values("2026-09")).toEqual(["2026-09"]); // a date, because TZ is set
    expect(values("2026-09", NO_TZ)).toEqual(["2026", "09"]);
    expect(values("well-known", NO_TZ)).toEqual(["well", "known"]);
  });

  it("dedupes on value, keeping first position", () => {
    expect(values("rent Rent RENT due rent")).toEqual(["rent", "due"]);
    expect(values("50% 50")).toEqual(["50"]);
  });

  it("has no stopword list", () => {
    expect(values("the and for")).toEqual(["the", "and", "for"]);
  });

  it("caps at SEARCH_MAX_TOKENS and reports the overflow in order", () => {
    const query = tokenizeSearchQuery("t1 t2 t3 t4 t5 t6 t7 t8 t9 t10 t11", NO_TZ);
    expect(query.tokens).toHaveLength(SEARCH_MAX_TOKENS);
    expect(query.tokens.map((t) => t.value)).toEqual([
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
      "t7",
      "t8",
    ]);
    expect(query.dropped).toEqual(["t9", "t10", "t11"]);
    expect(query.phrase).toBe("t1 t2 t3 t4 t5 t6 t7 t8");
  });

  it("does not report a deduped repeat as dropped, and does not count it against the cap", () => {
    const query = tokenizeSearchQuery("t1 t1 t2 t3 t4 t5 t6 t7 t8", NO_TZ);
    expect(query.tokens).toHaveLength(8);
    expect(query.dropped).toEqual([]);
  });

  it("dedupe applies to overflow too -- a repeated dropped word appears once", () => {
    const query = tokenizeSearchQuery("t1 t2 t3 t4 t5 t6 t7 t8 t9 t9", NO_TZ);
    expect(query.dropped).toEqual(["t9"]);
  });

  it("returns an empty query for an empty string", () => {
    expect(tokenizeSearchQuery("", NO_TZ).tokens).toEqual([]);
  });

  it("textTokenValues returns exactly the text tokens in order", () => {
    const query = tokenizeSearchQuery("rent september due", TZ);
    expect(textTokenValues(query)).toEqual(["rent", "due"]);
    expect(query.phrase).toBe("rent due");
  });

  it("folds U+0130 to a plain 'i' the way Postgres ILIKE does, composed or decomposed", () => {
    // JS alone lowercases İ to "i" + U+0307 (two code points); ILIKE folds it
    // to "i". A row ILIKE found for "istanbul" must score in the same string.
    expect(foldSearchCase("\u0130stanbul")).toBe("istanbul");
    expect(foldSearchCase("I\u0307stanbul")).toBe("istanbul");
    expect(values("\u0130stanbul trip", NO_TZ)).toEqual(["istanbul", "trip"]);
    // Ordinary case folding and diacritics are untouched by the extra step.
    expect(foldSearchCase("Café ÉCOLE")).toBe("café école");
  });

  it("keeps an ISO-shaped word that is not a real date whole, with or without a timezone", () => {
    for (const options of [TZ, NO_TZ]) {
      expect(values("2026-02-30", options)).toEqual(["2026-02-30"]);
      expect(values("2026-13", options)).toEqual(["2026-13"]);
      expect(values("rent 2026-02-30, due", options)).toEqual(["rent", "2026-02-30", "due"]);
      expect(tokenizeSearchQuery("2026-02-30", options).dateToken).toBeNull();
      expect(tokenizeSearchQuery("2026-02-30", options).tokens[0]?.kind).toBe("text");
    }
    // A REAL date is still the date token under a timezone, never a whole text word.
    expect(tokenizeSearchQuery("2026-02-28", TZ).dateToken?.value).toBe("2026-02-28");
  });
});

describe("tokenizeSearchQuery -- fullPhrase", () => {
  it("equals phrase when there is no date token", () => {
    const query = tokenizeSearchQuery("pay rent", NO_TZ);
    expect(query.fullPhrase).toBe("pay rent");
    expect(query.fullPhrase).toBe(query.phrase);
    expect(tokenizeSearchQuery("", NO_TZ).fullPhrase).toBe("");
  });

  it("carries the date word in query position while phrase omits it", () => {
    const query = tokenizeSearchQuery("may report", TZ);
    expect(query.dateToken?.value).toBe("may");
    expect(query.phrase).toBe("report");
    expect(query.fullPhrase).toBe("may report");
    expect(tokenizeSearchQuery("rent due october", TZ).fullPhrase).toBe("rent due october");
  });

  it("uses the consumed '<month> <year>' pair as the date token's words", () => {
    const query = tokenizeSearchQuery("budget september 2026 review", TZ);
    expect(query.phrase).toBe("budget review");
    expect(query.fullPhrase).toBe("budget september 2026 review");
  });

  it("is a date-only query's date word alone, with an empty phrase", () => {
    const query = tokenizeSearchQuery("october", TZ);
    expect(query.phrase).toBe("");
    expect(query.fullPhrase).toBe("october");
  });

  it("excludes dropped tokens, like phrase does", () => {
    const query = tokenizeSearchQuery("t1 t2 t3 t4 t5 t6 t7 t8 t9", NO_TZ);
    expect(query.dropped).toEqual(["t9"]);
    expect(query.fullPhrase).toBe("t1 t2 t3 t4 t5 t6 t7 t8");
  });
});

describe("tokenizeSearchQuery -- date grammar", () => {
  it("recognises no date without a timezone", () => {
    const query = tokenizeSearchQuery("rent 2026-10-01", NO_TZ);
    expect(query.dateToken).toBeNull();
    expect(query.tokens.map((t) => t.value)).toEqual(["rent", "2026", "10", "01"]);
    expect(tokenizeSearchQuery("today", NO_TZ).tokens).toEqual([{ kind: "text", value: "today" }]);
    expect(tokenizeSearchQuery("today", { tz: "", today: "2026-09-14" }).dateToken).toBeNull();
  });

  it("recognises a date word as ONE token with its window, in query position", () => {
    const query = tokenizeSearchQuery("rent 2026-10-01 due", TZ);
    expect(query.tokens).toEqual([
      { kind: "text", value: "rent" },
      {
        kind: "date",
        value: "2026-10-01",
        window: { token: "2026-10-01", kind: "iso_date", from: "2026-10-01", to: "2026-10-01" },
      },
      { kind: "text", value: "due" },
    ]);
    expect(query.dateToken).toBe(query.tokens[1]);
    expect(query.phrase).toBe("rent due");
  });

  it("checks the whole word BEFORE splitting, so an ISO date is never three numbers", () => {
    expect(values("2026-10-01")).toEqual(["2026-10-01"]);
    expect(values("2026-10")).toEqual(["2026-10"]);
  });

  it("ignores enclosing punctuation on the date word", () => {
    const query = tokenizeSearchQuery("dentist (september).", TZ);
    expect(query.dateToken?.value).toBe("september");
    expect(query.tokens.map((t) => t.value)).toEqual(["dentist", "september"]);
    expect(tokenizeSearchQuery("due 2026-10-01,", TZ).dateToken?.value).toBe("2026-10-01");
  });

  it("consumes a following year into a month token and never re-reads it", () => {
    const query = tokenizeSearchQuery("rent september 2025 late", TZ);
    expect(query.tokens).toEqual([
      { kind: "text", value: "rent" },
      {
        kind: "date",
        value: "september 2025",
        window: { token: "september 2025", kind: "month", from: "2025-09-01", to: "2025-09-30" },
      },
      { kind: "text", value: "late" },
    ]);
    expect(query.phrase).toBe("rent late");
  });

  it("consumes a following year even when that year carries trailing punctuation", () => {
    const query = tokenizeSearchQuery("september 2025,", TZ);
    expect(query.dateToken?.value).toBe("september 2025");
    expect(query.tokens).toHaveLength(1);
  });

  it("uses today's year for a bare month and today for the relative words", () => {
    expect(tokenizeSearchQuery("october", TZ).dateToken).toEqual({
      kind: "date",
      value: "october",
      window: { token: "october", kind: "month", from: "2026-10-01", to: "2026-10-31" },
    });
    expect(dateWindow("tomorrow").from).toBe("2026-09-15");
  });

  it("with a tz but no today, the clock-dependent forms are plain text and the ISO forms still parse", () => {
    const options = { tz: "America/Chicago", today: null };
    expect(tokenizeSearchQuery("tomorrow", options).tokens).toEqual([
      { kind: "text", value: "tomorrow" },
    ]);
    expect(tokenizeSearchQuery("september", options).dateToken).toBeNull();
    expect(tokenizeSearchQuery("2026-10-01", options).dateToken?.kind).toBe("date");
    expect(dateWindow("2026", options).kind).toBe("year");
  });

  it("recognises at most one date -- the first wins and later date words are text", () => {
    const query = tokenizeSearchQuery("today tomorrow 2026-10-01", TZ);
    expect(query.dateToken?.value).toBe("today");
    expect(query.tokens.map((t) => [t.kind, t.value])).toEqual([
      ["date", "today"],
      ["text", "tomorrow"],
      ["text", "2026"],
      ["text", "10"],
      ["text", "01"],
    ]);
  });

  it("a bare year is a date token, and a second year is plain text", () => {
    const query = tokenizeSearchQuery("taxes 2025 2026", TZ);
    expect(dateWindow("taxes 2025 2026").kind).toBe("year");
    expect(query.tokens.map((t) => [t.kind, t.value])).toEqual([
      ["text", "taxes"],
      ["date", "2025"],
      ["text", "2026"],
    ]);
  });

  it("a date word that arrives after the cap is dropped, and the grammar is still spent", () => {
    const query = tokenizeSearchQuery("t1 t2 t3 t4 t5 t6 t7 t8 september 2025 t9", TZ);
    expect(query.tokens).toHaveLength(8);
    expect(query.dateToken).toBeNull();
    // The consumed year is part of the dropped date token, not a bare-year
    // token of its own; t9 follows it in the overflow.
    expect(query.dropped).toEqual(["september 2025", "t9"]);
  });

  it("a date token counts toward the cap", () => {
    const query = tokenizeSearchQuery("today t1 t2 t3 t4 t5 t6 t7 t8", TZ);
    expect(query.tokens).toHaveLength(8);
    expect(query.dateToken?.value).toBe("today");
    expect(query.dropped).toEqual(["t8"]);
  });

  it("dedupes a date token against an identical earlier text token", () => {
    // "2026" is text here only because it is the second date word.
    const query = tokenizeSearchQuery("today 2026 2026", TZ);
    expect(query.tokens.map((t) => t.value)).toEqual(["today", "2026"]);
  });

  it("'may' is a month -- the contract lists month names without exception", () => {
    expect(dateWindow("may rent").kind).toBe("month");
  });

  it("lowercases the date token value under NFKC", () => {
    expect(tokenizeSearchQuery("SEPTEMBER", TZ).dateToken?.value).toBe("september");
    expect(tokenizeSearchQuery("２０２６", TZ).dateToken?.value).toBe("2026");
  });
});
