// Cloud Ask -- citation extraction and validation (Checkpoint 9.7, ADR-066).
//
// The model is asked to cite every item it mentions as `[n]`, where `n` is an
// ordinal the server assigned (Today refs first, then <records>). This module
// reads every bracket group back out of the answer and checks each integer
// against the set of refs the prompt actually contained. A ref that resolves
// to nothing means the model referred to something it was never given -- the
// route discards the answer (`502 ask_uncited`) rather than returning a claim
// nobody can open.
//
// WHAT THIS PROVES AND WHAT IT DOES NOT: an unresolved ref is caught; a
// resolved ref proves only that the item exists in the context, never that the
// claim made about it is true. Ranking claims ("your only P1") are checked by
// the user against the server-authored section label on the source row, not
// by this parser. Stated in the design (§12), not hidden here.
//
// MALFORMED NUMERIC GROUPS SURFACE, THEY DO NOT VANISH (9.7 review). A group
// that is numeric-shaped but not a well-formed citation -- `[1 2]`, `[1-3-5]`,
// `[-1]`, `[1.5]`, `[1,]`, `[0]`, an integer past Number.MAX_SAFE_INTEGER --
// is the model writing a citation it cannot have been given, and is counted
// as `invalid` so `validateCitations` reports it as unresolved. Only a group
// with NO digit at all (`[link removed]`, `[a]`, `[x-y]`) is ignored: that is
// prose or the sanitizer's own marker, never an attempted citation.

/** A bracket group whose contents are only digits, commas, whitespace, dots and range dashes. */
const CITATION_GROUP = /\[([\d,\s\-–.]+)\]/g;
/** One range within a group: `1-3` or `1–3` (hyphen or en dash), whitespace-tolerant. */
const RANGE = /^(\d+)\s*[-–]\s*(\d+)$/;
/** A bare ordinal. */
const ORDINAL = /^\d+$/;
/**
 * Upper bound on how many refs a single range may expand to. The prompt never
 * carries more than ~100 refs, so a range like `[1-999999]` is model noise,
 * not a citation, and must not become a million-element array.
 */
const MAX_RANGE_SPAN = 200;

export interface ExtractedCitations {
  /** Well-formed refs (≥ 1, safe integers) in first-seen order, deduplicated. */
  refs: number[];
  /**
   * Count of numeric-shaped tokens that are NOT a well-formed citation: a
   * backwards or over-wide range, `0`, a decimal, a dash-only token, a token
   * with a stray sign, an unsafe integer. Non-zero means the answer contains a
   * citation that cannot resolve to anything the prompt carried.
   */
  invalid: number;
}

/** Parses the text as a safe positive integer, or null. */
function parseOrdinal(token: string): number | null {
  if (!ORDINAL.test(token)) return null;
  const n = Number(token);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return n;
}

/**
 * Extracts every citation from `answer`. Well-formed refs are returned in
 * first-seen order, deduplicated; ranges (`[1-3]` -> 1, 2, 3) and lists
 * (`[1, 2]`, `[1,2]`) are expanded. Every numeric-shaped token that is not a
 * well-formed citation is counted in `invalid` rather than dropped -- a
 * backwards range (`[3-1]`), a range wider than `MAX_RANGE_SPAN`, `[0]`, a
 * decimal, a lone dash inside a numeric group, a trailing comma. A group
 * containing no digit at all (`[link removed]`) is not a citation and is ignored.
 */
export function extractCitations(answer: string): ExtractedCitations {
  const seen = new Set<number>();
  const refs: number[] = [];
  let invalid = 0;
  const add = (n: number): void => {
    if (seen.has(n)) return;
    seen.add(n);
    refs.push(n);
  };

  for (const match of answer.matchAll(CITATION_GROUP)) {
    const group = match[1] ?? "";
    if (!/\d/.test(group)) continue; // separators only: `[,]`, `[ - ]` -- not a citation
    // Comma slots first (so `[1 - 2]` keeps its internal whitespace as one
    // range), then whitespace within a slot (`[1 2]` is the list 1, 2).
    for (const commaPart of group.split(",")) {
      const token = commaPart.trim();
      if (token.length === 0) {
        // `[1,]` / `[,1]`: an empty slot beside a comma is a malformed list.
        invalid += 1;
        continue;
      }
      // A whole comma-slot may be a whitespace-tolerant range (`1 - 2`);
      // otherwise each whitespace-separated piece is a tight range (`2-3`)
      // or an ordinal, and anything else is a malformed citation.
      const pieces = RANGE.test(token) ? [token] : token.split(/\s+/);
      for (const piece of pieces) {
        const range = RANGE.exec(piece);
        if (range !== null) {
          const start = parseOrdinal(range[1]!);
          const end = parseOrdinal(range[2]!);
          if (start !== null && end !== null && end >= start && end - start <= MAX_RANGE_SPAN) {
            for (let n = start; n <= end; n++) add(n);
          } else {
            invalid += 1;
          }
          continue;
        }
        const ordinal = parseOrdinal(piece);
        if (ordinal === null) invalid += 1;
        else add(ordinal);
      }
    }
  }
  return { refs, invalid };
}

/** The well-formed refs only (see `extractCitations`). */
export function extractCitationRefs(answer: string): number[] {
  return extractCitations(answer).refs;
}

export interface CitationValidation {
  /**
   * Refs cited that are NOT in `validRefs`, plus one `NaN` sentinel per
   * malformed numeric group token -- non-empty means the answer must be
   * discarded. `NaN` is chosen because it can never equal a real ref.
   */
  unresolved: number[];
  /** Refs cited that resolve, in first-seen order. */
  cited: number[];
}

/** Checks every cited ref against the refs the prompt actually contained. */
export function validateCitations(answer: string, validRefs: Set<number>): CitationValidation {
  const { refs, invalid } = extractCitations(answer);
  const unresolved: number[] = [];
  const cited: number[] = [];
  for (const ref of refs) {
    if (validRefs.has(ref)) cited.push(ref);
    else unresolved.push(ref);
  }
  for (let i = 0; i < invalid; i++) unresolved.push(Number.NaN);
  return { unresolved, cited };
}
