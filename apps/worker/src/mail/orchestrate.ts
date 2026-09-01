import { mailConnections, mailSyncCursors, type Db } from "@personal-os/db";
import {
  classifyMailFault,
  createMailLimiter,
  GMAIL_HISTORY_TYPES,
  GMAIL_MAILBOX_SCOPE,
  GMAIL_METADATA_HEADERS,
  GMAIL_SYSTEM_LABELS,
  GMAIL_SYNC_BOUNDS,
  MailPassBudgetExhaustedError,
  translateMailMessage,
  type MailClient,
  type MailFault,
  type MailHistoryRecord,
  type MailLimiter,
  type MailMessageRow,
} from "@personal-os/mail-providers";
import { and, eq } from "drizzle-orm";
import type { MailSyncErrorCode } from "@personal-os/schema";
import type { PgBoss } from "pg-boss";
import { env } from "../env.js";
import { errorToken, log } from "../logger.js";
import { BREAKER_SKIP_CLASS, evaluateMailBreaker } from "./breaker.js";
import { withMailConnectionLock } from "./lock.js";
import { tombstoneMailMessages, upsertMailMessages, type MailUpsertCounts } from "./persist.js";
import { closeMailSyncRun, openMailSyncRun } from "./run.js";
import {
  clearMailConnectionError,
  createMailRefreshBudget,
  MailAuthPermanentError,
  MailNoRefreshTokenError,
  MailNotConfiguredError,
  MailRefreshBudgetExhaustedError,
  recordMailConnectionError,
  resolveFreshMailAccessToken,
  type MailRefreshBudget,
  type MailRefreshFn,
} from "./token.js";

// The mail sync pass.
//
// ===========================================================================
// THE ALGORITHM, AND THE FOUR THINGS CHECKPOINT 7.2P PROVED ABOUT IT
// ===========================================================================
//
//   connection -> cursor -> history.list -> message references
//              -> messages.get(format=metadata) -> persist -> advance cursor
//
// 7.2P ran fifteen live read-only requests against the real API to establish
// what that pipeline may assume. Four findings are encoded here rather than
// discovered later:
//
//  1. `format=metadata` is ALWAYS sent. Gmail's default is FULL and FULL is
//     rejected under this scope, so a client that merely omitted the parameter
//     would 403 on every single message fetch. The client hardcodes it and
//     offers no `format` field, so this is structural rather than remembered.
//  2. AN EMPTY DELTA OMITS THE `history` KEY ENTIRELY -- it does not return an
//     empty array. `response.history.length` would crash. Every read of it goes
//     through `??  []`.
//  3. A `history.list` 404 is cursor expiry and drives `needs_full_resync`.
//     Nothing else in the flow may interpret a 404 that way, which is why
//     `classifyMailFault` takes the operation.
//  4. Listing returns REFERENCES ONLY, so metadata costs one request per
//     message. Everything about the bounds below exists because of that N+1.
//
// ---------------------------------------------------------------------------
// WHAT THIS PASS DELIBERATELY DOES NOT DO
//
// No digest. No notification. No monitoring. No mail action of any kind: the
// client interface has no send, reply, modify, trash or label method, so ADR-052
// is a type here rather than a policy. Nothing is written to `inbox_items`.

/** Where a fetched id came from, so a deleted message is never re-fetched. */
interface DeltaIds {
  fetch: string[];
  deleted: string[];
}

export interface MailSyncJobData {
  connectionId: string;
  /** Reserved for a manual route (Checkpoint 7.6). Unused today. */
  trigger?: "cron" | "manual";
}

export interface MailSyncDeps {
  db: Db;
  client: MailClient;
  /** Best-effort only, and unused in 7.3 -- alerting is ADR-055/Checkpoint 7.5. */
  boss?: PgBoss | null;
  now?: () => Date;
  limiterFactory?: () => MailLimiter;
  refresh?: MailRefreshFn;
}

export interface MailPassResult {
  skipped: string | null;
  runsWritten: number;
  /** `messages.get` calls that returned a payload. */
  messagesFetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  tombstoned: number;
  rejected: number;
  cursorAdvanced: boolean;
  /** A bounded full resync ran, either as a first sync or after cursor expiry. */
  fullResync: boolean;
  /** A bound stopped the pass early. The next tick resumes from the cursor. */
  truncated: boolean;
  failureClass: string | null;
}

const EMPTY_RESULT: MailPassResult = {
  skipped: null,
  runsWritten: 0,
  messagesFetched: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  tombstoned: 0,
  rejected: 0,
  cursorAdvanced: false,
  fullResync: false,
  truncated: false,
  failureClass: null,
};

