// The Daily Brief's binding of the SHARED output-safety filter.
//
// ===========================================================================
// WHY THE BRIEF NEEDED ONE AT ALL -- IT SHIPPED WITHOUT ONE FOR A WEEK
// ===========================================================================
//
// ADR-054 was written about mail and called email "the first attacker-authored
// input to reach the AI layer". ADR-057 finding #3 corrected that: it is true
// only as a statement about OCCURRENCE, and false as a statement about
// CAPABILITY. Externally-authored CALENDAR text has had a shipped, unfiltered
// path into this prompt since Checkpoint 5.5 -- roughly a week before ADR-054
// was written. `event.summary` and `location` arrive verbatim from Google and
// CalDAV, are stored in plain `text` columns with no Zod `.max()` and no
// truncation at write, and reach the model through `collect-input.ts`.
//
// Two mitigations already existed and two did not. `description` never reaches
// the model (there is no field for it on `BriefEventItem`), and `title` and
// `location` ARE truncated at the prompt boundary to 120 and 80 characters. But
// the Brief lane had NO output filter -- `generate.ts` did a bare
// `generated.text.trim()` -- and its system prompt asserted the data "does not
// contain any of these", which is exactly the false premise ADR-054 identified
// and required be rewritten for the digest.
//
// The path has never been exercised in production: `events` is 0 and the only
// sync-enabled calendar is an empty test calendar. That is a reason to fix it
// BEFORE enabling a real calendar (Checkpoint 8.2), not a reason to call it
// theoretical.
import { stripUnsummarizableCharacters } from "@personal-os/core/mail/provider-strings";
import {
  containsLinkShapedContent as coreContainsLinkShapedContent,
  sanitizeModelText,
  type SanitizedText,
} from "@personal-os/core/ai/output-safety";
import { BRIEF_MAX_TEXT_CHARS } from "./contracts.js";

/** Kept as the Brief lane's own name for the shared shape. */
export type SanitizedBriefText = SanitizedText;

/**
 * `stripUnsummarizableCharacters` lives under `core/mail/` because that is where
 * it was first needed, but nothing in it is mail-specific -- it removes bidi
 * overrides, zero-width characters and other rendering-control codepoints from
 * any string. Importing it here is reuse, not a layering violation: both lanes
 * depend on `@personal-os/core`, and neither depends on the other.
 */
function stripControlCharacters(value: string): string {
  return stripUnsummarizableCharacters(value) ?? "";
}

/**
 * Filters and bounds the model's brief text before it is persisted.
 *
 * `untrustedInputs` should be `collectUntrustedBriefInputs(input)` -- the
 * calendar-derived titles and locations that fed this prompt. That is the
 * provenance layer of the shared bare-domain defence, and it is what makes an
 * echoed domain removable regardless of its public suffix.
 */
export function sanitizeBriefText(
  raw: string,
  untrustedInputs: readonly string[] = [],
): SanitizedBriefText {
  return sanitizeModelText(
    raw,
    { maxChars: BRIEF_MAX_TEXT_CHARS, untrustedInputs },
    stripControlCharacters,
  );
}

/**
 * Whether any link-shaped content survives.
 *
 * Asserted by the generator as a post-condition rather than assumed, so a hole
 * in the filter refuses the brief instead of persisting a live link.
 */
export function containsLinkShapedContent(
  text: string,
  untrustedInputs: readonly string[] = [],
): boolean {
  return coreContainsLinkShapedContent(text, untrustedInputs);
}
