// The repo's first character-truncation helper. Built for Checkpoint 5.5's
// manual AI Daily Brief (ADR-041): free text pulled from the user's own data
// (task titles, note bodies, project goals, review summaries, ...) must be
// capped per field before it is ever concatenated into the bounded prompt
// payload sent to a model. Everything that existed before this had item-COUNT
// caps (e.g. "top 10 tasks") but nothing that bounds a single field's
// character length -- that gap is what this closes.
//
// Deliberately generic and pure (no Date, no I/O, no randomness) so any other
// read model that needs to bound free text before embedding it somewhere with
// a size limit (a push notification body, a log line, a UI preview) can reuse
// it without depending on the Daily Brief.

export interface TruncatedText {
  text: string;
  truncated: boolean;
}

const ELLIPSIS = "…";

// High surrogates occupy U+D800-U+DBFF. A string slice that ends on a high
// surrogate has split a surrogate pair -- the low surrogate got cut off,
// leaving a lone high surrogate that serializes as U+FFFD (or worse) and can
// corrupt a JSON payload. Detecting this only requires looking at the last
// UTF-16 code unit of the slice.
function endsWithDanglingHighSurrogate(value: string): boolean {
  if (value.length === 0) return false;
  const lastCodeUnit = value.charCodeAt(value.length - 1);
  return lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff;
}

/**
 * Truncate `value` to at most `maxChars` UTF-16 code units, appending a
 * single ellipsis character when truncation happens. The returned
 * `text.length` is guaranteed to be `<= maxChars` in every case.
 *
 * - `value.length <= maxChars` returns `value` verbatim (no trimming).
 * - Otherwise: take `value.slice(0, maxChars - 1)`, strip trailing
 *   whitespace, drop a dangling half of a split surrogate pair if present,
 *   and append "…".
 * - `maxChars` must be >= 1; anything smaller throws, since a caller asking
 *   for zero or negative budget is a programmer error, not a runtime
 *   condition to degrade gracefully from.
 */
export function truncateField(value: string, maxChars: number): TruncatedText {
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new Error(`maxChars must be an integer >= 1, got ${maxChars}`);
  }

  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }

  let slice = value.slice(0, maxChars - 1);
  slice = slice.trimEnd();
  if (endsWithDanglingHighSurrogate(slice)) {
    slice = slice.slice(0, -1);
  }

  return { text: `${slice}${ELLIPSIS}`, truncated: true };
}
