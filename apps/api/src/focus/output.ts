// Suggested Focus's binding of the SHARED output-safety filter (mirrors
// apps/api/src/ask/output.ts exactly, at Suggested Focus's own char cap).
//
// Same shared module the Ask lane, the Brief and the mail digest use --
// `@personal-os/core/ai/output-safety` -- so a fix or a regression in any
// one lane's guarantee is a fix or a regression in all four.
//
// `untrustedInputs` here are the EXTERNAL event titles/locations that
// `buildTodayContext` surfaces (the same `TodayContextBuild.untrustedInputs`
// Ask's "Ask about today" path already passes to its own output filter) --
// the provenance layer runs over exactly those, never the owner's own tasks.
import { stripUnsummarizableCharacters } from "@personal-os/core/mail/provider-strings";
import {
  containsLinkShapedContent as coreContainsLinkShapedContent,
  sanitizeModelText,
  type SanitizedText,
} from "@personal-os/core/ai/output-safety";
import { FOCUS_MAX_SUGGESTION_CHARS } from "./contracts.js";

export type SanitizedFocusSuggestion = SanitizedText;

function stripControlCharacters(value: string): string {
  return stripUnsummarizableCharacters(value) ?? "";
}

/**
 * Filters and bounds the model's suggestion before it is returned to the
 * client. `untrustedInputs` are the externally-authored strings the prompt
 * carried (external event titles/locations), for the provenance layer.
 */
export function sanitizeFocusSuggestion(
  raw: string,
  untrustedInputs: readonly string[] = [],
): SanitizedFocusSuggestion {
  return sanitizeModelText(
    raw,
    { maxChars: FOCUS_MAX_SUGGESTION_CHARS, untrustedInputs },
    stripControlCharacters,
  );
}

/**
 * Post-condition, asserted rather than assumed -- same discipline as Ask, the
 * Brief and the digest. If link-shaped content survives, the suggestion is
 * refused (502) rather than returned with a hole in the filter nobody would
 * notice.
 */
export function containsLinkShapedContent(
  text: string,
  untrustedInputs: readonly string[] = [],
): boolean {
  return coreContainsLinkShapedContent(text, untrustedInputs);
}
