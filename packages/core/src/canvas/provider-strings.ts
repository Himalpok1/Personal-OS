// Bounding untrusted provider-supplied strings for the Canvas LMS integration
// (ADR-068, Checkpoint 10.1).
//
// WHY THIS LIVES IN core RATHER THAN IN THE PROVIDER PACKAGE
//
// Nothing here knows what Canvas's HTTP client looks like. Every field a
// course, an assignment or an announcement carries was chosen by someone at
// the institution -- an instructor's course name, an assignment title, an
// announcement's rich-text body -- and needs the same treatment before it
// reaches a column. That makes it provider-neutral by construction, the same
// bar `packages/core/src/mail/provider-strings.ts` is held to.
//
// WHY A NEW, SELF-CONTAINED FILE RATHER THAN SHARING mail's
//
// This project's convention is deliberate near-duplication per provider
// rather than a shared generic module (ADR-052's stated reasoning for why
// mail did not reach for a pre-existing "provider string" abstraction either).
// A future provider gets its own file with its own bounds, not a shared
// module every provider has to negotiate over.
//
// WHY BOUNDING IS A CONTRACT AND NOT A COLUMN TYPE
//
// `canvas_*` tables store `text` with no length cap. A provider that exceeds
// a bound must be caught by a named contract that says so, not severed
// silently by a varchar -- the same reasoning `text-bounds.ts` documents for
// this codebase's own user-authored fields.
//
// This module is deliberately NOT re-exported from packages/core's barrel.
// The barrel pulls in recurrence and device-auth, which use `node:module` and
// `node:crypto`; apps/mobile reaches core through deep subpaths only, and
// `./canvas/*` is one of those, matching `./mail/*` and `./health/*`. Nothing
// here imports a Node builtin.

/** Course/assignment/announcement/event titles. Matches ENTITY_TITLE_MAX_CHARS's own bound. */
export const CANVAS_TITLE_MAX_CHARS = 512;
/** A course code such as "CSE-3311-001" is always short. */
export const CANVAS_COURSE_CODE_MAX_CHARS = 64;
/** A term name such as "Fall 2026 - UT Arlington". */
export const CANVAS_TERM_NAME_MAX_CHARS = 128;
/** A calendar event's location_name. */
export const CANVAS_LOCATION_MAX_CHARS = 256;
/** The Canvas account's display name (`canvas_user_name`). */
export const CANVAS_USER_NAME_MAX_CHARS = 256;
/** The tag-stripped, plain-text announcement preview -- generous, since it stands in for the body. */
export const CANVAS_ANNOUNCEMENT_PREVIEW_MAX_CHARS = 2000;

/**
 * Truncates `value` to at most `maxChars` UTF-16 code units without splitting
 * a surrogate pair.
 *
 * A naive `slice` can cut between a high and low surrogate and produce a lone
 * surrogate, which is not valid UTF-8 and which Postgres rejects outright with
 * `invalid byte sequence for encoding "UTF8"`. An emoji in a course name is
 * enough to hit it, so the guard is load-bearing rather than theoretical.
 *
 * Returns `null` for `null`/`undefined`, so a caller can pass a nullable field
 * straight through. An empty string stays an empty string: "Canvas returned no
 * title" and "there is no title field" are different facts and only the
 * caller knows which it has.
 *
 * Identical algorithm to `packages/core/src/mail/provider-strings.ts`'s
 * function of the same name, deliberately duplicated rather than shared (see
 * the file header).
 */
export function truncateProviderString(
  value: string | null | undefined,
  maxChars: number,
): string | null {
  if (value === null || value === undefined) return null;
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  const cut = value.slice(0, maxChars);
  const last = cut.charCodeAt(cut.length - 1);
  // A high surrogate (D800-DBFF) in the final position lost its partner.
  if (last >= 0xd800 && last <= 0xdbff) return cut.slice(0, -1);
  return cut;
}

/**
 * Named HTML entities that plausibly appear in Canvas-authored rich text.
 *
 * Deliberately small and closed -- this is a readability pass, not a general
 * HTML-entity decoder. Numeric entities (`&#39;`, `&#x27;`) are handled
 * separately below.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

const NAMED_ENTITY_PATTERN = /&(?:amp|lt|gt|quot|#39|apos|nbsp);/g;

/**
 * Strips HTML tags from Canvas-authored rich text (an announcement's
 * `message`) to a plain-text preview.
 *
 * =========================================================================
 * THIS IS NOT, AND MUST NEVER BECOME, AN HTML PARSER OR A SANITIZER.
 * =========================================================================
 *
 * It is a SIMPLE, deliberately non-exhaustive tag stripper for display
 * purposes only. It is safe precisely because its output is never rendered
 * as HTML on any client -- React Native's `<Text>` interprets no markup, the
 * same reasoning ADR-059 §5 applies to search results -- so there is no XSS
 * surface to defend and no reason to reach for a real parser. A regex-based
 * stripper is the wrong tool for untrusted HTML that will be RENDERED as
 * HTML; it is a reasonable tool for untrusted HTML that will only ever be
 * displayed as inert text.
 *
 * Algorithm: decode a small closed set of common entities, strip every
 * `<...>` tag, collapse whitespace/newline runs to a single space, trim.
 * Nested tags (`<div><a href="...">text</a></div>`) fall out for free because
 * the tag-stripping regex is applied once over the whole string, removing
 * every matched `<...>` span regardless of nesting depth.
 *
 * Returns `null` for `null`/`undefined` so a nullable field passes through.
 * A message that was ONLY markup (no text) becomes the empty string, not
 * null: "Canvas returned an empty message" and "there is no message field"
 * are different facts, and only the caller knows which it has.
 */
export function stripHtmlToPlainText(html: string | null | undefined): string | null {
  if (html === null || html === undefined) return null;
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(NAMED_ENTITY_PATTERN, (match) => NAMED_ENTITIES[match] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}
