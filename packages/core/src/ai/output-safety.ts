// Server-side filtering of a MODEL'S OUTPUT, shared by every AI lane.
//
// ===========================================================================
// WHY THIS LIVES IN core RATHER THAN BESIDE EITHER LANE
// ===========================================================================
//
// It began as `apps/worker/src/mail/digest/output.ts`, private to the mail
// digest. The Daily Brief in `apps/api` needs exactly the same constraint, and
// `apps/api` may never import from `apps/worker` -- the two are separate
// processes whose only interface is Postgres and pg-boss
// (docs/ARCHITECTURE.md). So the logic moves here, next to
// `../mail/provider-strings.ts`, which was placed in core for the same reason:
// nothing in it knows what Gmail or Google Calendar is.
//
// This module is deliberately NOT re-exported from packages/core's barrel. The
// barrel pulls in recurrence and device-auth, which use `node:module` and
// `node:crypto`; apps/mobile reaches core through deep subpaths only, and
// `./ai/*` is one of those. Nothing here imports a Node builtin.
//
// ===========================================================================
// WHY AN OUTPUT FILTER EXISTS AT ALL, WHEN THE INPUT IS ALREADY BOUNDED
// ===========================================================================
//
// ADR-054 names the realistic exploit precisely, and it is not "the model does
// something": it is CONTENT LAUNDERING. Attacker text is paraphrased into
// first-party prose, persisted, and rendered to the user wearing the system's
// own voice. A subject reading "Verify now: https://evil.example/reset"
// becomes, in the model's summary, a sentence the user has every reason to
// trust -- carrying a live link.
//
// The defence ADR-054 requires is "capability reduction plus A SERVER-SIDE
// OUTPUT CONSTRAINT THAT STRIPS LINK-SHAPED CONTENT FROM PERSISTED TEXT". This
// is that constraint. It runs after generation and before persistence, so
// nothing link-shaped can reach a column even if the model ignores every word
// of the system prompt.
//
// ---------------------------------------------------------------------------
// WHAT THIS IS NOT
//
// It is NOT an injection-phrase sanitizer, and must never grow into one. It does
// not look for "ignore previous instructions" and does not judge intent. It
// removes exactly one syntactic class -- things a person could click, copy or
// paste to reach an external destination -- because that class is what turns
// misleading prose into a working attack.
//
// ===========================================================================
// THE BARE-DOMAIN HOLE, AND WHY THE OLD JUSTIFICATION WAS FALSE
// ===========================================================================
//
// The previous version left a bare domain with no scheme and no path
// ("github.com") in place, and justified it like this:
//
//     "That residual is narrow BY CONSTRUCTION rather than by luck:
//      `MailDigestInput` carries no `from_address` and no `from_domain`
//      (ADR-054: 'no addresses'), so the model is never given a domain to
//      report in the first place. Anything domain-shaped in the output was
//      either invented or lifted out of a subject line."
//
// BOTH DISJUNCTS ARE FALSE, and production falsified them. `from_display_name`
// IS in the model's input allowlist -- ADR-054 names it as one of exactly two
// attacker-chosen fields -- and a sender chooses it, so it can simply BE a
// domain. On 2026-09-02 the scheduled production digest emitted a bare domain
// that came from neither invention nor a subject line: it came from a display
// name, verbatim. The filter behaved exactly as written; the written reason it
// was safe is what was wrong.
//
// The fix is structural rather than a phrase list, and it is deliberately TWO
// independent layers, because either one alone has a real gap:
//
//   LAYER 1 -- SYNTACTIC. Strip host-shaped tokens whose suffix is in a bounded
//   set of well-known public suffixes. This catches an INVENTED domain, which
//   no provenance check can see. Its cost is false positives on ordinary prose,
//   which is why the suffix set deliberately EXCLUDES every suffix that is also
//   a common English word (`.it`, `.is`, `.at`, `.in`, `.me`, `.so`, `.no`,
//   `.do`, `.as`, `.be`, `.by`, `.us`, `.to`, `.am`, `.id`) -- "finish the
//   report.It was late" must survive untouched.
//
//   LAYER 2 -- PROVENANCE. Strip any host-shaped token that ECHOES the
//   untrusted input the prompt was built from, whatever its suffix. This is
//   what closes the exact production defect, and it closes it for `.it` and
//   every other excluded or exotic suffix too. It is structural rather than a
//   blacklist because it keys on WHERE THE TEXT CAME FROM, not on what it says:
//   the caller passes the attacker-authored field values it fed the model, and
//   an echo of them is removed. It cannot damage ordinary prose, because prose
//   the model wrote itself is not in the input.
//
// Layer 2 needs no maintenance and grows no list. Layer 1's list is a
// definition of a syntactic class, not an enumeration of bad actors.