function addCounts(result: MailPassResult, counts: MailUpsertCounts): void {
  result.inserted += counts.inserted;
  result.updated += counts.updated;
  result.unchanged += counts.unchanged;
}

/**
 * Collects the message ids one history page's records refer to, bounded.
 *
 * `messagesDeleted` is subtracted from the fetch set rather than merely added
 * to the delete set: a message added and then deleted within one delta would
 * otherwise be fetched, 404, and waste a request proving what the delta already
 * said. Tested directly.
 *
 * The provider also returns a `messages` array alongside the typed change
 * arrays (observed in 7.2P). It is deliberately ignored: it says which messages
 * a record touches without saying HOW, and acting on it would mean re-fetching
 * on changes we do not model.
 */
export function collectDeltaIds(records: readonly MailHistoryRecord[]): DeltaIds {
  const fetch = new Set<string>();
  const deleted = new Set<string>();

  for (const record of records) {
    for (const entry of record.messagesAdded ?? []) {
      if (entry?.message?.id) fetch.add(entry.message.id);
    }
    // Label changes matter because provider_labels is what a digest triages on.
    // Without these two, stored labels would stay frozen at whatever they were
    // when the message first arrived -- a message read, archived and starred
    // would still read UNREAD/INBOX forever.
    for (const entry of record.labelsAdded ?? []) {
      if (entry?.message?.id) fetch.add(entry.message.id);
    }
    for (const entry of record.labelsRemoved ?? []) {
      if (entry?.message?.id) fetch.add(entry.message.id);
    }
    for (const entry of record.messagesDeleted ?? []) {
      if (entry?.message?.id) deleted.add(entry.message.id);
    }
  }

  for (const id of deleted) fetch.delete(id);
  return { fetch: [...fetch], deleted: [...deleted] };
}

interface FetchOutcome {
  rows: MailMessageRow[];
  rejected: number;
  /** Ids the provider no longer has. Benign: gone between listing and fetching. */
  missing: number;
  requests: number;
}

/**
 * Fetches metadata for each id, serialized through the limiter.
 *
 * The limiter is the concurrency bound: every request goes through one
 * serialized gate, so this loop is provably one-request-at-a-time however many
 * ids it is handed. There is no separate batching machinery because there is
 * nothing to batch -- Gmail has no bulk metadata endpoint under this scope.
 *
 * A 404 here is NOT a failure: the message was deleted between being listed and
 * being fetched, which is routine in a live mailbox. It is counted and skipped.
 * Every other provider error aborts the pass, because a 401 or 403 will apply
 * just as much to the next four hundred ids.
 */
async function fetchMetadata(
  client: MailClient,
  limiter: MailLimiter,
  accessToken: string,
  ids: readonly string[],
): Promise<FetchOutcome> {
  const rows: MailMessageRow[] = [];
  let rejected = 0;
  let missing = 0;
  let requests = 0;

  for (const id of ids) {
    let payload;
    try {
      requests += 1;
      payload = await limiter.run((signal) =>
        client.getMessageMetadata(
          accessToken,
          { id, metadataHeaders: GMAIL_METADATA_HEADERS },
          signal,
        ),
      );
    } catch (err) {
      const fault = classifyMailFault(err, "get_message");
      if (fault.code === "not_found") {
        missing += 1;
        continue;
      }
      throw err;
    }

    const translated = translateMailMessage(payload);
    if (!translated.ok) {
      // The rejection carries a key path and a typeof, never a value -- so this
      // log line cannot contain a subject even in principle.
      rejected += 1;
      log.warn("mail.sync.message_rejected", {
        keyPath: translated.rejection.keyPath,
        received: translated.rejection.received,
      });
      continue;
    }
    rows.push(translated.row);
  }

  return { rows, rejected, missing, requests };
}

interface CursorRow {
  id: string;
  cursorValue: string | null;
  needsFullResync: boolean;
}

/**
 * Reads, or lazily creates, the cursor row for this connection's single scope.
 *
 * Created HERE rather than by the API's connect path on purpose: a cursor is
 * sync state, and the process that owns syncing owns it. A row created at
 * connect time would also have to be kept in step with a disconnect/reconnect,
 * which is exactly the kind of second-writer coupling the API/worker split
 * exists to avoid. `needs_full_resync` defaults TRUE, so a freshly created row
 * takes the bounded-full-sync path on its first pass without any special case.
 */
