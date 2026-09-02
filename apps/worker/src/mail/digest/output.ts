// The mail digest's binding of the SHARED output-safety filter.
//
// ===========================================================================
// THE LOGIC MOVED. THIS FILE IS NOW THE MAIL LANE'S BINDING OF IT.
// ===========================================================================
//
// Every line of reasoning about WHY an output filter exists, what it removes,
// what it deliberately does not, and why the old "bare domains are narrow by
// construction" justification was FALSE now lives in
// `packages/core/src/ai/output-safety.ts`. It moved because the Daily Brief in
// `apps/api` needs the identical constraint and `apps/api` may never import
// from `apps/worker` (docs/ARCHITECTURE.md) -- two copies of a security control
// is how one of them silently rots.
//
// What stays here is only what is mail-specific: the digest's own character
// ceiling, and the fact that the digest's untrusted inputs are exactly the two
// attacker-chosen fields ADR-054 names -- `subject` and `from_display_name`.
import { stripUnsummarizableCharacters } from "@personal-os/core/mail/provider-strings";
import {
  containsLinkShapedContent as coreContainsLinkShapedContent,
  sanitizeModelText,
  type SanitizedText,
} from "@personal-os/core/ai/output-safety";
import { MAIL_DIGEST_MAX_TEXT_CHARS } from "./contracts.js";

export { LINK_PLACEHOLDER } from "@personal-os/core/ai/output-safety";

/** Kept as the mail lane's own name for the shared shape. */
export type SanitizedDigestText = SanitizedText;

/**
 * `stripUnsummarizableCharacters` returns `string | null`; the shared filter
 * wants a total function. Null only for a null/undefined input, which cannot
 * occur here because `raw` is a string.
 */
function stripControlCharacters(value: string): string {
  return stripUnsummarizableCharacters(value) ?? "";
}

/**
 * Filters and bounds the model's digest text before it is persisted.
 *
 * `untrustedInputs` is the provenance half of the bare-domain defence (layer 2
 * in the shared module). Passing the subjects and display names the prompt was
 * built from is what makes an echoed domain removable REGARDLESS of its public
 * suffix -- which is exactly the production defect of 2026-09-02, where a
 * display name WAS a domain and the syntactic layer alone would have had to
 * guess.
 */
export function sanitizeDigestText(
  raw: string,
  untrustedInputs: readonly string[] = [],
): SanitizedDigestText {
  return sanitizeModelText(
    raw,
    { maxChars: MAIL_DIGEST_MAX_TEXT_CHARS, untrustedInputs },
    stripControlCharacters,
  );
}

/**
 * Whether any link-shaped content survives.
 *
 * Asserted by the generator as a post-condition rather than assumed. Takes the
 * same `untrustedInputs` as the filter, so the assertion is exactly as strong
 * as the filtering that just ran.
 */
export function containsLinkShapedContent(
  text: string,
  untrustedInputs: readonly string[] = [],
): boolean {
  return coreContainsLinkShapedContent(text, untrustedInputs);
}
