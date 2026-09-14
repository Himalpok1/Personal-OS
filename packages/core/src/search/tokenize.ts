// Turning a NORMALIZED search query into the tokens the matching ladder runs
// (Checkpoint 9.6, ADR-065).
//
// Checkpoint 8.3 matched the whole query as one ILIKE substring, so "rent
// october" found nothing unless a row literally contained those two words in
// that order. 9.6 matches per token: rung 1 ANDs every token, rung 3 ORs them
// when nothing matched. This module decides what a token IS; the SQL that
// matches it (apps/api) and the scorer that ranks it (./score.ts) both take
// its output and never re-split.
//
// Pure, like ./query.ts beside it: no Node builtin, because `./search/*` is
// one of the deep subpaths the Expo bundle may reach, and the client will one
// day want to render the same tokens the server matched. Escaping for
// ILIKE is NOT done here -- the api calls `buildContainsPattern` per token
// value, so that the one escaping pass in ./query.ts stays the only one.
//
// ===========================================================================
// THE RULES, IN ORDER
// ===========================================================================
//
//   1. Split the normalized query on whitespace (the normalizer already
//      collapsed runs and trimmed).
//   2. Per word: NFKC, then toLowerCase (`foldSearchCase`). NFKC folds
//      full-width digits and compatibility forms so "２０２６" and "ﬁle" match
//      what the row stores after the SAME normalization in the scorer; ILIKE
//      handles case in SQL but the scorer compares strings, so the case fold
//      happens here once. One letter is folded by hand first: U+0130 (İ,
//      capital I with dot) lowercases in JS to "i" + U+0307, two code points,
//      while Postgres's ILIKE folds it to a plain "i" -- so a row ILIKE found
//      for "istanbul" would never score a title hit. The scorer folds stored
//      text through the same function.
//   3. Date grammar on the WHOLE word first (./date-tokens.ts), only when a
//      timezone was supplied, and at most once per query -- the first date
//      word wins. A "<month> <year>" pair consumes the following word. The
//      word is tried with its enclosing punctuation removed ("2026-09-14."
//      is still that date), never split, so "2026-09-14" cannot become the
//      three numbers 2026, 09 and 14. A word SHAPED like an ISO date or
//      month that is not a real one ("2026-02-30", "2026-13") is kept whole
//      as one TEXT token, with or without a timezone: it is a literal the
//      user typed, and splitting it into 2026, 02 and 30 would AND three
//      numbers the user never searched for.
//   4. Otherwise split the word on /[\p{P}\p{S}\p{Z}\p{C}]+/u -- punctuation,
//      symbols, separators, controls -- so "don't" yields "don" and "t",
//      "50%" yields "50", and an emoji-only word yields nothing.
//   5. Drop a fragment shorter than SEARCH_TOKEN_MIN_CHARS unless it is all
//      digits ("5" is a real search) or contains a Han, Hiragana, Katakana or
//      Hangul character (one CJK character is a word). No stopword list: a
//      stopword in a search box is a word the user typed on purpose.
//   6. Dedupe on value, keeping first position.
//   7. Cap at SEARCH_MAX_TOKENS. Overflow values -- date or text -- go to
//      `dropped`, which the response echoes (`SearchResponse.dropped`, query
//      tokens only, never stored text), so the user is told what was ignored
//      rather than silently matching a shorter query than the one typed.
//
// Zero surviving tokens is the "none" match mode: the caller runs no SQL.
//
// Two phrases come out. `phrase` is the TEXT tokens joined -- what the
// matching SQL and the per-token codes work from. `fullPhrase` is EVERY
// token in query order, the date token contributing the word(s) it was
// recognised from ("may", "september 2026"), so that a title which literally
// reads "May report" can still be an exact match for the query "may report"
// when "may" was taken as a month. Without it that title could never earn
// the top of the ladder and a title reading just "Report" outranked it.

import type { DateWindowSpec } from "./date-tokens.js";
import { parseDateToken } from "./date-tokens.js";

/** Most tokens one query may carry; the rest are reported in `dropped`. */
export const SEARCH_MAX_TOKENS = 8;

/** Shortest text fragment kept, unless all-digit or CJK. Matches SEARCH_QUERY_MIN_CHARS' reasoning. */
export const SEARCH_TOKEN_MIN_CHARS = 2;

export type SearchToken =
  { kind: "text"; value: string } | { kind: "date"; value: string; window: DateWindowSpec };

export interface TokenizedQuery {
  /** Every surviving token in query order; the date token, if any, is among them. */
  tokens: SearchToken[];
  /** Text token values joined by a single space -- what the per-token codes and SQL work from. */
  phrase: string;
  /**
   * ALL token values -- text and the date token's own word(s) -- in query
   * order, joined by a single space. Equal to `phrase` when there is no date
   * token. The title ladder tries both.
   */
  fullPhrase: string;
  /** Values that survived the rules but not the cap, in query order. */
  dropped: string[];
  /** The one date token, also present in `tokens`; null when none was recognised. */
  dateToken: SearchToken | null;
}