async function ensureCursor(db: Db, connectionId: string): Promise<CursorRow> {
  const [existing] = await db
    .select({
      id: mailSyncCursors.id,
      cursorValue: mailSyncCursors.cursorValue,
      needsFullResync: mailSyncCursors.needsFullResync,
    })
    .from(mailSyncCursors)
    .where(
      and(
        eq(mailSyncCursors.connectionId, connectionId),
        eq(mailSyncCursors.scopeKey, GMAIL_MAILBOX_SCOPE),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(mailSyncCursors)
    .values({
      connectionId,
      scopeKey: GMAIL_MAILBOX_SCOPE,
      cursorKind: "gmail_history_id",
      cursorValue: null,
      needsFullResync: true,
    })
    .onConflictDoNothing({
      target: [mailSyncCursors.connectionId, mailSyncCursors.scopeKey],
    })
    .returning({
      id: mailSyncCursors.id,
      cursorValue: mailSyncCursors.cursorValue,
      needsFullResync: mailSyncCursors.needsFullResync,
    });
  if (created) return created;

  // `onConflictDoNothing` returns nothing when another writer won the race.
  // Re-reading is the correct resolution, and it cannot loop: the row now
  // exists.
  const [raced] = await db
    .select({
      id: mailSyncCursors.id,
      cursorValue: mailSyncCursors.cursorValue,
      needsFullResync: mailSyncCursors.needsFullResync,
    })
    .from(mailSyncCursors)
    .where(
      and(
        eq(mailSyncCursors.connectionId, connectionId),
        eq(mailSyncCursors.scopeKey, GMAIL_MAILBOX_SCOPE),
      ),
    )
    .limit(1);
  return raced!;
}

/**
 * Persists messages and moves the cursor IN ONE TRANSACTION.
 *
 * The atomicity is the point, not tidiness. A crash between the two would leave
 * a cursor pointing past messages that were never stored, and nothing would
 * ever go back for them -- silent, permanent data loss with no error anywhere.
 * Committing them together means a crash costs a replay, which persistence
 * absorbs idempotently.
 */
async function commitDelta(
  db: Db,
  params: {
    connectionId: string;
    cursorId: string;
    rows: readonly MailMessageRow[];
    deletedIds: readonly string[];
    cursorValue: string | null;
    needsFullResync: boolean;
    lastFullSyncAt?: Date;
    now: Date;
  },
): Promise<{ counts: MailUpsertCounts; tombstoned: number }> {
  let counts: MailUpsertCounts = { inserted: 0, updated: 0, unchanged: 0, collapsed: 0 };
  let tombstoned = 0;

  await db.transaction(async (txRaw) => {
    // The same `tx as unknown as Db` shape health/orchestrate.ts and
    // calendar-sync-calendar.ts both use: Drizzle's transaction type is
    // structurally compatible for every operation these helpers perform, and
    // threading the generic parameter through would buy nothing.
    const tx = txRaw as unknown as Db;

    if (params.rows.length > 0) {
      counts = await upsertMailMessages(tx, {
        connectionId: params.connectionId,
        rows: params.rows,
      });
    }
    if (params.deletedIds.length > 0) {
      tombstoned = await tombstoneMailMessages(
        tx,
        { connectionId: params.connectionId, externalIds: params.deletedIds },
        params.now,
      );
    }

    if (params.cursorValue !== null) {
      await tx
        .update(mailSyncCursors)
        .set({
          cursorValue: params.cursorValue,
          needsFullResync: params.needsFullResync,
          lastSuccessfulSyncAt: params.now,
          ...(params.lastFullSyncAt ? { lastFullSyncAt: params.lastFullSyncAt } : {}),
          updatedAt: params.now,
        })
        .where(eq(mailSyncCursors.id, params.cursorId));
    }
  });

  return { counts, tombstoned };
}

/** Marks the cursor as needing a bounded full resync. Its own transaction. */
async function markNeedsFullResync(db: Db, cursorId: string, now: Date): Promise<void> {
  await db
    .update(mailSyncCursors)
    .set({ needsFullResync: true, updatedAt: now })
    .where(eq(mailSyncCursors.id, cursorId));
}

// ---------------------------------------------------------------------------
// Incremental
// ---------------------------------------------------------------------------

interface IncrementalOutcome {
  ids: DeltaIds;
  /** The cursor to store, or null when nothing may be stored. */
  nextCursor: string | null;
  pages: number;
  requests: number;
  truncated: boolean;
  /** Set when the provider reported the stored cursor as expired. */
  fault: MailFault | null;
}

/**
 * Walks `history.list` from the stored cursor.
 *
 * CURSOR ADVANCEMENT IS THE SUBTLE PART, and it has three cases:
 *
 *   * COMPLETE WALK -- no page token left and every record processed. The
 *     cursor becomes the response's own `historyId`, which is the mailbox's
 *     current position and is what makes the next pass a true no-op.
 *   * TRUNCATED -- a bound stopped us mid-walk. The cursor becomes the ID OF
 *     THE LAST RECORD PROCESSED IN FULL, never the response's historyId (which
 *     would skip everything we did not read) and never left unmoved (which
 *     would replay the same prefix every tick and never reach the tail --
 *     a livelock, not merely inefficiency). A history record's `id` is itself a
 *     cursor value, so resuming re-delivers at most that one record.
 *   * NOTHING PROCESSED -- no cursor is stored at all.
 */
async function walkHistory(
  client: MailClient,
  limiter: MailLimiter,
  accessToken: string,
  startHistoryId: string,
): Promise<IncrementalOutcome> {
  const records: MailHistoryRecord[] = [];
  // Running membership, kept in step with `records`, so the per-record bound
  // check is O(1) rather than O(n).
  const seenFetch = new Set<string>();
  const seenDeleted = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;
  let requests = 0;
  let truncated = false;
  let lastCompleteRecordId: string | null = null;
  let finalHistoryId: string | null;

  for (;;) {
    let response;
    try {
      requests += 1;
      response = await limiter.run((signal) =>
        client.listHistory(
          accessToken,
          {
            startHistoryId,
            historyTypes: GMAIL_HISTORY_TYPES,
            maxResults: GMAIL_SYNC_BOUNDS.pageSize,
            ...(pageToken !== undefined ? { pageToken } : {}),
          },
          signal,
        ),
      );
    } catch (err) {
      const fault = classifyMailFault(err, "list_history");
      if (fault.cursorExpired) {
        return { ids: collectDeltaIds([]), nextCursor: null, pages, requests, truncated, fault };
      }
      throw err;
    }
    pages += 1;

    // FINDING 2 FROM 7.2P: an empty delta omits the key entirely rather than
    // returning []. `response.history.length` would throw here on the single
    // most common response in a quiet mailbox.
    const page = response.history ?? [];

    for (const record of page) {
      // Projected incrementally rather than by re-collecting the whole prefix:
      // re-running collectDeltaIds per record is quadratic, and at the 500-id
      // cap that is 125k set operations for no benefit.
      const projected = collectDeltaIds([record]);
      let wouldAdd = 0;
      for (const id of projected.fetch) {
        if (!seenFetch.has(id) && !seenDeleted.has(id)) wouldAdd += 1;
      }

      // Always process at least one record, or a single record larger than the
      // cap would stall the cursor forever -- a livelock, not inefficiency.
      if (records.length > 0 && seenFetch.size + wouldAdd > GMAIL_SYNC_BOUNDS.maxMessagesPerPass) {
        truncated = true;
        break;
      }

      records.push(record);
      for (const id of projected.fetch) if (!seenDeleted.has(id)) seenFetch.add(id);
      for (const id of projected.deleted) {
        seenDeleted.add(id);
        // A message added earlier in this same delta and deleted now must not
        // be fetched: it would 404 and waste a request proving what the delta
        // already said.
        seenFetch.delete(id);
      }
      if (typeof record.id === "string" && record.id !== "") lastCompleteRecordId = record.id;
    }

    finalHistoryId = response.historyId;
    if (truncated) break;

    pageToken = response.nextPageToken;
    if (pageToken === undefined) break;
    if (pages >= GMAIL_SYNC_BOUNDS.maxHistoryPages) {
      truncated = true;
      break;
    }
  }

  const nextCursor = truncated ? lastCompleteRecordId : (finalHistoryId ?? null);
  return { ids: collectDeltaIds(records), nextCursor, pages, requests, truncated, fault: null };
}

// ---------------------------------------------------------------------------
// Bounded full resync
// ---------------------------------------------------------------------------

interface FullSyncOutcome {
  ids: string[];
  /** Captured BEFORE enumeration. See the doc comment. */
  cursor: string;
  pages: number;
  requests: number;
  truncated: boolean;
}

/**
 * The bounded full resync: a first sync, or the recovery a cursor expiry
 * escalates to.
 *
 * ===========================================================================
 * THE CURSOR IS CAPTURED BEFORE ENUMERATION, AND THE ORDER IS LOAD-BEARING.
 * ===========================================================================
 *
 * `users.getProfile` is called FIRST, and its `historyId` is what the pass
 * stores when it finishes. Capturing it AFTER listing would open a window: any
 * message arriving during enumeration would be older than the stored cursor and
 * newer than the listing, so no incremental pass would ever see it and no full
 * resync would ever go looking. It would be gone, silently, forever.
 *
 * Capturing first has the opposite error, which is harmless: messages arriving
 * during enumeration are BOTH listed and replayed by the first incremental
 * pass. Persistence is idempotent, so a replay costs one unchanged row.
 *
 * ---------------------------------------------------------------------------
 * "BOUNDED" IS AN HONEST WORD HERE, NOT A HEDGE.
 *
 * This scopes to INBOX and stops after `maxFullSyncPages` pages. It recovers
 * FORWARD INCREMENTAL CAPABILITY -- which is the whole job of a resync -- and it
 * explicitly does NOT guarantee complete history. Gmail lists newest-first, so
 * what is dropped is the older tail. Reaching further back is a `backfill`,
 * which ADR-053 makes a distinct kind for exactly this reason, and which no
 * checkpoint has yet built.
 *
 * `q` is not used, and could not be: it is rejected under `gmail.metadata`
 * (7.2P). Label scoping is the substitute, and INBOX is the label the digest
 * cares about.
 */
async function boundedFullSync(
  client: MailClient,
  limiter: MailLimiter,
  accessToken: string,
): Promise<FullSyncOutcome> {
  let requests = 1;
  const profile = await limiter.run((signal) => client.getProfile(accessToken, signal));
  const cursor = profile.historyId;

  const ids: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  let truncated = false;

  for (;;) {
    requests += 1;
    const response = await limiter.run((signal) =>
      client.listMessages(
        accessToken,
        {
          labelIds: [GMAIL_SYSTEM_LABELS.INBOX],
          maxResults: GMAIL_SYNC_BOUNDS.pageSize,
          ...(pageToken !== undefined ? { pageToken } : {}),
        },
        signal,
      ),
    );
    pages += 1;

    for (const ref of response.messages ?? []) {
      if (ids.length >= GMAIL_SYNC_BOUNDS.maxMessagesPerPass) {
        truncated = true;
        break;
      }
      if (ref?.id) ids.push(ref.id);
    }
    if (truncated) break;

    pageToken = response.nextPageToken;
    if (pageToken === undefined) break;
    if (pages >= GMAIL_SYNC_BOUNDS.maxFullSyncPages) {
      truncated = true;
      break;
    }
  }

  return { ids, cursor, pages, requests, truncated };
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export async function runMailConnectionSync(
  deps: MailSyncDeps,
  data: MailSyncJobData,
): Promise<MailPassResult> {
  const outcome = await withMailConnectionLock(deps.db, data.connectionId, () =>
    runLockedPass(deps, data),
  );
  if (!outcome.acquired) {
    // NO RUN ROW IS WRITTEN HERE, deliberately. The other pass is covering the
    // same cursor, so the honest record is no record -- and a skipped row would
    // be noise in an audit trail whose whole value is that a row means an
    // attempt was made.
    log.info("mail.sync.skipped", { connectionId: data.connectionId, reason: "lock_not_acquired" });
    return { ...EMPTY_RESULT, skipped: "lock_not_acquired" };
  }
  return outcome.result;
}

async function runLockedPass(deps: MailSyncDeps, data: MailSyncJobData): Promise<MailPassResult> {
  const result: MailPassResult = { ...EMPTY_RESULT };
  const now = deps.now ? deps.now() : new Date();

  // Re-read INSIDE the lock. Between enqueue and execution the user may have
  // disconnected, the grant may have died, or another pass may have marked the
  // connection needs_reauth -- and acting on the payload's stale view is how a
  // revoked connection keeps getting hammered.
  const [connection] = await deps.db
    .select()
    .from(mailConnections)
    .where(eq(mailConnections.id, data.connectionId))
    .limit(1);

  if (!connection) return { ...result, skipped: "connection_not_found" };
  if (connection.status !== "active") {
    log.info("mail.sync.skipped", {
      connectionId: connection.id,
      reason: "connection_not_active",
      status: connection.status,
    });
    return { ...result, skipped: "connection_not_active" };
  }

  if (env.GMAIL_OAUTH_CLIENT_ID === undefined || env.GMAIL_OAUTH_CLIENT_SECRET === undefined) {
    // Checked before any run row is opened, so an unconfigured deployment
    // produces one log line per tick rather than a table full of failed runs.
    log.warn("mail.sync.not_configured", { connectionId: connection.id });
    return { ...result, skipped: "not_configured" };
  }

  const cursor = await ensureCursor(deps.db, connection.id);

  const breaker = await evaluateMailBreaker(
    deps.db,
    { connectionId: connection.id, scopeKey: GMAIL_MAILBOX_SCOPE },
    now,
  );
  if (breaker.open) {
    // A skipped run row IS written here, unlike the lock case: this is a
    // decision the system made about itself and the audit trail should say so.
    // The breaker excludes `skipped` rows from its own window precisely so that
    // writing this cannot close the breaker that produced it.
    const runId = await openMailSyncRun(deps.db, {
      connectionId: connection.id,
      cursorId: cursor.id,
      scopeKey: GMAIL_MAILBOX_SCOPE,
      kind: "incremental",
      startedAt: now,
    });
    await closeMailSyncRun(deps.db, runId, {
      status: "skipped",
      failureClass: BREAKER_SKIP_CLASS,
      finishedAt: now,
    });
    log.warn("mail.sync.breaker_open", {
      connectionId: connection.id,
      failureClass: breaker.failureClass,
    });
    return {
      ...result,
      runsWritten: 1,
      skipped: BREAKER_SKIP_CLASS,
      failureClass: BREAKER_SKIP_CLASS,
    };
  }
  if (breaker.probing) {
    log.info("mail.sync.breaker_probe", {
      connectionId: connection.id,
      failureClass: breaker.failureClass,
    });
  }

  const limiter = deps.limiterFactory
    ? deps.limiterFactory()
    : createMailLimiter({
        now: () => Date.now(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        random: () => Math.random(),
      });

  const budget = createMailRefreshBudget();

  let accessToken: string;
  try {
    accessToken = await resolveFreshMailAccessToken(deps.db, connection, budget, now, {
      ...(deps.refresh ? { refresh: deps.refresh } : {}),
    });
  } catch (err) {
    return await recordTokenFailure(deps, connection.id, cursor.id, err, now, result);
  }

  const wantsFullSync = cursor.needsFullResync || cursor.cursorValue === null;
  return wantsFullSync
    ? await runFullPass(deps, { connection, cursor, limiter, accessToken, now, result })
    : await runIncrementalPass(deps, {
        connection,
        cursor,
        limiter,
        accessToken,
        budget,
        now,
        result,
      });
}

/**
 * Converts a credential-resolution failure into durable state.
 *
 * Every branch RETURNS rather than throwing. A dead grant that escaped the
 * handler would become a pg-boss failure, and with a cron behind it, a retry
 * storm against Google's token endpoint.
 */
async function recordTokenFailure(
  deps: MailSyncDeps,
  connectionId: string,
  cursorId: string,
  err: unknown,
  now: Date,
  result: MailPassResult,
): Promise<MailPassResult> {
  // Classified first, acted on second, so every branch is total and no branch
  // can leave a placeholder behind.
  const { failureClass, connectionCode } = classifyTokenFailure(err);

  // MailAuthPermanentError needs no write: resolveFreshMailAccessToken has
  // already marked the connection needs_reauth, which is the stronger statement.
  if (connectionCode !== null) {
    await recordMailConnectionError(deps.db, connectionId, connectionCode, now);
  }

  const runId = await openMailSyncRun(deps.db, {
    connectionId,
    cursorId,
    scopeKey: GMAIL_MAILBOX_SCOPE,
    kind: "incremental",
    startedAt: now,
  });
  await closeMailSyncRun(deps.db, runId, {
    status: "failed",
    failureClass,
    finishedAt: now,
  });
  log.warn("mail.sync.token_failed", { connectionId, failureClass, error: errorToken(err) });

  return { ...result, runsWritten: 1, skipped: failureClass, failureClass };
}

/**
 * Names a credential-resolution failure, and says whether it should also be
 * recorded on the connection.
 *
 * `connectionCode` is null for the two cases where writing would be wrong:
 * a deployment with no mail credentials at all (not this connection's fault,
 * and every connection would report it), and a permanently dead grant (already
 * recorded as `needs_reauth`, which says more than `last_sync_error` can).
 */
function classifyTokenFailure(err: unknown): {
  failureClass: string;
  connectionCode: MailSyncErrorCode | null;
} {
  if (err instanceof MailNotConfiguredError) {
    return { failureClass: "not_configured", connectionCode: null };
  }
  if (err instanceof MailNoRefreshTokenError) {
    // Unattended sync is impossible and no amount of retrying changes that, so
    // it is recorded where the user can see it.
    return { failureClass: "no_refresh_token", connectionCode: "auth_failed" };
  }
  if (err instanceof MailAuthPermanentError) {
    return { failureClass: "auth_permanent", connectionCode: null };
  }
  if (err instanceof MailRefreshBudgetExhaustedError) {
    return { failureClass: "auth_rejected", connectionCode: "auth_failed" };
  }
  const fault = classifyMailFault(err, "refresh_token");
  return { failureClass: fault.failureClass, connectionCode: fault.code };
}

interface PassContext {
  connection: typeof mailConnections.$inferSelect;
  cursor: CursorRow;
  limiter: MailLimiter;
  accessToken: string;
  now: Date;
  result: MailPassResult;
  budget?: MailRefreshBudget;
}

async function runIncrementalPass(deps: MailSyncDeps, ctx: PassContext): Promise<MailPassResult> {
  const result = { ...ctx.result };
  const runId = await openMailSyncRun(deps.db, {
    connectionId: ctx.connection.id,
    cursorId: ctx.cursor.id,
    scopeKey: GMAIL_MAILBOX_SCOPE,
    kind: "incremental",
    startedAt: ctx.now,
  });
  result.runsWritten += 1;

  let walk;
  try {
    walk = await walkHistory(deps.client, ctx.limiter, ctx.accessToken, ctx.cursor.cursorValue!);
  } catch (err) {
    return await failRun(deps, runId, err, "list_history", ctx, result);
  }

  if (walk.fault !== null) {
    // ADR-053's first-class transition. The incremental run is closed as failed
    // with `cursor_expired = true` -- so the escalation is VISIBLE in the audit
    // rather than inferrable -- the cursor is marked, and the SAME PASS then
    // performs the bounded full resync. Recovering on the next tick instead
    // would leave the mailbox un-synced for a whole cron interval for no reason.
    await closeMailSyncRun(deps.db, runId, {
      status: "failed",
      failureClass: walk.fault.failureClass,
      httpStatus: walk.fault.httpStatus,
      requestCount: walk.requests,
      pageCount: walk.pages,
      cursorExpired: true,
      finishedAt: ctx.now,
    });
    await markNeedsFullResync(deps.db, ctx.cursor.id, ctx.now);
    await recordMailConnectionError(deps.db, ctx.connection.id, "cursor_expired", ctx.now);
    log.warn("mail.sync.cursor_expired", { connectionId: ctx.connection.id });

    const escalated = await runFullPass(deps, {
      ...ctx,
      cursor: { ...ctx.cursor, cursorValue: null, needsFullResync: true },
      result,
      // ONE MILLISECOND LATER, and this is not cosmetic.
      //
      // A pass captures ONE effectiveNow and stamps every run row with it, so
      // an escalating pass writes two rows sharing an identical `started_at` --
      // and `order by started_at` then falls back to a random uuid. The audit
      // trail whose whole job is to make the cursor-expiry transition VISIBLE
      // would report the recovery before the failure roughly half the time.
      //
      // The same monotonic +1ms floor apps/api applies to `projects.updated_at`
      // for the same reason. A millisecond is immaterial to every logic that
      // reads `now`, and it makes the sequence unambiguous.
      now: new Date(ctx.now.getTime() + 1),
    });
    return { ...escalated, failureClass: walk.fault.failureClass };
  }

  let fetched: FetchOutcome;
  try {
    fetched = await fetchMetadata(deps.client, ctx.limiter, ctx.accessToken, walk.ids.fetch);
  } catch (err) {
    return await failRun(deps, runId, err, "get_message", ctx, result);
  }

  const { counts, tombstoned } = await commitDelta(deps.db, {
    connectionId: ctx.connection.id,
    cursorId: ctx.cursor.id,
    rows: fetched.rows,
    deletedIds: walk.ids.deleted,
    cursorValue: walk.nextCursor,
    needsFullResync: false,
    now: ctx.now,
  });

  addCounts(result, counts);
  result.tombstoned += tombstoned;
  result.rejected += fetched.rejected;
  result.messagesFetched += fetched.rows.length;
  result.cursorAdvanced = walk.nextCursor !== null;
  result.truncated = walk.truncated;

  await closeMailSyncRun(deps.db, runId, {
    status: "succeeded",
    requestCount: walk.requests + fetched.requests,
    pageCount: walk.pages,
    rowsInserted: counts.inserted,
    rowsUpdated: counts.updated,
    rowsUnchanged: counts.unchanged,
    rowsTombstoned: tombstoned,
    rowsRejected: fetched.rejected,
    finishedAt: ctx.now,
  });
  await clearMailConnectionError(deps.db, ctx.connection.id, ctx.now);

  log.info("mail.sync.finished", {
    connectionId: ctx.connection.id,
    kind: "incremental",
    inserted: counts.inserted,
    updated: counts.updated,
    unchanged: counts.unchanged,
    tombstoned,
    rejected: fetched.rejected,
    missing: fetched.missing,
    truncated: walk.truncated,
  });

  return result;
}

async function runFullPass(deps: MailSyncDeps, ctx: PassContext): Promise<MailPassResult> {
  const result = { ...ctx.result };
  const runId = await openMailSyncRun(deps.db, {
    connectionId: ctx.connection.id,
    cursorId: ctx.cursor.id,
    scopeKey: GMAIL_MAILBOX_SCOPE,
    kind: "full",
    startedAt: ctx.now,
  });
  result.runsWritten += 1;
  result.fullResync = true;

  let full: FullSyncOutcome;
  try {
    full = await boundedFullSync(deps.client, ctx.limiter, ctx.accessToken);
  } catch (err) {
    return await failRun(deps, runId, err, "list_messages", ctx, result);
  }

  let fetched: FetchOutcome;
  try {
    fetched = await fetchMetadata(deps.client, ctx.limiter, ctx.accessToken, full.ids);
  } catch (err) {
    return await failRun(deps, runId, err, "get_message", ctx, result);
  }

  const { counts } = await commitDelta(deps.db, {
    connectionId: ctx.connection.id,
    cursorId: ctx.cursor.id,
    rows: fetched.rows,
    // A LISTING IS NOT A DELETION SIGNAL. A full resync must never tombstone by
    // absence -- it is deliberately bounded, so "not listed" overwhelmingly
    // means "older than the bound", not "gone".
    deletedIds: [],
    cursorValue: full.cursor,
    needsFullResync: false,
    lastFullSyncAt: ctx.now,
    now: ctx.now,
  });

  addCounts(result, counts);
  result.rejected += fetched.rejected;
  result.messagesFetched += fetched.rows.length;
  result.cursorAdvanced = true;
  result.truncated = result.truncated || full.truncated;

  await closeMailSyncRun(deps.db, runId, {
    status: "succeeded",
    requestCount: full.requests + fetched.requests,
    pageCount: full.pages,
    rowsInserted: counts.inserted,
    rowsUpdated: counts.updated,
    rowsUnchanged: counts.unchanged,
    rowsRejected: fetched.rejected,
    finishedAt: ctx.now,
  });
  await clearMailConnectionError(deps.db, ctx.connection.id, ctx.now);

  log.info("mail.sync.finished", {
    connectionId: ctx.connection.id,
    kind: "full",
    inserted: counts.inserted,
    updated: counts.updated,
    unchanged: counts.unchanged,
    rejected: fetched.rejected,
    missing: fetched.missing,
    truncated: full.truncated,
  });

  return result;
}

/**
 * Closes a run as failed and records the classification on the connection.
 *
 * RETURNS rather than rethrows, for the same reason every other failure path
 * here does: throwing out of the handler makes pg-boss the retry mechanism, and
 * `retryLimit: 0` means it is not one. The cron tick is.
 */
async function failRun(
  deps: MailSyncDeps,
  runId: string,
  err: unknown,
  operation: Parameters<typeof classifyMailFault>[1],
  ctx: PassContext,
  result: MailPassResult,
): Promise<MailPassResult> {
  if (err instanceof MailPassBudgetExhaustedError) {
    // OUR scheduling decision, not a provider fault, and explicitly not
    // breaker-tripping: running out of wall clock says nothing about whether
    // the request was valid.
    await closeMailSyncRun(deps.db, runId, {
      status: "failed",
      failureClass: "pass_budget_exhausted",
      finishedAt: ctx.now,
    });
    log.warn("mail.sync.budget_exhausted", { connectionId: ctx.connection.id });
    return { ...result, failureClass: "pass_budget_exhausted", truncated: true };
  }

  const fault = classifyMailFault(err, operation);
  await closeMailSyncRun(deps.db, runId, {
    status: "failed",
    failureClass: fault.failureClass,
    httpStatus: fault.httpStatus,
    cursorExpired: fault.cursorExpired,
    finishedAt: ctx.now,
  });

  // The classification is recorded on the connection whatever it is: the closed
  // MailSyncErrorCode enum is exactly the vocabulary a user-facing card needs,
  // and hiding a transient one would make "rate limited" indistinguishable from
  // "working fine" on the Settings screen.
  await recordMailConnectionError(deps.db, ctx.connection.id, fault.code, ctx.now);

  log.warn("mail.sync.failed", {
    connectionId: ctx.connection.id,
    failureClass: fault.failureClass,
    httpStatus: fault.httpStatus,
    error: errorToken(err),
  });

  return { ...result, failureClass: fault.failureClass };
}

/**
 * Fans out one sync job per ACTIVE mail connection.
 *
 * `singletonKey` is the connection id, matching the queue's `stately` policy:
 * every trigger collapses onto one slot per connection, so a tick landing while
 * a pass is still running adds nothing rather than queueing a duplicate.
 */
export async function enqueueMailSyncForAllActiveConnections(
  db: Db,
  boss: PgBoss,
  queue: string,
): Promise<number> {
  const rows = await db
    .select({ id: mailConnections.id })
    .from(mailConnections)
    .where(eq(mailConnections.status, "active"));

  for (const row of rows) {
    await boss.send(queue, { connectionId: row.id }, { singletonKey: row.id });
  }
  return rows.length;
}
