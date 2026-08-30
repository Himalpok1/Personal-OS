// Bounding untrusted provider-supplied strings (ADR-054).
//
// WHY THIS LIVES IN core RATHER THAN IN THE PROVIDER PACKAGE
//
// Nothing here knows what Gmail is. Every mail provider hands back a subject, a
// display name and an address that some third party chose, and every one of
// them needs the same treatment before it reaches a column or a prompt. That
// makes it provider-neutral by construction rather than by aspiration, which is
// the bar packages/core is held to.
//
// WHY BOUNDING IS A CONTRACT AND NOT A COLUMN TYPE
//
// The mail_* tables store `text` with no length cap on purpose. A provider that
// exceeds a bound must be caught by a named contract that says so, not severed
// silently by a varchar. `docs/STATUS.md` records the inverse of this as
// standing debt: `health_sessions.session_type` is an unconstrained
// `z.string()` that is "currently safe because [it comes] from Google's
// enum-shaped fields... but nothing in the schema would catch it if that
// assumption broke". Subjects and display names are the archetype of the
// assumption that will break, because a sender chooses them.
//
// This module is deliberately NOT re-exported from packages/core's barrel.
// The barrel pulls in recurrence and device-auth, which use `node:module` and
// `node:crypto`; apps/mobile reaches core through deep subpaths only, and
// `./mail/*` is one of those. Nothing here imports a Node builtin.

/** RFC 5321 caps an address at 64 local + "@" + 255 domain. */
export const MAIL_ADDRESS_MAX_CHARS = 320;
/** RFC 1035 caps a fully-qualified domain at 255 octets. */
export const MAIL_DOMAIN_MAX_CHARS = 255;
/** RFC 5322 caps an unfolded header line at 998 octets; a subject is shorter in practice. */
export const MAIL_SUBJECT_MAX_CHARS = 512;
export const MAIL_DISPLAY_NAME_MAX_CHARS = 256;
export const MAIL_EXTERNAL_ID_MAX_CHARS = 128;
export const MAIL_THREAD_ID_MAX_CHARS = 128;
export const MAIL_SCOPE_KEY_MAX_CHARS = 128;
export const MAIL_LABEL_MAX_CHARS = 128;
export const MAIL_LABELS_MAX_COUNT = 100;
/** Gmail's historyId is a short decimal string; the ceiling is slack for a future provider's token. */
export const MAIL_CURSOR_VALUE_MAX_CHARS = 512;

/**
 * Truncates `value` to at most `maxChars` UTF-16 code units without splitting a
 * surrogate pair.
 *
 * A naive `slice` can cut between a high and low surrogate and produce a lone
 * surrogate, which is not valid UTF-8 and which Postgres rejects outright with
 * `invalid byte sequence for encoding "UTF8"`. An emoji in a subject line is
 * enough to hit it, so the guard is load-bearing rather than theoretical.
 *
 * Returns `null` for `null`/`undefined`, so a caller can pass a nullable header
 * straight through. An empty string stays an empty string: "the sender set no
 * subject" and "there is no subject field" are different facts and only the
 * caller knows which it has.
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
 * Extracts the lowercased domain from an email address, or `null` if there is
 * not exactly one recognisable domain.
 *
 * Deliberately strict and deliberately not an address validator. It exists to
 * populate `mail_messages.from_domain`, which is a grouping key -- "how much of
 * today's mail is from this sender's organisation" -- so a value it cannot
 * derive with confidence must be `null` rather than a guess. A wrong domain
 * silently mis-groups a digest; a null one is visibly absent.
 *
 * Splits on the LAST "@" because RFC 5322 permits a quoted local part
 * containing one (`"a@b"@example.com`), and the domain is what follows the
 * final separator. Rejects an empty domain, a domain containing whitespace or a
 * further "@", and anything over the RFC 1035 length cap.
 */
export function extractEmailDomain(address: string | null | undefined): string | null {
  if (address === null || address === undefined) return null;
  const trimmed = address.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (domain.length > MAIL_DOMAIN_MAX_CHARS) return null;
  if (/[\s@]/.test(domain)) return null;
  // A bare label with no dot is not a routable domain, but localhost-style
  // single labels do appear in test fixtures; require at least one dot so the
  // grouping key is always a real domain.
  if (!domain.includes(".")) return null;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return null;
  return domain;
}
