import { localDayWindow } from "@personal-os/core";
import {
  stripUnsummarizableCharacters,
  truncateAtWordBoundary,
} from "@personal-os/core/mail/provider-strings";
import type { Db } from "@personal-os/db";
import { sql } from "drizzle-orm";
import {
  MAIL_DIGEST_CATEGORIES,
  MAIL_DIGEST_DISPLAY_NAME_MAX_CHARS,
  MAIL_DIGEST_HIGHLIGHTS_CAP,
  MAIL_DIGEST_SENDERS_CAP,
  MAIL_DIGEST_SUBJECT_MAX_CHARS,
  MAIL_DIGEST_WINDOW_HOURS,
  MAX_MAIL_DIGEST_INPUT_CHARS,
  type MailDigestCategory,
  type MailDigestInput,
  type MailDigestMessageItem,
  type MailDigestSenderItem,
} from "./contracts.js";

// The deterministic collector.
//
// ===========================================================================
// COUNTS COME FROM POSTGRES OVER THE WHOLE WINDOW; ITEMS ARE CAPPED IN SQL.
// ===========================================================================
//
// Not an optimization. If the collector read N rows into memory and derived
// counts from what it happened to read, then every count would silently become
// "counts among the rows we bothered to fetch" the moment a bound bound -- and
// the digest would understate a flooded mailbox in exactly the situation where
// stating the true size matters most. Aggregates run unbounded; only the ITEM
// lists are capped, and every `total` beside them is the honest pre-cap number.
//
// WHAT IS IN SCOPE
//
//   * ACTIVE connections only. A disconnected mailbox is history, not attention.
//   * INBOX only. `history.list` reports every change in the mailbox, so SENT
//     and DRAFT rows are stored too; neither is something that needs attention.
//   * NOT tombstoned. A message the provider says is gone should not be
//     summarized as though it were waiting.
//
// WHAT NEVER LEAVES THIS FILE
//
// `thread_id` is read -- it is the only way to count distinct threads -- and is
// used ONLY inside a SQL aggregate. It never reaches `MailDigestInput`, because
// ADR-054 excludes ids. Same for `connection_id`, which produces `mailbox_count`
// and nothing else.

/** Maps Gmail's provider labels onto the closed category vocabulary, in SQL. */
const CATEGORY_CASE = sql`case
  when 'CATEGORY_PERSONAL' = any(m.provider_labels) then 'personal'
  when 'CATEGORY_SOCIAL' = any(m.provider_labels) then 'social'
  when 'CATEGORY_PROMOTIONS' = any(m.provider_labels) then 'promotions'
  when 'CATEGORY_UPDATES' = any(m.provider_labels) then 'updates'
  when 'CATEGORY_FORUMS' = any(m.provider_labels) then 'forums'
  else 'uncategorized'
end`;

/**
 * The window predicate, shared by every query so they cannot disagree.
 *
 * A digest whose counts covered one set of rows and whose highlights came from
 * another would be wrong in a way nothing would ever surface.
 */
function windowFilter(windowStart: Date) {
  return sql`from mail_messages m
    join mail_connections c on c.id = m.connection_id
   where c.status = 'active'
     and m.deleted_at is null
     and 'INBOX' = any(m.provider_labels)
     and m.internal_date >= ${windowStart}`;
}

interface SummaryRow {
  mailbox_count: number;
  total_count: number;
  unread_count: number;
  important_count: number;
  starred_count: number;
  thread_count: number;
  sender_count: number;
}

interface CategoryRow {
  category: string;
  count: number;
  unread_count: number;
}

interface SenderRow {
  display_name: string | null;
  count: number;
  unread_count: number;
}

