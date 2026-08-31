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

/** One `From:`-style header, split into its two independently-useful halves. */
export interface ParsedAddressHeader {
  /** The addr-spec, lowercased. Null when none could be read with confidence. */
  address: string | null;
  /** The human-chosen label, unquoted. Null when the header carries none. */
  displayName: string | null;
}

const EMPTY_ADDRESS_HEADER: ParsedAddressHeader = { address: null, displayName: null };

/**
 * Unquotes an RFC 5322 quoted-string, resolving its backslash escapes.
 *
 * Only the two escapes the grammar actually defines (`\"` and `\\`) are
 * meaningful; a backslash before anything else is dropped, which is what every
 * mail agent does in practice.
 */
function unquotePhrase(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < 2 || !trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
  const inner = trimmed.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === "\\" && i + 1 < inner.length) {
      out += inner[i + 1]!;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out.trim();
}

/**
 * Splits a `From:`-style header into a display name and an address.
 *
 * Provider-neutral by construction: this is RFC 5322 grammar, not Gmail's. Every
 * mail provider hands back a header some third party wrote, and every one of
 * them needs the same two fields pulled out of it.
 *
 * THREE DELIBERATE NON-BEHAVIOURS, each of which a "more helpful" parser would
 * get wrong:
 *
 *  1. **RFC 2047 encoded-words are NOT decoded.** `=?UTF-8?B?...?=` is left
 *     exactly as it arrived. Decoding means running a base64/quoted-printable
 *     decoder over bytes a stranger chose, in order to produce a string that is
 *     then stored and later shown to a model (ADR-054). The encoded token is
 *     inert and visibly encoded; a decoded one is neither. If a legible display
 *     name is ever wanted, that is a decision to make explicitly, with its own
 *     bounds, not a side effect of parsing.
 *  2. **Only the FIRST address is returned.** A `From` header is normally a
 *     single mailbox, but the grammar permits a list, and silently concatenating
 *     or last-winning would make the stored sender a function of header order.
 *  3. **An address is returned only when it is unambiguous.** Anything with
 *     whitespace inside it, or with no `@`, yields null rather than a guess --
 *     the same rule `extractEmailDomain` follows, and for the same reason: a
 *     wrong sender silently mis-groups, a null one is visibly absent.
 *
 * Neither field is length-bounded here. Bounding is the caller's, through
 * `truncateProviderString`, because only the caller knows which column or
 * prompt the value is bound for.
 */
export function parseAddressHeader(raw: string | null | undefined): ParsedAddressHeader {
  if (raw === null || raw === undefined) return { ...EMPTY_ADDRESS_HEADER };
  const value = raw.trim();
  if (value === "") return { ...EMPTY_ADDRESS_HEADER };

  // Take the first mailbox. Splitting on a bare comma would cut a quoted phrase
  // containing one ("Lovelace, Ada" <ada@example.com>), so the scan tracks
  // whether it is inside a quoted-string or an angle-addr.
  let inQuotes = false;
  let inAngles = false;
  let end = value.length;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "\\" && inQuotes) {
      i += 1;
      continue;
    }
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === "<") inAngles = true;
    else if (!inQuotes && ch === ">") inAngles = false;
    else if (ch === "," && !inQuotes && !inAngles) {
      end = i;
      break;
    }
  }
  const first = value.slice(0, end).trim();
  if (first === "") return { ...EMPTY_ADDRESS_HEADER };

  const open = first.lastIndexOf("<");
  const close = first.lastIndexOf(">");
  if (open !== -1 && close > open) {
    const addr = first.slice(open + 1, close).trim();
    const phrase = unquotePhrase(first.slice(0, open));
    return {
      address: isPlausibleAddress(addr) ? addr.toLowerCase() : null,
      displayName: phrase === "" ? null : phrase,
    };
  }

  // No angle-addr: the whole thing is either a bare address or a name we
  // cannot pair with one.
  return isPlausibleAddress(first)
    ? { address: first.toLowerCase(), displayName: null }
    : { address: null, displayName: unquotePhrase(first) || null };
}

/** Exactly one "@", something on each side of it, and no internal whitespace. */
function isPlausibleAddress(candidate: string): boolean {
  if (candidate === "" || /\s/.test(candidate)) return false;
  const at = candidate.indexOf("@");
  return at > 0 && at === candidate.lastIndexOf("@") && at < candidate.length - 1;
}
