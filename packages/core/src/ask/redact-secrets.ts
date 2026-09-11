// Bounded, high-confidence secret redaction for Cloud Ask (Checkpoint 8.6B).
//
// NOT A DLP SYSTEM, and must never grow into one. This is a small, anchored
// pattern list for the token SHAPES this project's own credentials and this
// owner's tooling actually produce -- Groq (the production transcription
// provider), Google, GitHub (now that a remote exists), AWS, Slack, Tailscale
// (the perimeter itself), OpenAI/Stripe-shaped keys, xAI, and a bare JWT or PEM
// private key block. What it deliberately does NOT catch is stated in the
// module this feeds (`apps/api/src/ask/redact.ts`): an opaque token with no
// prefix -- an EXPO_TOKEN, a bare-hex encryption key, a password -- is not
// classifiable by shape, and this redactor is not why Cloud Ask is safe to use.
// The explicit switch and the honest disclosure are.
//
// ORDER AND ANCHORING ARE LOAD-BEARING, not cosmetic:
//
//   - The private-key block is matched FIRST and consumes the WHOLE block
//     (header through footer), not just the header line -- an earlier draft of
//     this idea (recorded in the 8.6B design doc) matched only the header and
//     shipped the key body under a "1 secret removed" message.
//   - Every other pattern requires `(?<![A-Za-z0-9_])` immediately before the
//     prefix. Without it, `sk-[A-Za-z0-9_-]{20,}` matches inside
//     "desk-organization-project-notes" and "risk-assessment-framework" --
//     both real near-misses the 8.6B review found by running the naive
//     version against them.
import { stripUnsummarizableCharacters } from "../mail/provider-strings.js";

/** What replaces a redacted secret. Visible, so the count is never a surprise. */
export const SECRET_PLACEHOLDER = "[secret removed]";

const NOT_PRECEDED_BY_ALNUM = "(?<![A-Za-z0-9_])";

const SECRET_PATTERNS: readonly RegExp[] = [
  // Multi-line key block. Matched FIRST: once removed, nothing narrower below
  // can partially match inside what used to be its base64 body.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // OpenAI / Stripe-shaped secret keys.
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}sk-[A-Za-z0-9_-]{20,}`, "g"),
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}sk_live_[A-Za-z0-9_-]{20,}`, "g"),
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}sk_test_[A-Za-z0-9_-]{20,}`, "g"),
  // Groq -- the production transcription provider (ADR-014/015).
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}gsk_[A-Za-z0-9_-]{20,}`, "g"),
  // xAI -- one of the five configured adapter kinds.
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}xai-[A-Za-z0-9_-]{20,}`, "g"),
  // Google API key -- the shape in this repo's own google-services.json.
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}AIza[0-9A-Za-z_-]{35}`, "g"),
  // GitHub tokens, now that a remote exists (docs/STATUS.md, Checkpoint 8.0).
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}gh[ops]_[A-Za-z0-9]{20,}`, "g"),
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}github_pat_[A-Za-z0-9_]{20,}`, "g"),
  // AWS access key id.
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}AKIA[0-9A-Z]{16}`, "g"),
  // Slack.
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}xox[abp]-[A-Za-z0-9-]{10,}`, "g"),
  // Tailscale auth key -- the perimeter itself (ADR-018).
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}tskey-auth-[A-Za-z0-9-]{10,}`, "g"),
  // Google OAuth access / refresh tokens and client secret.
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}ya29\\.[A-Za-z0-9_-]{10,}`, "g"),
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}1//0[A-Za-z0-9_-]{10,}`, "g"),
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}GOCSPX-[A-Za-z0-9_-]{10,}`, "g"),
  // A bearer JWT: three dot-separated base64url segments, the first two
  // starting with the near-universal "eyJ" (base64 of `{"`).
  new RegExp(`${NOT_PRECEDED_BY_ALNUM}eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+`, "g"),
];

export interface RedactedText {
  text: string;
  /** Count only. The matched fragments themselves are never returned. */
  redactions: number;
}

/**
 * Redacts every recognised secret shape in `raw`.
 *
 * Control-strips first (the same Checkpoint 8.1 ordering used everywhere else
 * in this codebase: stripping after truncation could leave an adversarial
 * string spending its budget on invisible codepoints). The CALLER is
 * responsible for running this BEFORE any length truncation -- a secret split
 * by a truncation cut would leave a prefix too short for these patterns to
 * match and ship it anyway. See `apps/api/src/ask/redact.ts`.
 */
export function redactSecrets(raw: string): RedactedText {
  let text = stripUnsummarizableCharacters(raw) ?? "";
  let redactions = 0;
  for (const pattern of SECRET_PATTERNS) {
    const matches = text.match(pattern);
    if (matches === null) continue;
    redactions += matches.length;
    text = text.replace(pattern, SECRET_PLACEHOLDER);
  }
  return { text, redactions };
}
