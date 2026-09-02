// Checkpoint 7.4 shared contracts for the mail digest (ADR-053/054).
//
// Frozen before the collector, prompt builder, output filter and generation
// service are written, so all four build against one definition. Nothing here
// reads the database or calls a provider.
//
// ===========================================================================
// WHY THIS FILE IS THE SECURITY BOUNDARY
// ===========================================================================
//
// `MailDigestInput` is the ONLY thing that ever reaches a prompt, and mail is
// the FIRST ATTACKER-AUTHORED INPUT to reach the AI layer in this project's
// history (ADR-054). Everything the Daily Brief's `BriefInput` guarantees still
// holds -- closed scalar allowlist, no uuids, no ids, no free-text bodies -- but
// ADR-054 is explicit that one of its properties WEAKENS here and must not be
// restated as though it had not:
//
//   BriefInput's "a secret is structurally inexpressible" means OUR secrets are
//   inexpressible. It never meant an attacker can express nothing. A sender
//   chooses `subject` and `from_display_name`, and a subject line routinely
//   carries a one-time code or a magic link. The guarantee is not that the
//   model sees nothing dangerous; it is that the digest lane HAS NO TOOLS, can
//   write nothing but text, and reaches no other table -- so a fully successful
//   injection produces misleading prose, never an action.
//
// EXACTLY TWO ATTACKER-CONTROLLED FIELDS EXIST HERE: `subject` and
// `from_display_name`. That count is a contract, not an observation. In
// particular there is deliberately NO `from_address` and NO `from_domain`:
// ADR-054 says "no addresses", and a domain is the half of an address a sender
// picks, so admitting one would make three attacker-controlled fields and
// quietly widen the surface the rest of this design is measured against.

/**
 * Gmail's own category labels, mapped to a CLOSED vocabulary.
 *
 * Not attacker-controlled: the provider assigns these, a sender cannot choose
 * one, and anything unrecognised collapses to `uncategorized` rather than
 * passing a provider string through. That is what keeps the category axis
 * useful for triage without becoming a third untrusted field.
 */
export const MAIL_DIGEST_CATEGORIES = [
  "personal",
  "social",
  "promotions",
  "updates",
  "forums",
  "uncategorized",
] as const;
export type MailDigestCategory = (typeof MAIL_DIGEST_CATEGORIES)[number];

export interface MailDigestCategoryCount {
  category: MailDigestCategory;
  count: number;
  unread_count: number;
}

/**
 * One sender, grouped by display name.
 *
 * `display_name` is ATTACKER-CONTROLLED and hard-capped. It is null when the
 * `From` header carried no phrase, which is a real and common shape -- inventing
 * a placeholder would make "no display name" indistinguishable from a sender who
 * chose that placeholder.
 */
export interface MailDigestSenderItem {
  display_name: string | null;
  count: number;
  unread_count: number;
}

/**
 * One highlighted message.
 *
 * The densest attacker-controlled section in the payload: BOTH untrusted fields
 * appear here, once per item. That is why it is capped hardest and why it is the
 * first rung of the drop ladder.
 *
 * `received_at` is the provider's own `internalDate`, which a SENDER cannot set
 * -- Gmail stamps it on receipt -- so it is first-party for these purposes. No
 * message id and no thread id: ADR-054 excludes both, and neither would help a
 * summary.
 */
export interface MailDigestMessageItem {
  subject: string | null;
  from_display_name: string | null;
  received_at: string;
  unread: boolean;
  important: boolean;
  starred: boolean;
  category: MailDigestCategory;
}

/**
 * The whole payload.
 *
 * `summary` is the deterministic, first-party envelope: every number in it is a
 * COUNT computed by Postgres over the full window, never capped and never
 * derived from an item list. It is what survives the drop ladder to the very
 * end, so a digest generated under an adversarial flood still states the true
 * shape of the mailbox even when every subject has been dropped.
 */
export interface MailDigestInput {
  generated_at: string;
  tz: string;
  local_date: string;
  /** How far back the window reaches from `generated_at`. */
  window_hours: number;
  summary: {
    mailbox_count: number;
    total_count: number;
    unread_count: number;
    important_count: number;
    starred_count: number;
    thread_count: number;
    /** Honest pre-cap count of distinct senders in the window. */
    sender_count: number;
  };
  categories: { items: MailDigestCategoryCount[]; total: number };
  senders: { items: MailDigestSenderItem[]; total: number };
  highlights: { items: MailDigestMessageItem[]; total: number };
}

