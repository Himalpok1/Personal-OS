import { mailMessages, type Db } from "@personal-os/db";
import type { MailMessageRow } from "@personal-os/mail-providers";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

// Hash-gated persistence for mail metadata rows.
//
// ============================================================================
// THE PROPERTY THIS FILE EXISTS TO GUARANTEE:
//   TWO IDENTICAL CONSECUTIVE SYNCS WRITE ZERO ROWS.
// ============================================================================
//
// Not "write the same values twice" -- literally zero writes. The reasons are
// health/persist.ts's, and they hold here:
//
//   1. `updated_at` is the only signal for "when did this actually change".
//      A sync that rewrites every row with identical content every fifteen
//      minutes destroys it.
//   2. Rewriting a mailbox's recent window on every tick is dead tuples for
//      autovacuum on a mini PC, forever, for nothing.
//   3. It is the property that makes an idempotency test possible at all. If
//      re-running a sync is observably a no-op, a test can assert `ctid`/`xmin`
//      equality and catch any future change that starts writing spuriously.
//
// The mechanism is a WHERE clause on the ON CONFLICT DO UPDATE:
//
//   on conflict (...) do update set ..., updated_at = now()
//   where mail_messages.content_hash is distinct from excluded.content_hash
//
// When that predicate is false the row is not written AT ALL -- no new tuple,
// no updated_at bump -- and the statement returns NO ROW for it. That absence
// is how "unchanged" is counted: a returned row means something was written,
// and `xmax = 0` on it distinguishes an insert from an update.
//
// `is distinct from`, not `<>`: `<>` yields NULL rather than false against a
// NULL and would silently stop updating.

/** What a hash-gated upsert actually did. */
export interface MailUpsertCounts {
  inserted: number;
  updated: number;
  /** Present in the payload, byte-identical to what is stored, not written. */
  unchanged: number;
  /**
   * Rows dropped because two fetched records shared one identity key.
   *
   * Counted rather than left to the database: a multi-row INSERT ... ON
   * CONFLICT raises `cannot affect row a second time` if the same key appears
   * twice in one statement. That is a real hazard here rather than a
   * theoretical one -- a single `history.list` delta legitimately reports the
   * same message id several times (added, then labelled, then unlabelled), so
   * a de-duplication step is required, not merely prudent.
   */
  collapsed: number;
}

const EMPTY: MailUpsertCounts = { inserted: 0, updated: 0, unchanged: 0, collapsed: 0 };

/**
 * `(xmax = 0)` is Postgres's own way of asking "was this returned row an
 * INSERT?".
 *
 * On a plain insert the tuple's xmax is 0; on an ON CONFLICT DO UPDATE the
 * conflicting tuple was locked by the speculative insertion, so xmax carries
 * that transaction id. It is the only in-statement discriminator available --
 * and it is why idempotency tests compare `ctid`/`xmin`/`updated_at` across
 * runs but NEVER `xmax`: the speculative lock sets xmax IN PLACE on rows merely
 * examined, so an unchanged row's xmax legitimately differs run to run.
 */
const WAS_INSERT = sql<boolean>`(xmax = 0)`;

export interface UpsertMailMessagesParams {
  connectionId: string;
  rows: readonly MailMessageRow[];
}

/**
 * Hash-gated upsert of message metadata.
 *
 * NOTE `deletedAt: null` IN THE UPDATE SET. A message the provider starts
 * returning again has its tombstone cleared, which is what makes the marker
 * reversible in both directions (the ADR-047a shape). It is inside the
 * hash-gated branch, so a re-fetch of an unchanged, non-deleted message still
 * writes nothing -- but a message whose content changed at all, or that
 * reappears with any difference, is un-tombstoned as part of the same write.
 */
