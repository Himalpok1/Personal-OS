// Cloud Ask's binding of the SHARED output-safety filter (design §8).
//
// Same shared module the Brief and mail digest use --
// `@personal-os/core/ai/output-safety` -- so a fix or a regression in any one
// lane's guarantee is a fix or a regression in all three.
//
// ONE DELIBERATE DIVERGENCE FROM THE OTHER TWO LANES: `untrustedInputs` is
// always empty here. The provenance layer of the shared filter exists to
// strip a host-shaped token that ECHOES attacker-authored input the prompt was
// built from (a calendar title, a mail subject/display name). Ask's context is
// the user's OWN notes and tasks -- first-party by construction, the same
// class ADR-059 already ruled must never be run through a laundering filter
// meant for a MODEL's paraphrase of a stranger's text (see
// `packages/core/src/search/preview.ts`'s reasoning, reused here for the
// citation-bearing answer rather than a raw search result). Feeding first-
// party record text into the provenance layer would let it strip a version
// number, a price, or a filename the user's OWN note legitimately mentions --
// exactly the false-positive class `BARE_HOST_CANDIDATE` is documented to
// produce (`v18.2.1`, `3.14`, `index.ts`). The syntactic (public-suffix) and
// URL/markdown layers still run unconditionally, so an invented or genuinely
// link-shaped fragment in the model's OWN prose is still removed.
import { stripUnsummarizableCharacters } from "@personal-os/core/mail/provider-strings";
import {
  containsLinkShapedContent as coreContainsLinkShapedContent,
  sanitizeModelText,
  type SanitizedText,
} from "@personal-os/core/ai/output-safety";
import { ASK_MAX_ANSWER_CHARS } from "./contracts.js";

export type SanitizedAskAnswer = SanitizedText;

function stripControlCharacters(value: string): string {
  return stripUnsummarizableCharacters(value) ?? "";
}

/** Filters and bounds the model's answer before it is returned to the client. */
export function sanitizeAskAnswer(raw: string): SanitizedAskAnswer {
  return sanitizeModelText(raw, { maxChars: ASK_MAX_ANSWER_CHARS }, stripControlCharacters);
}

/**
 * Post-condition, asserted rather than assumed -- same discipline as the Brief
 * and digest. If link-shaped content survives, the answer is refused (502)
 * rather than returned with a hole in the filter nobody would notice.
 */
export function containsLinkShapedContent(text: string): boolean {
  return coreContainsLinkShapedContent(text);
}