interface HighlightRow {
  subject: string | null;
  from_display_name: string | null;
  internal_date: Date;
  unread: boolean;
  important: boolean;
  starred: boolean;
  category: string;
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

/** Narrows a SQL-produced category string to the closed vocabulary. */
function toCategory(raw: string): MailDigestCategory {
  return (MAIL_DIGEST_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as MailDigestCategory)
    : "uncategorized";
}

/**
 * Bounds one attacker-authored string.
 *
 * ORDER MATTERS AND IS NOT INTERCHANGEABLE. Control characters are stripped
 * FIRST, then the result is truncated. Truncating first would let a subject
 * padded with hundreds of zero-width characters consume the whole budget and
 * arrive as an empty-looking string -- the bound would have been spent on
 * nothing. Stripping first means the budget is always spent on real characters.
 */
function bound(value: string | null, maxChars: number): string | null {
  const stripped = stripUnsummarizableCharacters(value);
  if (stripped === null) return null;
  if (stripped === "") return null;
  return truncateAtWordBoundary(stripped, maxChars);
}

export interface CollectMailDigestParams {
  db: Db;
  timezone: string;
  now: Date;
  windowHours?: number;
}

export interface CollectedMailDigest {
  input: MailDigestInput;
  localDate: string;
  /** True when the window held no INBOX mail at all. */
  empty: boolean;
}

export async function collectMailDigestInput(
  params: CollectMailDigestParams,
): Promise<CollectedMailDigest> {
  const windowHours = params.windowHours ?? MAIL_DIGEST_WINDOW_HOURS;
  const windowStart = new Date(params.now.getTime() - windowHours * 60 * 60 * 1000);
  const { localDate } = localDayWindow(params.timezone, params.now);

  const summaryResult = await params.db.execute(sql`
    select
      count(distinct m.connection_id)::int as mailbox_count,
      count(*)::int as total_count,
      count(*) filter (where 'UNREAD' = any(m.provider_labels))::int as unread_count,
      count(*) filter (where 'IMPORTANT' = any(m.provider_labels))::int as important_count,
      count(*) filter (where 'STARRED' = any(m.provider_labels))::int as starred_count,
      count(distinct m.thread_id)::int as thread_count,
      count(distinct m.from_display_name)::int as sender_count
    ${windowFilter(windowStart)}`);
  const summary = rowsOf<SummaryRow>(summaryResult)[0] ?? {
    mailbox_count: 0,
    total_count: 0,
    unread_count: 0,
    important_count: 0,
    starred_count: 0,
    thread_count: 0,
    sender_count: 0,
  };

  const categoryResult = await params.db.execute(sql`
    select
      ${CATEGORY_CASE} as category,
      count(*)::int as count,
      count(*) filter (where 'UNREAD' = any(m.provider_labels))::int as unread_count
    ${windowFilter(windowStart)}
    group by 1
    order by 2 desc, 1 asc`);

  const senderResult = await params.db.execute(sql`
    select
      m.from_display_name as display_name,
      count(*)::int as count,
      count(*) filter (where 'UNREAD' = any(m.provider_labels))::int as unread_count
    ${windowFilter(windowStart)}
    group by 1
    order by 2 desc, 1 asc nulls last
    limit ${MAIL_DIGEST_SENDERS_CAP}`);

  // Highlights are ordered by ATTENTION, not by arrival: unread-and-important
  // first, then unread, then starred, then newest. A digest that led with the
  // newest promotional mail would be a mailbox listing, not a summary of what
  // needs attention -- and the ordering is fully deterministic (the final
  // internal_date/subject tiebreak) so the same window always yields the same
  // payload.
  const highlightResult = await params.db.execute(sql`
    select
      m.subject,
      m.from_display_name,
      m.internal_date,
      ('UNREAD' = any(m.provider_labels)) as unread,
      ('IMPORTANT' = any(m.provider_labels)) as important,
      ('STARRED' = any(m.provider_labels)) as starred,
      ${CATEGORY_CASE} as category
    ${windowFilter(windowStart)}
    order by
      (('UNREAD' = any(m.provider_labels)) and ('IMPORTANT' = any(m.provider_labels))) desc,
      ('UNREAD' = any(m.provider_labels)) desc,
      ('STARRED' = any(m.provider_labels)) desc,
      m.internal_date desc,
      m.subject asc nulls last
    limit ${MAIL_DIGEST_HIGHLIGHTS_CAP}`);

  const categories = rowsOf<CategoryRow>(categoryResult).map((row) => ({
    category: toCategory(row.category),
    count: row.count,
    unread_count: row.unread_count,
  }));

  const senders: MailDigestSenderItem[] = rowsOf<SenderRow>(senderResult).map((row) => ({
    display_name: bound(row.display_name, MAIL_DIGEST_DISPLAY_NAME_MAX_CHARS),
    count: row.count,
    unread_count: row.unread_count,
  }));

  const highlights: MailDigestMessageItem[] = rowsOf<HighlightRow>(highlightResult).map((row) => ({
    subject: bound(row.subject, MAIL_DIGEST_SUBJECT_MAX_CHARS),
    from_display_name: bound(row.from_display_name, MAIL_DIGEST_DISPLAY_NAME_MAX_CHARS),
    received_at: new Date(row.internal_date).toISOString(),
    unread: row.unread,
    important: row.important,
    starred: row.starred,
    category: toCategory(row.category),
  }));

  let input: MailDigestInput = {
    generated_at: params.now.toISOString(),
    tz: params.timezone,
    local_date: localDate,
    window_hours: windowHours,
    summary: {
      mailbox_count: summary.mailbox_count,
      total_count: summary.total_count,
      unread_count: summary.unread_count,
      important_count: summary.important_count,
      starred_count: summary.starred_count,
      thread_count: summary.thread_count,
      sender_count: summary.sender_count,
    },
    categories: { items: categories, total: categories.length },
    senders: { items: senders, total: summary.sender_count },
    highlights: { items: highlights, total: summary.total_count },
  };

  input = applyDropLadder(input);
  return { input, localDate, empty: summary.total_count === 0 };
}

/** Serialized size, measured exactly as the prompt will serialize it. */
export function measureMailDigestInput(input: MailDigestInput): number {
  return JSON.stringify(input, null, 2).length;
}

/**
 * The drop ladder.
 *
 * ===========================================================================
 * MAIL IS THE FIRST THING DROPPED, AND THE ORDER IS AN ADR-054 REQUIREMENT.
 * ===========================================================================
 *
 * The threat is specific: an attacker chooses how long their own subject lines
 * are, so without an ordering rule a flood of long subjects would push the
 * DETERMINISTIC content out of a bounded payload -- ADR-054's "a third party
 * could evict the user's own agenda from their own digest".
 *
 * The rungs, in order:
 *
 *   1. HIGHLIGHTS -- the densest attacker-authored section, carrying both
 *      untrusted fields once per item. Trimmed one whole item at a time.
 *   2. SENDERS -- one untrusted field per item.
 *   3. CATEGORIES -- closed vocabulary, no attacker-authored text at all, and
 *      at most six tiny rows. Included for completeness; in practice it can
 *      only be reached by a bug, since rungs 1 and 2 free far more.
 *
 * NEVER DROPPED: `summary` and the envelope. Those are the deterministic
 * first-party counts, and preserving them is what makes the guarantee real --
 * under an adversarial flood the digest still states how much mail arrived, how
 * much is unread and across how many mailboxes, even with every subject gone.
 *
 * WHOLE ITEMS, NEVER SLICED JSON. Slicing a serialized document produces an
 * invalid one; and `total` is never touched, so a trimmed section still tells
 * the model how much exists ("12 unread, 3 shown") and the digest stays honest
 * rather than quietly shrinking reality.
 *
 * SCOPE NOTE, stated rather than implied: this payload contains no tasks,
 * projects or events, so "email volume must not hide tasks/projects" cannot be
 * violated here -- there is nothing of the user's own to evict. The place that
 * risk becomes real is a future `BriefInput` carrying mail, which ADR-054 makes
 * a separately-approved decision and which this checkpoint deliberately does not
 * make. The ordering below is written so that decision inherits a ladder that
 * already yields mail first.
 */
export function applyDropLadder(original: MailDigestInput): MailDigestInput {
  let input = original;
  let size = measureMailDigestInput(input);
  if (size <= MAX_MAIL_DIGEST_INPUT_CHARS) return input;

  // Rung 1: highlights, one whole item at a time.
  while (size > MAX_MAIL_DIGEST_INPUT_CHARS && input.highlights.items.length > 0) {
    input = {
      ...input,
      highlights: {
        ...input.highlights,
        items: input.highlights.items.slice(0, input.highlights.items.length - 1),
      },
    };
    size = measureMailDigestInput(input);
  }

  // Rung 2: senders.
  while (size > MAX_MAIL_DIGEST_INPUT_CHARS && input.senders.items.length > 0) {
    input = {
      ...input,
      senders: {
        ...input.senders,
        items: input.senders.items.slice(0, input.senders.items.length - 1),
      },
    };
    size = measureMailDigestInput(input);
  }

  // Rung 3: categories.
  if (size > MAX_MAIL_DIGEST_INPUT_CHARS) {
    input = { ...input, categories: { ...input.categories, items: [] } };
    size = measureMailDigestInput(input);
  }

  if (size > MAX_MAIL_DIGEST_INPUT_CHARS) {
    // Genuinely unreachable: every list is empty and the remaining envelope is
    // seven integers, three short strings and a number. Reaching here means a
    // constant was changed without re-checking, which is a programmer error
    // rather than a runtime condition to degrade from -- and degrading silently
    // would mean sending an over-budget prompt, which is the one outcome the
    // ceiling exists to prevent.
    throw new Error(
      `mail digest input still exceeds MAX_MAIL_DIGEST_INPUT_CHARS (${MAX_MAIL_DIGEST_INPUT_CHARS}) with every item list emptied: measured ${size} chars`,
    );
  }

  return input;
}
