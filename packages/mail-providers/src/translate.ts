import { createHash } from "node:crypto";
import {
  extractEmailDomain,
  MAIL_ADDRESS_MAX_CHARS,
  MAIL_DISPLAY_NAME_MAX_CHARS,
  MAIL_EXTERNAL_ID_MAX_CHARS,
  MAIL_LABELS_MAX_COUNT,
  MAIL_LABEL_MAX_CHARS,
  MAIL_SUBJECT_MAX_CHARS,
  MAIL_THREAD_ID_MAX_CHARS,
  parseAddressHeader,
  truncateProviderString,
} from "@personal-os/core/mail/provider-strings";
import type { MailHeader, MailMessageMetadata } from "./mail-client.js";

// Provider metadata -> a storable row. Pure: no clock, no network, no database.
//
// EVERY PROVIDER STRING IS TRUNCATED HERE, at the boundary, not at the insert.
// The mail_* columns are unbounded `text` on purpose -- a provider exceeding a
// bound must be caught by a named contract rather than severed silently by a
// varchar -- so this function is the contract. `docs/STATUS.md` records the
// inverse as standing debt (`health_sessions.session_type` is an unconstrained
// `z.string()`, safe only because Google happens to send enum-shaped values),
// and a subject line is the archetype of the value that breaks that assumption,
// because a stranger picks it.
//
// AN UNRECOGNISED PAYLOAD IS REJECTED, NEVER DEFAULTED. The rejection carries a
// key path and a `typeof` and NOTHING ELSE -- never the value. That is the same
// rule the health extractor follows, and it matters more here: the value in
// question may be a subject line.

/** A message row, ready for `mail_messages`. */
export interface MailMessageRow {
  externalId: string;
  threadId: string;
  internalDate: Date;
  fromAddress: string | null;
  fromDomain: string | null;
  fromDisplayName: string | null;
  subject: string | null;
  providerLabels: string[];
  hasAttachment: boolean;
  sizeEstimate: number | null;
  contentHash: string;
}

/** Why one message could not be translated. Carries no provider value. */
export interface MailTranslationRejection {
  /** Dotted path into the provider payload, e.g. `internalDate`. */
  keyPath: string;
  /** `typeof` the offending value, or "missing". Never the value itself. */
  received: string;
}

export type MailTranslationResult =
  { ok: true; row: MailMessageRow } | { ok: false; rejection: MailTranslationRejection };

function headerValue(headers: readonly MailHeader[] | undefined, name: string): string | null {
  if (headers === undefined) return null;
  const lower = name.toLowerCase();
  for (const header of headers) {
    // Case-insensitive: RFC 5322 field names are, and Gmail echoes back the
    // casing the SENDER used, not the casing we asked for.
    if (typeof header?.name === "string" && header.name.toLowerCase() === lower) {
      return typeof header.value === "string" ? header.value : null;
    }
  }
  return null;
}

/** JSON with object keys sorted, so key order cannot change a hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return (
    "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + stableStringify(v)).join(",") + "}"
  );
}

/**
 * Content hash, which is what makes an unchanged re-fetch a genuine no-op.
 *
 * Near-duplicated from `@personal-os/health-providers`'s rather than shared:
 * that package is the Google Health API client and importing it here to borrow
 * forty lines would tie the mail lane's build to the health lane's module graph
 * for no benefit. Phase 6 chose deliberate near-duplication over premature
 * sharing (ADR-052 restates it for Phase 7) and the same call applies.
 *
 * Covers ONLY provider-supplied values -- nothing clock-derived -- so a server
 * clock jump can never invalidate a stored hash and force a rewrite.
 */
export function contentHash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

/**
 * The exact value set the hash covers.
 *
 * Exported so a test can assert the hash's INPUT rather than only its output --
 * a hash test that only compares two digests passes just as happily when the
 * function hashes the empty string.
 *
 * `providerLabels` arrives already sorted (see below), so a provider that
 * returns the same labels in a different order does not manufacture an update.
 */
export function mailMessageContentInput(
  row: Omit<MailMessageRow, "contentHash">,
): Record<string, unknown> {
  return {
    externalId: row.externalId,
    threadId: row.threadId,
    internalDateMs: row.internalDate.getTime(),
    fromAddress: row.fromAddress,
    fromDomain: row.fromDomain,
    fromDisplayName: row.fromDisplayName,
    subject: row.subject,
    providerLabels: row.providerLabels,
    hasAttachment: row.hasAttachment,
    sizeEstimate: row.sizeEstimate,
  };
}

