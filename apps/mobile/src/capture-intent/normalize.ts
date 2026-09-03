import { CAPTURE_TEXT_MAX_LENGTH } from "@personal-os/schema";

// C0 controls except tab and newline, DEL, and the C1 block. Written as
// escapes so this source file itself contains no control characters.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Normalizes text handed to Personal OS by another Android app.
 *
 * Shared text is UNTRUSTED third-party input -- the first capture front door
 * whose content the owner did not type. Two rules, in this order, matching
 * the ordering Checkpoint 8.1 established for event text:
 *
 *  1. Strip control characters FIRST, so an adversarial share cannot spend
 *     its length budget on invisible codepoints and push the visible payload
 *     past the cap.
 *  2. Then bound to the same limit the server enforces.
 *
 * Nothing here interprets the text. It is never parsed as HTML or Markdown,
 * never auto-linked, and never used to derive a route -- it is rendered into
 * a TextInput and posted as a capture body, nothing else.
 */
export function normalizeSharedText(raw: string): string {
  return raw.replace(CONTROL_CHARACTERS, "").slice(0, CAPTURE_TEXT_MAX_LENGTH).trim();
}
