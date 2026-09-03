// Normalizing and bounding a user's SEARCH QUERY before it reaches SQL.
//
// WHY THIS LIVES IN core
//
// Nothing here knows what Postgres is, what a route is, or what an entity is.
// It is string handling with two obligations -- bound the input, and neutralize
// the wildcard metacharacters of the operator it will be handed to -- and both
// need to be unit-testable without a database, because they are the load-bearing
// half of the search feature's input safety.
//
// Placed beside `../mail/provider-strings.ts` for the same reason that module
// gives: `packages/core`'s barrel pulls in recurrence and device-auth, which use
// `node:module` and `node:crypto`, so apps/mobile reaches core through deep
// subpaths only. `./search/*` is one of those. Nothing here imports a Node
// builtin.
//
// ===========================================================================
// THE TWO DISTINCT HAZARDS, WHICH ARE OFTEN CONFLATED
// ===========================================================================
//
// 1. SQL INJECTION. Not a hazard here, and not because of anything in this
//    file: every value this repository passes to Drizzle -- through the query
//    builder or through the `sql` tagged template -- is emitted as a `$n`
//    placeholder and bound by `pg`. There is no `sql.raw` anywhere in the
//    repository and this feature adds none. String-building a predicate is
//    what would create the hazard, so this module returns a VALUE to bind,
//    never a fragment of SQL.
//
// 2. WILDCARD INJECTION. A real hazard, and the one this file exists for.
//    A bound parameter is still interpreted as a LIKE/ILIKE PATTERN once it
//    arrives, so a query of `%` is not a search for a percent sign -- it is
//    "match every row", which turns a bounded lookup into a full dump of every
//    searchable table and defeats the result cap's purpose. `_` is the
//    single-character equivalent. Neither is a syntax error, neither is
//    logged, and neither would ever surface as a failure: it would simply
//    return the wrong rows, quietly, forever.
//
// The repository's one pre-existing `like()` call
// (apps/worker/src/jobs/notifications-dispatch.ts) builds its pattern from an
// internal dedupe key, so it never needed escaping and left no helper to reuse.
// This is that helper.

import { stripUnsummarizableCharacters } from "../mail/provider-strings.js";

/**
 * Hard ceiling on the RAW `q` parameter, applied before any normalization.
 *
 * Deliberately larger than SEARCH_QUERY_MAX_CHARS: normalization collapses
 * whitespace, so a legitimate query pasted with ragged spacing may arrive
 * longer than it ends up. This bound exists only so that an absurd querystring
 * is rejected before this module does per-character work on it.
 */
export const SEARCH_QUERY_RAW_MAX_CHARS = 512;

/**
 * Shortest accepted query, AFTER normalization.
 *
 * Two, not one. A single character matches a large fraction of any corpus, so
 * it is not a search -- it is a scan whose result set is decided by the cap
 * rather than by the query, which is exactly the outcome that makes a cap look
 * like a bug. Two is also what makes a whitespace-only or punctuation-only
 * query fail closed with a 400 rather than silently returning the newest N rows
 * of everything.
 */
export const SEARCH_QUERY_MIN_CHARS = 2;

/** Longest accepted query, AFTER normalization. Far beyond any real search. */
export const SEARCH_QUERY_MAX_CHARS = 128;

/**
 * The escape character named in the generated `ILIKE ... ESCAPE` clause.
 *
 * Backslash is also PostgreSQL's default when the clause is omitted, but the
 * clause is emitted explicitly by the read model anyway: this module's
 * correctness then depends on a character the query states, not on a default a
 * future reader would have to know.
 */
export const LIKE_ESCAPE_CHARACTER = "\\";

/**
 * Normalizes a raw query into the form that is validated, matched and echoed.
 *
 * Reuses `stripUnsummarizableCharacters`, which removes C0/C1 controls, bidi
 * overrides and zero-width characters, then collapses whitespace runs and
 * trims. Three consequences worth stating, because each is a behaviour a test
 * pins:
 *
 *   - A whitespace-only query normalizes to "" and therefore fails the minimum
 *     length check. It can never reach SQL.
 *   - A query made only of bidi overrides likewise normalizes to "". A search
 *     box is a poor place to accept characters whose only effect is to reorder
 *     what a reader sees.
 *   - Case is PRESERVED here. Case-insensitivity is the matching operator's
 *     job (ILIKE), not the normalizer's, so the query echoed back to the client
 *     is what the user typed rather than a lowercased version of it.
 */
export function normalizeSearchQuery(raw: string): string {
  return stripUnsummarizableCharacters(raw) ?? "";
}

/**
 * Escapes the three characters that are special inside a LIKE/ILIKE pattern.
 *
 * `\` must be escaped as well as `%` and `_`, and it must be handled in the
 * SAME pass: escaping the backslash first and the wildcards second would
 * re-escape the backslashes the second pass just introduced, turning a search
 * for `50%` into a search for `50\%` literally. One regex with one alternation
 * makes the double-escape unrepresentable rather than merely avoided.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `${LIKE_ESCAPE_CHARACTER}${character}`);
}

/**
 * Builds the bound parameter for a case-insensitive "contains" match.
 *
 * The surrounding `%` are OURS -- added after escaping, so they are the only
 * wildcards in the pattern and the user's own `%` cannot join them.
 */
export function buildContainsPattern(query: string): string {
  return `%${escapeLikePattern(query)}%`;
}