/**
 * Parses Gmail's `internalDate`, which arrives as epoch MILLISECONDS in a
 * STRING (confirmed live in Checkpoint 7.2P).
 *
 * A string rather than a number because the value can exceed 2^53 in principle
 * and JSON would mangle it; parsed strictly, because `Number("")` is 0, which
 * would silently date every malformed message to 1970 -- a value that looks
 * real, sorts first, and would sit at the top of a digest forever.
 */
function parseInternalDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !/^\d{1,15}$/.test(raw)) return null;
  const ms = Number(raw);
  if (!Number.isSafeInteger(ms) || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Translates one provider metadata payload into a storable row.
 *
 * ON `hasAttachment`, WHICH IS ALWAYS FALSE AND SHOULD BE READ THAT WAY:
 *
 * Attachment presence is NOT DERIVABLE under `gmail.metadata`. Detecting it
 * needs either `payload.parts` (absent under this scope -- 7.2P confirmed the
 * response carries only `partId` and `headers`), the `has:attachment` search
 * operator (`q` is rejected outright under this scope), or a `Content-Type`
 * header (deliberately not in the four-header allowlist, and widening that
 * allowlist to guess at a boolean is a bad trade).
 *
 * So the column means "not known to carry an attachment", NOT "proven to carry
 * none". It is written false rather than left nullable because the migration
 * declares it NOT NULL DEFAULT false, and inventing a signal would be worse
 * than admitting there is none. Nothing downstream may present it as evidence.
 */
export function translateMailMessage(payload: MailMessageMetadata): MailTranslationResult {
  if (typeof payload?.id !== "string" || payload.id === "") {
    return { ok: false, rejection: { keyPath: "id", received: describe(payload?.id) } };
  }
  if (typeof payload.threadId !== "string" || payload.threadId === "") {
    return { ok: false, rejection: { keyPath: "threadId", received: describe(payload.threadId) } };
  }

  const internalDate = parseInternalDate(payload.internalDate);
  if (internalDate === null) {
    // NOT defaulted to "now". `mail_messages.internal_date` is NOT NULL and is
    // the digest's ordering key; a fabricated arrival time is a wrong fact that
    // reads exactly like a right one.
    return {
      ok: false,
      rejection: { keyPath: "internalDate", received: describe(payload.internalDate) },
    };
  }

  const headers = payload.payload?.headers;
  const from = parseAddressHeader(headerValue(headers, "From"));
  const fromAddress = truncateProviderString(from.address, MAIL_ADDRESS_MAX_CHARS);

  const labels = Array.isArray(payload.labelIds) ? payload.labelIds : [];
  const providerLabels = labels
    .filter((label): label is string => typeof label === "string" && label !== "")
    .map((label) => truncateProviderString(label, MAIL_LABEL_MAX_CHARS) ?? "")
    .filter((label) => label !== "")
    // Sorted, then capped. Sorting is what stops a reordered label list looking
    // like a content change; capping bounds the array the schema also bounds.
    .sort()
    .slice(0, MAIL_LABELS_MAX_COUNT);

  const sizeEstimate =
    typeof payload.sizeEstimate === "number" &&
    Number.isFinite(payload.sizeEstimate) &&
    payload.sizeEstimate >= 0
      ? Math.floor(payload.sizeEstimate)
      : null;

  const base: Omit<MailMessageRow, "contentHash"> = {
    externalId: truncateProviderString(payload.id, MAIL_EXTERNAL_ID_MAX_CHARS) ?? "",
    threadId: truncateProviderString(payload.threadId, MAIL_THREAD_ID_MAX_CHARS) ?? "",
    internalDate,
    fromAddress,
    // Derived from the TRUNCATED address, so a domain can never be extracted
    // from bytes the row does not store.
    fromDomain: extractEmailDomain(fromAddress),
    fromDisplayName: truncateProviderString(from.displayName, MAIL_DISPLAY_NAME_MAX_CHARS),
    subject: truncateProviderString(headerValue(headers, "Subject"), MAIL_SUBJECT_MAX_CHARS),
    providerLabels,
    hasAttachment: false,
    sizeEstimate,
  };

  return { ok: true, row: { ...base, contentHash: contentHash(mailMessageContentInput(base)) } };
}

/** `typeof`, or "missing"/"null". Never the value. */
function describe(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}
