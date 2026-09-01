import { stripUnsummarizableCharacters } from "@personal-os/core/mail/provider-strings";
import { MAIL_DIGEST_MAX_TEXT_CHARS } from "./contracts.js";

// Server-side filtering of the MODEL'S OUTPUT.
//
// ===========================================================================
// WHY AN OUTPUT FILTER EXISTS AT ALL, WHEN THE INPUT IS ALREADY BOUNDED
// ===========================================================================
//
// ADR-054 names the realistic exploit precisely, and it is not "the model does
// something": it is CONTENT LAUNDERING. Attacker text is paraphrased into
// first-party prose, persisted as a Personal OS digest, and rendered to the user
// wearing the system's own voice. A subject reading
// "Verify now: https://evil.example/reset" becomes, in the model's summary, a
// sentence the user has every reason to trust -- carrying a live link.
//
// The defence ADR-054 requires is "capability reduction plus A SERVER-SIDE
// OUTPUT CONSTRAINT THAT STRIPS LINK-SHAPED CONTENT FROM PERSISTED DIGEST TEXT".
// This is that constraint. It runs after generation and before persistence, so
// nothing link-shaped can reach the column even if the model ignores every word
// of the system prompt.
//
// ---------------------------------------------------------------------------
// WHAT THIS IS NOT
//
// It is NOT an injection-phrase sanitizer, and must never grow into one. It does
// not look for "ignore previous instructions" or judge intent. It removes exactly
// one syntactic class -- things a person could click, copy or paste to reach an
// external destination -- because that class is what turns misleading prose into
// a working attack.
//
// ---------------------------------------------------------------------------
// WHERE THE LINE IS DRAWN, AND THE RESIDUAL, STATED
//
// Stripped: scheme URLs, `www.`-prefixed hosts, markdown link targets, email
// addresses, and bare hosts carrying a path.
//
// NOT stripped: a bare domain with no scheme and no path ("github.com"). Two
// reasons, and the second is the honest one. First, it is not clickable as plain
// text. Second, the false-positive rate on ordinary prose is real, and mangling
// legitimate sentences to remove something inert is a bad trade.
//
// That residual is narrow BY CONSTRUCTION rather than by luck: `MailDigestInput`
// carries no `from_address` and no `from_domain` (ADR-054: "no addresses"), so
// the model is never given a domain to report in the first place. Anything
// domain-shaped in the output was either invented or lifted out of a subject
// line, and both are reasons to distrust it -- which is why a bare domain is
// left visible rather than silently deleted.

/** What replaces a stripped link. Visible, so a reader can tell something went. */
export const LINK_PLACEHOLDER = "[link removed]";

/**
 * Ordered link-shaped patterns.
 *
 * Order matters: markdown is rewritten first so its LABEL survives while its
 * target is removed, and scheme URLs are matched before bare hosts so the whole
 * URL goes rather than just its host portion.
 */
const LINK_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
  // Markdown link: keep the human-readable label, drop the destination.
  {
    pattern: /\[([^\]\n]{0,200})\]\(\s*[^)\s]{1,2000}\s*\)/g,
    replacement: `$1 ${LINK_PLACEHOLDER}`,
  },
  // Any scheme-bearing URL. Deliberately broad on the scheme: javascript:,
  // data: and mailto: are as unwelcome here as http:.
  { pattern: /\b[a-z][a-z0-9+.-]{1,31}:\/\/\S+/gi, replacement: LINK_PLACEHOLDER },
  { pattern: /\b(?:mailto|tel|data|javascript):\S+/gi, replacement: LINK_PLACEHOLDER },
  // www.host, with or without a path.
  { pattern: /\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?/gi, replacement: LINK_PLACEHOLDER },
  // An email address. Never in the input by contract, so its presence in the
  // output means the model invented it or lifted it from a subject line.
  {
    pattern: /\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi,
    replacement: LINK_PLACEHOLDER,
  },
  // A bare host WITH a path -- "evil.example/reset". The path is what makes it
  // a destination rather than a noun.
  {
    pattern: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*/gi,
    replacement: LINK_PLACEHOLDER,
  },
];

export interface SanitizedDigestText {
  text: string;
  /** How many link-shaped fragments were removed. Recorded, never the fragments. */
  linksRemoved: number;
}

/**
 * Filters and bounds the model's text before it is persisted.
 *
 * Four steps, in this order:
 *
 *   1. Strip rendering-control characters. A bidi override in the OUTPUT would
 *      let a laundered sentence render as something other than what was stored,
 *      which defeats reviewing the stored text at all.
 *   2. Remove link-shaped content (above).
 *   3. Collapse the whitespace the replacements leave behind.
 *   4. Hard-cap the length.
 *
 * Returns the count of removals so the caller can log that filtering fired --
 * an unusual count is a signal worth having. THE FRAGMENTS THEMSELVES ARE NEVER
 * RETURNED OR LOGGED: they are attacker-derived, and capturing them for
 * diagnostics would recreate the leak in the log that the filter just closed in
 * the column.
 */
export function sanitizeDigestText(raw: string): SanitizedDigestText {
  const stripped = stripUnsummarizableCharacters(raw) ?? "";

  let text = stripped;
  let linksRemoved = 0;
  for (const { pattern, replacement } of LINK_PATTERNS) {
    // Counted with `match` and rewritten with `replace`, rather than counting
    // inside a replacer callback. The callback form would hand this code the
    // matched fragment -- attacker-derived text -- and the safest thing to do
    // with a value you must never log is to never hold it. `$1` in the markdown
    // replacement is resolved by String.replace itself, so no capture group
    // passes through here either.
    const matches = text.match(pattern);
    if (matches === null) continue;
    linksRemoved += matches.length;
    text = text.replace(pattern, replacement);
    // ONE PASS PER PATTERN, deliberately. Repeatedly re-running the whole set
    // over its own output is how a filter becomes a rewriting engine nobody can
    // reason about -- and the global flag already handles several links in one
    // string, which is the case that actually occurs.
  }

  text = text.replace(/\s+/gu, " ").trim();

  if (text.length > MAIL_DIGEST_MAX_TEXT_CHARS) {
    text = text.slice(0, MAIL_DIGEST_MAX_TEXT_CHARS).trimEnd();
  }

  return { text, linksRemoved };
}

/**
 * Whether any link-shaped content survives.
 *
 * A cheap post-condition the generator asserts rather than assumes. If this ever
 * returns true after `sanitizeDigestText`, the filter has a hole and the digest
 * must be refused rather than persisted -- a stored digest carrying a live link
 * is precisely the outcome ADR-054 forbids.
 */
export function containsLinkShapedContent(text: string): boolean {
  return LINK_PATTERNS.some(({ pattern }) => {
    // `RegExp.test` with a /g regex advances lastIndex; a fresh instance keeps
    // this predicate stateless and safe to call repeatedly.
    const probe = new RegExp(pattern.source, pattern.flags.replace("g", ""));
    return probe.test(text);
  });
}
