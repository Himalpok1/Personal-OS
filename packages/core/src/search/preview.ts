// Bounding the TEXT A SEARCH RESULT CARRIES, before it reaches the wire.
//
// ===========================================================================
// WHY THIS IS NOT `../ai/output-safety.ts`, AND MUST NOT CALL IT
// ===========================================================================
//
// `sanitizeModelText` removes link-shaped content from a MODEL'S OUTPUT. That
// is right there and wrong here, and the distinction is the whole reason this
// module exists separately rather than reusing it.
//
// A search result is the user's OWN STORED TEXT, quoted back to them because
// they asked for it by name. If a note they wrote says "renew at
// https://example.com/billing", a search that renders "renew at [link removed]"
// has not protected them from anything -- it has lied about the contents of
// their own note, in the one feature whose entire purpose is finding what they
// stored. The laundering threat ADR-054 defends against does not apply: nothing
// here is paraphrased into first-party prose, nothing is persisted, and every
// result is labelled with the entity it came from.
//
// A mail subject is attacker-authored, and is still not sanitized here for the
// same reason: the user asked to see their mail metadata, and a subject shown
// as inert, non-interactive text is not a capability. What defends that path is
// the RENDERER -- apps/mobile renders every result through React Native's
// `<Text>`, which has no markdown, no HTML, no autolink and no WebView, so a
// URL in a subject is characters on a screen and not a destination. That
// property is asserted by a test rather than assumed.
//
// ===========================================================================
// WHAT THIS DOES DO
// ===========================================================================
//
// Two things, in an order that is NOT interchangeable -- the same ordering
// `apps/worker/src/mail/digest/collect-input.ts` documents:
//
//   1. STRIP rendering-control characters. Bidi overrides reorder what a reader
//      sees without changing what the string contains, and a result list is
//      exactly where that matters: a row can be made to display as a different
//      row. Stripping must happen FIRST, because otherwise an adversarial title
//      can spend its whole character budget on invisible codepoints and arrive
//      truncated to nothing -- the Checkpoint 8.1 finding, restated.
//   2. TRUNCATE to a hard bound, at a word boundary where one is available.
//
// Both steps delegate to `../mail/provider-strings.ts`, which already
// implements them with the surrogate-pair and whitespace-control care they
// need. Nothing is reimplemented here; this module supplies the search-specific
// names and bounds and nothing else. Two copies of a text-bounding control is
// how one of them rots.

import { stripUnsummarizableCharacters, truncateAtWordBoundary } from "../mail/provider-strings.js";

/**
 * Longest title/label a result may carry.
 *
 * A title is the row's identity in the list, so it is bounded generously enough
 * to stay recognisable and tightly enough that one adversarial subject cannot
 * dominate the response.
 */
export const SEARCH_TITLE_MAX_CHARS = 160;

/** Longest secondary preview line. Shorter than the title: it is context, not identity. */
export const SEARCH_PREVIEW_MAX_CHARS = 200;

/**
 * Longest sender label on a mail result.
 *
 * Matches MAIL_DISPLAY_NAME_MAX_CHARS' intent at half the size: the stored
 * column is already bounded at write, and a result row needs only enough to
 * recognise a sender.
 */
export const SEARCH_SENDER_MAX_CHARS = 120;

/**
 * A required, non-null label.
 *
 * `fallback` is used when the source text is absent or normalizes away to
 * nothing -- a mail message with no Subject header, or a title made entirely of
 * bidi overrides. Returning the fallback rather than an empty string keeps every
 * result row tappable and identifiable; an empty title renders as a blank row
 * the user cannot tell apart from a broken one.
 */
export function searchTitle(
  value: string | null | undefined,
  fallback: string,
  maxChars: number = SEARCH_TITLE_MAX_CHARS,
): string {
  const stripped = stripUnsummarizableCharacters(value);
  if (stripped === null || stripped === "") return fallback;
  return truncateAtWordBoundary(stripped, maxChars) ?? fallback;
}

/**
 * An optional secondary line. Null when there is genuinely nothing to show,
 * which the client renders as absence rather than as an empty line.
 */
export function searchPreview(
  value: string | null | undefined,
  maxChars: number = SEARCH_PREVIEW_MAX_CHARS,
): string | null {
  const stripped = stripUnsummarizableCharacters(value);
  if (stripped === null || stripped === "") return null;
  return truncateAtWordBoundary(stripped, maxChars);
}