export async function upsertMailMessages(
  db: Db,
  params: UpsertMailMessagesParams,
): Promise<MailUpsertCounts> {
  if (params.rows.length === 0) return { ...EMPTY };

  // Last-wins de-duplication on the conflict key. See MailUpsertCounts.collapsed.
  const byExternalId = new Map<string, MailMessageRow>();
  let collapsed = 0;
  for (const row of params.rows) {
    if (byExternalId.has(row.externalId)) collapsed += 1;
    byExternalId.set(row.externalId, row);
  }

  const values = [...byExternalId.values()].map((row) => ({
    connectionId: params.connectionId,
    externalId: row.externalId,
    threadId: row.threadId,
    internalDate: row.internalDate,
    fromAddress: row.fromAddress,
    fromDomain: row.fromDomain,
    fromDisplayName: row.fromDisplayName,
    subject: row.subject,
    providerLabels: row.providerLabels,
    hasAttachment: row.hasAttachment,
    sizeEstimate: row.sizeEstimate,
    contentHash: row.contentHash,
  }));

  const returned = await db
    .insert(mailMessages)
    .values(values)
    .onConflictDoUpdate({
      target: [mailMessages.connectionId, mailMessages.externalId],
      set: {
        threadId: sql`excluded.thread_id`,
        internalDate: sql`excluded.internal_date`,
        fromAddress: sql`excluded.from_address`,
        fromDomain: sql`excluded.from_domain`,
        fromDisplayName: sql`excluded.from_display_name`,
        subject: sql`excluded.subject`,
        providerLabels: sql`excluded.provider_labels`,
        hasAttachment: sql`excluded.has_attachment`,
        sizeEstimate: sql`excluded.size_estimate`,
        contentHash: sql`excluded.content_hash`,
        // Reappearance clears the tombstone. See the doc comment.
        deletedAt: sql`null`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${mailMessages.contentHash} is distinct from excluded.content_hash
        or ${mailMessages.deletedAt} is not null`,
    })
    .returning({ inserted: WAS_INSERT });

  const inserted = returned.filter((r) => r.inserted).length;
  return {
    inserted,
    updated: returned.length - inserted,
    unchanged: values.length - returned.length,
    collapsed,
  };
}

export interface TombstoneMailMessagesParams {
  connectionId: string;
  /** Ids the provider EXPLICITLY reported as deleted. */
  externalIds: readonly string[];
}

/**
 * Marks messages the provider says are gone.
 *
 * ===========================================================================
 * THIS IS AN EXPLICIT-SIGNAL TOMBSTONE, NOT AN ABSENCE SWEEP, AND THAT IS THE
 * WHOLE REASON MAIL AVOIDS THE HAZARD ADR-047a HAD TO LEGISLATE AROUND.
 * ===========================================================================
 *
 * Health tombstones by ABSENCE: it fetches a window, collects the keys it saw,
 * and marks everything else in that window deleted. That is why ADR-047a had to
 * forbid it on an empty result set -- `x <> ALL('{}'::text[])` is TRUE in
 * Postgres, so an ungated empty sweep would tombstone an entire window -- and
 * why it is restricted to stable provider-named rows and to authoritative,
 * fully-fetched passes.
 *
 * Gmail does not require any of that machinery, because `history.list` reports
 * `messagesDeleted` as an EVENT. We tombstone exactly the ids the provider
 * named. There is no window, no seen-key set, no authority model, and no way
 * for an empty response to mean anything other than "nothing was deleted".
 *
 * Consequences worth stating rather than leaving implicit:
 *   * a deletion that happened before the stored cursor is never seen, and no
 *     later pass will discover it -- absence is not evidence here either way;
 *   * a bounded full resync does NOT tombstone, because listing is not a
 *     deletion signal;
 *   * and the marker is soft and reversible: `upsertMailMessages` clears
 *     `deleted_at` on reappearance. Nothing is pruned HERE. ADR-054's
 *     permitted-and-required prune exists since Checkpoint 8.6C as the
 *     worker's daily `retention.cleanup` job (jobs/retention-cleanup.ts), and
 *     it is a separate axis: it deletes on the age of `internal_date` alone,
 *     tombstoned or not, so "retained indefinitely" stopped being true the
 *     moment that job shipped -- a tombstoned row lives until it ages out.
 */
export async function tombstoneMailMessages(
  db: Db,
  params: TombstoneMailMessagesParams,
  now: Date = new Date(),
): Promise<number> {
  // Guarded even though the signal is explicit. An empty id list producing an
  // unbounded UPDATE is the exact shape of the ADR-047a hazard, and the guard
  // costs nothing.
  if (params.externalIds.length === 0) return 0;

  const unique = [...new Set(params.externalIds)];

  const updated = await db
    .update(mailMessages)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(mailMessages.connectionId, params.connectionId),
        inArray(mailMessages.externalId, unique),
        // Already-tombstoned rows are left alone, so a replayed delta does not
        // move `deleted_at` forward and does not count as work done.
        isNull(mailMessages.deletedAt),
      ),
    )
    .returning({ id: mailMessages.id });

  return updated.length;
}

/** Live (non-tombstoned) message count for a connection. Used by tests and audits. */
export async function countLiveMailMessages(db: Db, connectionId: string): Promise<number> {
  const rows = await db
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(and(eq(mailMessages.connectionId, connectionId), isNull(mailMessages.deletedAt)));
  return rows.length;
}

/** Tombstoned message count for a connection. Used by tests and audits. */
export async function countTombstonedMailMessages(db: Db, connectionId: string): Promise<number> {
  const rows = await db
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(and(eq(mailMessages.connectionId, connectionId), isNotNull(mailMessages.deletedAt)));
  return rows.length;
}