/** What replaces a stripped link. Visible, so a reader can tell something went. */
export const LINK_PLACEHOLDER = "[link removed]";

/**
 * Public suffixes treated as evidence that a token is a hostname.
 *
 * NOT an exhaustive TLD list and must never become one -- it is the set for
 * which "word.suffix appearing in English prose" is overwhelmingly a hostname
 * rather than a missing space after a full stop.
 *
 * EXCLUDED ON PURPOSE, and the exclusion is the whole reason this set is
 * curated rather than generated: `it is at in me so no do as be by us to am id
 * re we he my go if or on ok up`. Every one of them is a real public suffix AND
 * a common English word, so including them would rewrite "the meeting.It ran
 * late" into "the meeting [link removed] ran late". Layer 2 covers them when
 * they actually came from untrusted input, which is the case that matters.
 */
const HOSTNAME_SUFFIXES: ReadonlySet<string> = new Set([
  // generic
  "com",
  "org",
  "net",
  "edu",
  "gov",
  "mil",
  "int",
  "info",
  "biz",
  "name",
  // common modern gTLDs
  "io",
  "co",
  "ai",
  "app",
  "dev",
  "xyz",
  "online",
  "site",
  "shop",
  "store",
  "cloud",
  "tech",
  "live",
  "link",
  "click",
  "page",
  "wiki",
  "blog",
  "news",
  "email",
  "top",
  "icu",
  "vip",
  "work",
  "life",
  "world",
  "today",
  "space",
  "website",
  "host",
  "press",
  "fun",
  "zip",
  "mov",
  "team",
  "group",
  "digital",
  "network",
  "systems",
  "solutions",
  "agency",
  "media",
  "studio",
  "design",
  // ccTLDs that are not also common English words
  "uk",
  "de",
  "fr",
  "jp",
  "cn",
  "ru",
  "br",
  "au",
  "ca",
  "nl",
  "se",
  "ch",
  "es",
  "pl",
  "tr",
  "mx",
  "kr",
  "hk",
  "tw",
  "sg",
  "nz",
  "za",
  "ie",
  "dk",
  "fi",
  "cz",
  "gr",
  "pt",
  "ro",
  "hu",
  "il",
  "ua",
  "vn",
  "th",
  "ph",
  "eu",
]);

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

/**
 * Candidate host-shaped tokens: `label(.label)+`, no scheme, no path.
 *
 * Matched case-INSENSITIVELY, because the two layers need different case rules
 * and the regex must not pre-empt either. The case decision lives in
 * `isRemovableHost`:
 *
 *   - Layer 1 (syntactic) additionally requires a LOWERCASE suffix. The model
 *     writes ordinary sentences, so the dominant false positive is a missing
 *     space after a full stop -- "the report.It was late" -- where the token
 *     after the dot is capitalized because it starts a sentence. Requiring a
 *     lowercase suffix removes that entire class for free, while still catching
 *     "Example.com" at the start of a sentence, whose suffix is still lowercase.
 *   - Layer 2 (provenance) ignores case entirely, because an exact echo of
 *     untrusted input is evidence rather than a guess: a display name of
 *     "NOTIFY.IT" reproduced verbatim is the production defect, not prose.
 */
const BARE_HOST_CANDIDATE =
  /(?<![@\w.-])([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?![\w-])/gi;

/** The suffix of a dotted token, or null when it has no dot. */
function suffixOf(token: string): string | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0 || lastDot === token.length - 1) return null;
  return token.slice(lastDot + 1);
}

/**
 * Lowercased, punctuation-insensitive view of an untrusted input, used only to
 * decide provenance. Normalizing both sides means a display name of
 * "Evil.IT" still matches an echoed "evil.it".
 */