export interface TokenizeOptions {
  /** The client's IANA zone, or null. Without it no word is a date. */
  tz: string | null;
  /** The client's current LOCAL date, `YYYY-MM-DD`, or null. Needed by the relative and bare-month forms. */
  today: string | null;
}

const FRAGMENT_SPLIT = /[\p{P}\p{S}\p{Z}\p{C}]+/u;
/** `YYYY-MM` or `YYYY-MM-DD` by shape alone; whether it is a real date is date-tokens' call. */
const ISO_SHAPE = /^\d{4}-\d{2}(-\d{2})?$/;
const ALL_DIGITS = /^\p{Nd}+$/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const EDGE_PUNCTUATION = /^\p{P}+|\p{P}+$/gu;

/**
 * The ONE case fold search applies, to query words here and to stored text in
 * the scorer: NFKC, then U+0130 to a plain "i", then toLowerCase. NFKC runs
 * first so a decomposed "I" + U+0307 composes to U+0130 before the fold sees
 * it. Diacritics are kept -- NFKC is not a diacritic stripper.
 */
export function foldSearchCase(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\u0130/g, "i")
    .toLowerCase();
}

/** True for a word shaped like an ISO date or month that date-tokens refuses (not a real date). */
function isIsoShapedNonDate(candidate: string): boolean {
  return ISO_SHAPE.test(candidate) && parseDateToken(candidate, null, "") === null;
}

function isKeepableFragment(fragment: string): boolean {
  if (fragment.length >= SEARCH_TOKEN_MIN_CHARS) return true;
  return ALL_DIGITS.test(fragment) || CJK.test(fragment);
}

/** The text token values, in order -- what the api escapes into ILIKE patterns. */
export function textTokenValues(query: TokenizedQuery): string[] {
  const values: string[] = [];
  for (const token of query.tokens) {
    if (token.kind === "text") values.push(token.value);
  }
  return values;
}

export function tokenizeSearchQuery(normalized: string, options: TokenizeOptions): TokenizedQuery {
  const words = normalized
    .split(/\s+/)
    .map(foldSearchCase)
    .filter((word) => word.length > 0);

  const dateGrammarEnabled = options.tz !== null && options.tz !== "";
  // A missing `today` disables only the forms that need a clock; the ISO and
  // bare-year forms still parse. date-tokens.ts treats an invalid string the
  // same way, so the sentinel here can be anything that is not a date.
  const today = options.today ?? "";

  const tokens: SearchToken[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  let dateToken: SearchToken | null = null;
  // Set the moment a word is RECOGNISED as a date, whether or not it fits
  // under the cap: the grammar runs at most once per query, and a consumed
  // year must not be re-read as a bare-year token.
  let dateGrammarSpent = false;

  const admit = (token: SearchToken): void => {
    if (seen.has(token.value)) return;
    seen.add(token.value);
    if (tokens.length >= SEARCH_MAX_TOKENS) {
      dropped.push(token.value);
      return;
    }
    tokens.push(token);
    if (token.kind === "date") dateToken = token;
  };

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;

    if (dateGrammarEnabled && !dateGrammarSpent) {
      const candidate = word.replace(EDGE_PUNCTUATION, "");
      const nextRaw = index + 1 < words.length ? (words[index + 1] as string) : null;
      const next = nextRaw === null ? null : nextRaw.replace(EDGE_PUNCTUATION, "");
      const parsed =
        candidate === "" ? null : parseDateToken(candidate, next === "" ? null : next, today);
      if (parsed !== null) {
        dateGrammarSpent = true;
        const { consumedNext, ...window } = parsed;
        admit({ kind: "date", value: window.token, window });
        if (consumedNext) index += 1;
        continue;
      }
    }

    // Checked on the punctuation-stripped word so "2026-02-30," is treated
    // like "2026-02-30". Runs whether or not the date grammar was tried: an
    // impossible date is a literal in every case.
    const stripped = word.replace(EDGE_PUNCTUATION, "");
    if (isIsoShapedNonDate(stripped)) {
      admit({ kind: "text", value: stripped });
      continue;
    }

    for (const fragment of word.split(FRAGMENT_SPLIT)) {
      if (fragment === "" || !isKeepableFragment(fragment)) continue;
      admit({ kind: "text", value: fragment });
    }
  }

  const query: TokenizedQuery = { tokens, phrase: "", fullPhrase: "", dropped, dateToken };
  query.phrase = textTokenValues(query).join(" ");
  query.fullPhrase = tokens.map((token) => token.value).join(" ");
  return query;
}