// ---------------------------------------------------------------------------
// Deterministic bounds
// ---------------------------------------------------------------------------

/** Trailing window the digest describes. */
export const MAIL_DIGEST_WINDOW_HOURS = 24;

export const MAIL_DIGEST_HIGHLIGHTS_CAP = 12;
export const MAIL_DIGEST_SENDERS_CAP = 10;
/** One per closed category, so this cap can only ever bind on a bug. */
export const MAIL_DIGEST_CATEGORIES_CAP = MAIL_DIGEST_CATEGORIES.length;

/**
 * Caps on the two attacker-controlled fields.
 *
 * DELIBERATELY FAR TIGHTER THAN THE STORAGE BOUNDS. `mail_messages.subject`
 * accepts 512 characters and the schema bounds it there, because that is a
 * storage contract; this is a PROMPT contract, and the two answer different
 * questions. ADR-054 requires the mail section to be "capped hardest", and a
 * subject that needs more than 140 characters to be recognisable is not a
 * subject the digest can usefully quote anyway.
 *
 * The arithmetic that makes this bound meaningful: 12 highlights x (140 + 60)
 * plus 10 senders x 60 is ~3k characters of untrusted text in the worst case,
 * against a 9k payload ceiling -- so an attacker cannot fill the payload with
 * their own text however long their subjects are.
 */
export const MAIL_DIGEST_SUBJECT_MAX_CHARS = 140;
export const MAIL_DIGEST_DISPLAY_NAME_MAX_CHARS = 60;

/**
 * Whole-payload ceiling.
 *
 * Smaller than `MAX_BRIEF_INPUT_CHARS` (12000) on purpose: the brief carries
 * five sections of first-party data the user needs to see, while this payload is
 * counts plus at most 22 short untrusted strings. Sized against the measured
 * worst case -- every cap full, every string at its bound -- which is ~5.5k, so
 * 9000 leaves real headroom while keeping the ladder a genuine guarantee rather
 * than a formality that never fires.
 */
export const MAX_MAIL_DIGEST_INPUT_CHARS = 9000;

// ---------------------------------------------------------------------------
// Generation bounds
// ---------------------------------------------------------------------------

/** The `ai_task_routes.task_name` this pipeline resolves. */
export const MAIL_DIGEST_TASK_NAME = "mail_digest";

export const MAIL_DIGEST_ATTEMPT_TIMEOUT_MS = 30_000;
export const MAIL_DIGEST_TOTAL_BUDGET_MS = 45_000;
export const MAIL_DIGEST_MAX_OUTPUT_TOKENS = 600;

/** Hard cap on the persisted text, after output filtering. */
export const MAIL_DIGEST_MAX_TEXT_CHARS = 4000;

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------
//
// Messages are deliberately STATIC. A raw provider or SDK error can echo request
// headers or body -- and this pipeline's request body contains attacker-authored
// subject lines -- so no provider text may become an error message, a log line,
// or a persisted digest.

export class MailDigestTimeoutError extends Error {
  constructor() {
    super("mail digest generation timed out");
    this.name = "MailDigestTimeoutError";
  }
}

export class MailDigestFailedError extends Error {
  constructor() {
    super("mail digest generation failed");
    this.name = "MailDigestFailedError";
  }
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Every attacker-authored string this payload carries.
 *
 * This is the provenance half of the shared output filter's bare-domain defence
 * (layer 2 in `@personal-os/core/ai/output-safety`): the filter removes a
 * host-shaped token from the model's OUTPUT when that token echoes one of these
 * values, whatever public suffix it carries.
 *
 * IT LIVES HERE, NEXT TO THE TYPE, ON PURPOSE. ADR-054's claim that exactly two
 * fields are attacker-chosen is a property of `MailDigestInput`'s shape, so the
 * list of those fields belongs with the shape rather than in the generator. If a
 * future field carries sender-authored text, the type and this function change
 * together in one diff, and the reviewer sees both.
 *
 * `senders[].display_name` is the same untrusted class as
 * `highlights[].from_display_name` -- both are the `From` header's phrase.
 */
export function collectUntrustedDigestInputs(input: MailDigestInput): string[] {
  const values: string[] = [];
  for (const sender of input.senders.items) {
    if (sender.display_name !== null) values.push(sender.display_name);
  }
  for (const message of input.highlights.items) {
    if (message.subject !== null) values.push(message.subject);
    if (message.from_display_name !== null) values.push(message.from_display_name);
  }
  return values;
}