function normalizeForProvenance(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export interface SanitizedText {
  text: string;
  /** How many link-shaped fragments were removed. Recorded, never the fragments. */
  linksRemoved: number;
}

export interface OutputSafetyOptions {
  /** Hard ceiling on the returned text, in UTF-16 code units. */
  maxChars: number;
  /**
   * The attacker-authored field values that fed this prompt -- display names,
   * subjects, event titles and locations. Any host-shaped token in the output
   * that echoes one of these is removed regardless of its suffix (layer 2).
   *
   * Pass the values themselves, never the whole prompt: the point is provenance,
   * and a whole prompt contains first-party text too.
   */
  untrustedInputs?: readonly string[];
}

/**
 * Whether `token` is host-shaped AND either carries a known public suffix
 * (layer 1) or echoes untrusted input (layer 2).
 */
function isRemovableHost(token: string, untrustedNormalized: readonly string[]): boolean {
  const suffix = suffixOf(token);
  if (suffix === null) return false;

  // Layer 1 -- syntactic. Lowercase suffix only; see BARE_HOST_CANDIDATE.
  if (suffix === suffix.toLowerCase() && HOSTNAME_SUFFIXES.has(suffix)) return true;

  // Layer 2 -- provenance, case-insensitive. A bare "example" is not
  // host-shaped, so a single-label echo can never reach here; only a dotted
  // token whose text came from untrusted input.
  if (untrustedNormalized.length === 0) return false;
  const normalized = normalizeForProvenance(token);
  return untrustedNormalized.some((input) => input.includes(normalized));
}

/**
 * Filters and bounds a model's text before it is persisted.
 *
 * Five steps, in this order:
 *
 *   1. Strip rendering-control characters. A bidi override in the OUTPUT would
 *      let a laundered sentence render as something other than what was stored,
 *      which defeats reviewing the stored text at all.
 *   2. Remove link-shaped content (LINK_PATTERNS above).
 *   3. Remove bare host-shaped tokens (layers 1 and 2 above).
 *   4. Collapse the whitespace the replacements leave behind.
 *   5. Hard-cap the length.
 *
 * Returns the count of removals so the caller can log that filtering fired --
 * an unusual count is a signal worth having. THE FRAGMENTS THEMSELVES ARE NEVER
 * RETURNED OR LOGGED: they are attacker-derived, and capturing them for
 * diagnostics would recreate the leak in the log that the filter just closed in
 * the column.
 *
 * `stripControlCharacters` is injected rather than imported so this module
 * stays free of any dependency direction that would complicate its placement;
 * callers pass `stripUnsummarizableCharacters` from `../mail/provider-strings`.
 */
export function sanitizeModelText(
  raw: string,
  options: OutputSafetyOptions,
  stripControlCharacters: (value: string) => string,
): SanitizedText {
  const { maxChars, untrustedInputs = [] } = options;
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new Error(`maxChars must be an integer >= 1, got ${maxChars}`);
  }

  let text = stripControlCharacters(raw);
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

  const untrustedNormalized = untrustedInputs
    .filter((value) => value.length > 0)
    .map(normalizeForProvenance);

  // Bare hosts. A replacer callback IS used here, because the decision is
  // per-token rather than per-pattern -- but the matched text is only ever
  // tested, never stored, returned or logged.
  text = text.replace(BARE_HOST_CANDIDATE, (match) => {
    if (!isRemovableHost(match, untrustedNormalized)) return match;
    linksRemoved += 1;
    return LINK_PLACEHOLDER;
  });

  text = text.replace(/\s+/gu, " ").trim();

  if (text.length > maxChars) {
    text = text.slice(0, maxChars).trimEnd();
  }

  return { text, linksRemoved };
}

/**
 * Whether any link-shaped content survives.
 *
 * A cheap post-condition a generator asserts rather than assumes. If this ever
 * returns true after `sanitizeModelText`, the filter has a hole and the output
 * must be refused rather than persisted -- persisted text carrying a live link
 * is precisely the outcome ADR-054 forbids.
 *
 * Takes the same `untrustedInputs` so the post-condition is exactly as strong
 * as the filter that just ran; a caller that omitted them here would assert a
 * weaker invariant than it enforced.
 */
export function containsLinkShapedContent(
  text: string,
  untrustedInputs: readonly string[] = [],
): boolean {
  for (const { pattern } of LINK_PATTERNS) {
    // `RegExp.test` with a /g regex advances lastIndex; a fresh instance keeps
    // this predicate stateless and safe to call repeatedly.
    const probe = new RegExp(pattern.source, pattern.flags.replace("g", ""));
    if (probe.test(text)) return true;
  }

  const untrustedNormalized = untrustedInputs
    .filter((value) => value.length > 0)
    .map(normalizeForProvenance);
  const probe = new RegExp(BARE_HOST_CANDIDATE.source, "g");
  for (const match of text.matchAll(probe)) {
    if (isRemovableHost(match[0], untrustedNormalized)) return true;
  }
  return false;
}
