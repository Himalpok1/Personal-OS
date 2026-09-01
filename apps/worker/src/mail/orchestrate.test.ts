import { mailConnections, mailMessages, mailSyncRuns, type Db } from "@personal-os/db";
import {
  createFakeMailClient,
  createMailLimiter,
  fakeMessage,
  GmailApiError,
  GMAIL_SYNC_BOUNDS,
  type FakeMailClient,
  type MailHistoryRecord,
  type MailLimiter,
} from "@personal-os/mail-providers";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { readMailCursor, seedMailConnection, seedMailCursor } from "../test/mail-fixtures.js";
import { collectDeltaIds, runMailConnectionSync } from "./orchestrate.js";

const db: Db = buildTestDb();
let client: FakeMailClient;

const NOW = new Date("2026-09-01T12:00:00.000Z");

/**
 * A limiter with the gate disabled and no retries.
 *
 * `qps: 0` removes the spacing wait and `maxAttempts: 1` removes backoff, so
 * these tests measure the ORCHESTRATOR's behaviour rather than re-testing the
 * limiter, which has its own deterministic suite in @personal-os/mail-providers.
 */
function testLimiter(): MailLimiter {
  return createMailLimiter(
    { now: () => Date.now(), sleep: () => Promise.resolve(), random: () => 0 },
    { qps: 0, maxAttempts: 1 },
  );
}

/**
 * A refresh function that FAILS LOUDLY rather than reaching the network.
 *
 * Not defensive decoration. Without it, any fixture whose stored token looks
 * expired against the injected clock sends the pass into
 * `refreshGmailAccessToken`, whose default `fetchFn` is the global fetch -- so
 * a unit test quietly makes a real request to Google's token endpoint, gets
 * `invalid_client`, and fails with `auth_permanent` for a reason that has
 * nothing to do with what it was testing. Every test in this file did exactly
 * that before this was added.
 */
function forbiddenRefresh(): never {
  throw new Error("mail sync test attempted a real token refresh");
}

function deps() {
  return {
    db,
    client,
    now: () => NOW,
    limiterFactory: testLimiter,
    refresh: forbiddenRefresh,
  };
}

function historyRecord(
  id: string,
  changes: {
    added?: string[];
    deleted?: string[];
    labelsAdded?: string[];
    labelsRemoved?: string[];
  },
): MailHistoryRecord {
  const ref = (messageId: string) => ({ message: { id: messageId, threadId: `t-${messageId}` } });
  return {
    id,
    ...(changes.added ? { messagesAdded: changes.added.map(ref) } : {}),
    ...(changes.deleted ? { messagesDeleted: changes.deleted.map(ref) } : {}),
    ...(changes.labelsAdded ? { labelsAdded: changes.labelsAdded.map(ref) } : {}),
    ...(changes.labelsRemoved ? { labelsRemoved: changes.labelsRemoved.map(ref) } : {}),
  };
}

function queueMessages(ids: string[], subjectPrefix = "subject"): void {
  for (const id of ids) {
    client.queueMessageMetadata(
      fakeMessage({
        id,
        threadId: `t-${id}`,
        from: `"Sender ${id}" <${id}@example.com>`,
        subject: `${subjectPrefix} ${id}`,
        internalDate: "1788000000000",
        labelIds: ["INBOX", "UNREAD"],
      }),
    );
  }
}

async function runsFor(connectionId: string) {
  return await db
    .select({
      kind: mailSyncRuns.kind,
      status: mailSyncRuns.status,
      failureClass: mailSyncRuns.failureClass,
      cursorExpired: mailSyncRuns.cursorExpired,
      rowsInserted: mailSyncRuns.rowsInserted,
      rowsTombstoned: mailSyncRuns.rowsTombstoned,
      httpStatus: mailSyncRuns.httpStatus,
    })
    .from(mailSyncRuns)
    .where(eq(mailSyncRuns.connectionId, connectionId))
    .orderBy(asc(mailSyncRuns.startedAt), asc(mailSyncRuns.id));
}

async function storedIds(connectionId: string): Promise<string[]> {
  const rows = await db
    .select({ externalId: mailMessages.externalId })
    .from(mailMessages)
    .where(eq(mailMessages.connectionId, connectionId))
    .orderBy(asc(mailMessages.externalId));
  return rows.map((r) => r.externalId);
}

beforeEach(async () => {
  await truncateTestTables(db);
  // A fresh fake per test. The shared-queue leak this guards against was a real
  // Checkpoint 7.2 defect: a test that queued a response and failed before
  // consuming it left it at the head of the queue, and the NEXT test drained it.
  client = createFakeMailClient();
});

afterAll(async () => {
  await truncateTestTables(db);
  await db.$client.end();
});

// ---------------------------------------------------------------------------

describe("collectDeltaIds", () => {
  it("collects added, label-added and label-removed ids for fetching", () => {
    const ids = collectDeltaIds([
      historyRecord("1", { added: ["a"] }),
      historyRecord("2", { labelsAdded: ["b"] }),
      historyRecord("3", { labelsRemoved: ["c"] }),
    ]);
    expect(ids.fetch.sort()).toEqual(["a", "b", "c"]);
    expect(ids.deleted).toEqual([]);
  });

  it("SUBTRACTS deleted ids from the fetch set", () => {
    // A message added and then deleted within one delta would otherwise be
    // fetched, 404, and waste a request proving what the delta already said.
    const ids = collectDeltaIds([
      historyRecord("1", { added: ["a", "b"] }),
      historyRecord("2", { deleted: ["a"] }),
    ]);
    expect(ids.fetch).toEqual(["b"]);
    expect(ids.deleted).toEqual(["a"]);
  });

  it("deduplicates an id touched several times in one delta", () => {
    const ids = collectDeltaIds([
      historyRecord("1", { added: ["a"] }),
      historyRecord("2", { labelsAdded: ["a"] }),
      historyRecord("3", { labelsRemoved: ["a"] }),
    ]);
    expect(ids.fetch).toEqual(["a"]);
  });

  it("handles records with no change arrays at all", () => {
    expect(collectDeltaIds([{ id: "1" }])).toEqual({ fetch: [], deleted: [] });
    expect(collectDeltaIds([])).toEqual({ fetch: [], deleted: [] });
  });
});

// ---------------------------------------------------------------------------

describe("first sync (no cursor)", () => {
  it("runs a bounded full resync and captures the cursor BEFORE enumerating", async () => {
    const connection = await seedMailConnection(db);

    // getProfile is queued first because the pass calls it first. Capturing the
    // cursor after listing would open a window in which a message arriving
    // during enumeration is older than the stored cursor and newer than the
    // listing -- invisible to every later pass, forever.
    client.queueProfile({ emailAddress: "a@example.test", historyId: "5000" });
    client.queueListMessages({ messages: [{ id: "m1", threadId: "t1" }] });
    queueMessages(["m1"]);

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.skipped).toBeNull();
    expect(result.fullResync).toBe(true);
    expect(result.inserted).toBe(1);

    // The FIRST call is getProfile, not listMessages. This is the ordering
    // assertion the whole design turns on.
    expect(client.calls[0]!.method).toBe("getProfile");
    expect(client.calls[1]!.method).toBe("listMessages");

    const cursor = await readMailCursor(db, connection.id);
    expect(cursor!.cursorValue).toBe("5000");
    expect(cursor!.needsFullResync).toBe(false);
    expect(cursor!.lastFullSyncAt).not.toBeNull();

    const runs = await runsFor(connection.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.kind).toBe("full");
    expect(runs[0]!.status).toBe("succeeded");
  });

  it("creates the cursor row lazily rather than requiring the API to seed it", async () => {
    const connection = await seedMailConnection(db);
    expect(await readMailCursor(db, connection.id)).toBeUndefined();

    client.queueProfile({ emailAddress: "a@example.test", historyId: "1" });
    client.queueListMessages({});

    await runMailConnectionSync(deps(), { connectionId: connection.id });
    expect(await readMailCursor(db, connection.id)).toBeDefined();
  });

  it("scopes the listing to INBOX and never sends a search query", async () => {
    // `q` is rejected outright under gmail.metadata (7.2P) and is
    // unrepresentable in ListMessagesRequest. Label scoping is the substitute.
    const connection = await seedMailConnection(db);
    client.queueProfile({ emailAddress: "a@example.test", historyId: "1" });
    client.queueListMessages({});

    await runMailConnectionSync(deps(), { connectionId: connection.id });

    const list = client.callsFor("listMessages")[0]!;
    expect(list.labelIds).toEqual(["INBOX"]);
  });

  it("always asks for the four allowlisted headers", async () => {
    // Omitting metadataHeaders returns EVERY header -- Received chains,
    // DKIM-Signature, Authentication-Results, X-* vendor headers (7.2P observed
    // 28 of them). The allowlist means the rest never enters the process.
    const connection = await seedMailConnection(db);
    client.queueProfile({ emailAddress: "a@example.test", historyId: "1" });
    client.queueListMessages({ messages: [{ id: "m1", threadId: "t1" }] });
    queueMessages(["m1"]);

    await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(client.callsFor("getMessageMetadata")[0]!.metadataHeaders).toEqual([
      "From",
      "Subject",
      "Date",
      "To",
    ]);
  });

  it("stops after the page cap and still stores a usable cursor", async () => {
    const connection = await seedMailConnection(db);
    client.queueProfile({ emailAddress: "a@example.test", historyId: "9000" });
    for (let page = 0; page < GMAIL_SYNC_BOUNDS.maxFullSyncPages; page++) {
      client.queueListMessages({ messages: [], nextPageToken: `page-${page + 1}` });
    }

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.truncated).toBe(true);
    expect(client.callsFor("listMessages")).toHaveLength(GMAIL_SYNC_BOUNDS.maxFullSyncPages);
    // The cursor was captured before enumeration, so truncating the listing does
    // not make it wrong -- what is dropped is the older tail, which is a
    // backfill's job.
    expect((await readMailCursor(db, connection.id))!.cursorValue).toBe("9000");
  });
});

// ---------------------------------------------------------------------------

describe("incremental sync", () => {
  it("walks history from the stored cursor and advances to the response historyId", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });

    client.queueListHistory({
      historyId: "1100",
      history: [historyRecord("1050", { added: ["m1", "m2"] })],
    });
    queueMessages(["m1", "m2"]);

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.inserted).toBe(2);
    expect(result.fullResync).toBe(false);
    expect(client.callsFor("listHistory")[0]!.startHistoryId).toBe("1000");
    expect((await readMailCursor(db, connection.id))!.cursorValue).toBe("1100");
    expect(await storedIds(connection.id)).toEqual(["m1", "m2"]);
  });

  it("handles an empty delta that OMITS the history key entirely", async () => {
    // 7.2P finding: `startHistoryId` = current historyId yields a body whose
    // only key is `historyId`. Code reading `response.history.length` crashes on
    // the single most common response in a quiet mailbox.
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });

    client.queueListHistory({ historyId: "1000" });

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.skipped).toBeNull();
    expect(result.inserted).toBe(0);
    expect(result.messagesFetched).toBe(0);
    expect(client.callsFor("getMessageMetadata")).toHaveLength(0);
    expect((await readMailCursor(db, connection.id))!.cursorValue).toBe("1000");
  });

  it("follows pagination and advances to the LAST page's historyId", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });

    client.queueListHistory({
      historyId: "1100",
      history: [historyRecord("1010", { added: ["m1"] })],
      nextPageToken: "p2",
    });
    client.queueListHistory({
      historyId: "1200",
      history: [historyRecord("1020", { added: ["m2"] })],
    });
    queueMessages(["m1", "m2"]);

    await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(client.callsFor("listHistory")).toHaveLength(2);
    expect(client.callsFor("listHistory")[1]!.pageToken).toBe("p2");
    expect((await readMailCursor(db, connection.id))!.cursorValue).toBe("1200");
    expect(await storedIds(connection.id)).toEqual(["m1", "m2"]);
  });

  it("tombstones the ids the provider explicitly reported deleted", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });
    client.queueListHistory({
      historyId: "1100",
      history: [historyRecord("1010", { added: ["m1", "m2"] })],
    });
    queueMessages(["m1", "m2"]);
    await runMailConnectionSync(deps(), { connectionId: connection.id });

    client.reset();
    client.queueListHistory({
      historyId: "1200",
      history: [historyRecord("1150", { deleted: ["m1"] })],
    });

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.tombstoned).toBe(1);
    // Deleted ids are never fetched.
    expect(client.callsFor("getMessageMetadata")).toHaveLength(0);

    const [row] = await db
      .select({ deletedAt: mailMessages.deletedAt })
      .from(mailMessages)
      .where(eq(mailMessages.externalId, "m1"));
    expect(row!.deletedAt).not.toBeNull();
  });

  it("re-fetches a message whose LABELS changed, so stored labels do not freeze", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });
    client.queueListHistory({
      historyId: "1100",
      history: [historyRecord("1010", { added: ["m1"] })],
    });
    queueMessages(["m1"]);
    await runMailConnectionSync(deps(), { connectionId: connection.id });

    client.reset();
    client.queueListHistory({
      historyId: "1200",
      history: [historyRecord("1150", { labelsRemoved: ["m1"] })],
    });
    client.queueMessageMetadata(
      fakeMessage({
        id: "m1",
        threadId: "t-m1",
        from: '"Sender m1" <m1@example.com>',
        subject: "subject m1",
        internalDate: "1788000000000",
        labelIds: ["INBOX"],
      }),
    );

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.updated).toBe(1);
    const [row] = await db
      .select({ labels: mailMessages.providerLabels })
      .from(mailMessages)
      .where(eq(mailMessages.externalId, "m1"));
    expect(row!.labels).toEqual(["INBOX"]);
  });

  it("writes ZERO message rows on a replayed identical delta", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });

    const delta = { historyId: "1100", history: [historyRecord("1010", { added: ["m1"] })] };
    client.queueListHistory({ ...delta });
    queueMessages(["m1"]);
    await runMailConnectionSync(deps(), { connectionId: connection.id });

    const before = await db
      .select({ ctid: sql<string>`ctid::text`, updatedAt: mailMessages.updatedAt })
      .from(mailMessages)
      .where(eq(mailMessages.connectionId, connection.id));

    client.reset();
    client.queueListHistory({ ...delta });
    queueMessages(["m1"]);
    const second = await runMailConnectionSync(deps(), { connectionId: connection.id });

    const after = await db
      .select({ ctid: sql<string>`ctid::text`, updatedAt: mailMessages.updatedAt })
      .from(mailMessages)
      .where(eq(mailMessages.connectionId, connection.id));

    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(after).toEqual(before);
  });

  it("clears a previously recorded connection error on success", async () => {
    const connection = await seedMailConnection(db);
    await db
      .update(mailConnections)
      .set({ lastSyncError: "rate_limited", lastSyncErrorAt: NOW })
      .where(eq(mailConnections.id, connection.id));
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });
    client.queueListHistory({ historyId: "1000" });

    await runMailConnectionSync(deps(), { connectionId: connection.id });

    const [row] = await db
      .select({ lastSyncError: mailConnections.lastSyncError })
      .from(mailConnections)
      .where(eq(mailConnections.id, connection.id));
    expect(row!.lastSyncError).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("cursor expiry", () => {
  it("escalates a history.list 404 to a bounded full resync IN THE SAME PASS", async () => {
    // ADR-053's first-class transition: needs_full_resync -> bounded full sync
    // -> new cursor. Recovering on the next tick instead would leave the mailbox
    // unsynced for a whole cron interval for no reason.
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1" });

    client.queueListHistory(new GmailApiError(404, "NOT_FOUND", [], null));
    client.queueProfile({ emailAddress: "a@example.test", historyId: "7000" });
    client.queueListMessages({ messages: [{ id: "m1", threadId: "t1" }] });
    queueMessages(["m1"]);

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.fullResync).toBe(true);
    expect(result.inserted).toBe(1);
    expect(result.failureClass).toBe("cursor_expired:list_history");

    // TWO run rows, so the escalation is visible in the audit rather than
    // inferrable: the failed incremental attempt, then the full recovery.
    const runs = await runsFor(connection.id);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      kind: "incremental",
      status: "failed",
      cursorExpired: true,
      httpStatus: 404,
      failureClass: "cursor_expired:list_history",
    });
    expect(runs[1]).toMatchObject({ kind: "full", status: "succeeded", cursorExpired: false });

    const cursor = await readMailCursor(db, connection.id);
    expect(cursor!.cursorValue).toBe("7000");
    expect(cursor!.needsFullResync).toBe(false);
  });

  it("does not retry the expired cursor before escalating", async () => {
    // Retrying an expired cursor can never succeed and delays the resync that
    // fixes it. The limiter classifies a 404 as fatal for exactly this reason.
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1" });
    client.queueListHistory(new GmailApiError(404, "NOT_FOUND", [], null));
    client.queueProfile({ emailAddress: "a@example.test", historyId: "7000" });
    client.queueListMessages({});

    await runMailConnectionSync(deps(), { connectionId: connection.id });
    expect(client.callsFor("listHistory")).toHaveLength(1);
  });

  it("takes the full path directly when needs_full_resync is already set", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000", needsFullResync: true });
    client.queueProfile({ emailAddress: "a@example.test", historyId: "8000" });
    client.queueListMessages({});

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.fullResync).toBe(true);
    expect(client.callsFor("listHistory")).toHaveLength(0);
    expect((await readMailCursor(db, connection.id))!.needsFullResync).toBe(false);
  });

  it("records cursor_expired on the connection so the state is user-visible", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1" });
    client.queueListHistory(new GmailApiError(404, "NOT_FOUND", [], null));
    client.queueProfile({ emailAddress: "a@example.test", historyId: "7000" });
    client.queueListMessages({});

    await runMailConnectionSync(deps(), { connectionId: connection.id });

    // The successful recovery clears it again -- which is right, because by the
    // end of the pass there is nothing for the user to do.
    const [row] = await db
      .select({ lastSyncError: mailConnections.lastSyncError })
      .from(mailConnections)
      .where(eq(mailConnections.id, connection.id));
    expect(row!.lastSyncError).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("bounds and truncation", () => {
  it("stops mid-walk at the message cap and parks the cursor on the last COMPLETE record", async () => {
    // The livelock this prevents: leaving the cursor unmoved replays the same
    // prefix every tick and never reaches the tail; jumping to the response's
    // historyId skips everything unread.
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });

    const perRecord = 200;
    const records: MailHistoryRecord[] = [];
    for (let r = 0; r < 4; r++) {
      const ids = Array.from({ length: perRecord }, (_, i) => `m${r}-${i}`);
      records.push(historyRecord(`rec-${r}`, { added: ids }));
    }
    client.queueListHistory({ historyId: "9999", history: records });
    // Two records' worth fits under the 500 cap; the third would exceed it.
    queueMessages(records.slice(0, 2).flatMap((r) => r.messagesAdded!.map((m) => m.message.id)));

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.truncated).toBe(true);
    expect(result.inserted).toBe(perRecord * 2);
    // NOT "9999", which would skip records 2 and 3 forever.
    expect((await readMailCursor(db, connection.id))!.cursorValue).toBe("rec-1");
  });

  it("processes at least one record even when it alone exceeds the cap", async () => {
    // Otherwise a single oversized record stalls the cursor permanently.
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });

    const ids = Array.from(
      { length: GMAIL_SYNC_BOUNDS.maxMessagesPerPass + 10 },
      (_, i) => `x${i}`,
    );
    client.queueListHistory({ historyId: "9999", history: [historyRecord("big", { added: ids })] });
    queueMessages(ids);

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.inserted).toBe(ids.length);
    expect((await readMailCursor(db, connection.id))!.cursorValue).toBe("9999");
  });

  it("stops at the history page cap and parks on the last processed record", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });

    for (let page = 0; page < GMAIL_SYNC_BOUNDS.maxHistoryPages; page++) {
      client.queueListHistory({
        historyId: "9999",
        history: [historyRecord(`rec-${page}`, { added: [`m${page}`] })],
        nextPageToken: `next-${page}`,
      });
    }
    queueMessages(Array.from({ length: GMAIL_SYNC_BOUNDS.maxHistoryPages }, (_, i) => `m${i}`));

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.truncated).toBe(true);
    expect(client.callsFor("listHistory")).toHaveLength(GMAIL_SYNC_BOUNDS.maxHistoryPages);
    expect((await readMailCursor(db, connection.id))!.cursorValue).toBe(
      `rec-${GMAIL_SYNC_BOUNDS.maxHistoryPages - 1}`,
    );
  });
});

// ---------------------------------------------------------------------------

describe("failure handling", () => {
  it("skips a connection that is not active, without spending a request", async () => {
    for (const status of ["disconnected", "revoked", "needs_reauth"] as const) {
      await truncateTestTables(db);
      client = createFakeMailClient();
      const connection = await seedMailConnection(db, { status });

      const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

      expect(result.skipped).toBe("connection_not_active");
      expect(client.calls).toHaveLength(0);
      expect(await runsFor(connection.id)).toHaveLength(0);
    }
  });

  it("returns a skip rather than throwing for a missing connection", async () => {
    const result = await runMailConnectionSync(deps(), {
      connectionId: "00000000-0000-0000-0000-000000000000",
    });
    expect(result.skipped).toBe("connection_not_found");
  });

  it("records a 401 as a failed run and a connection error, and does NOT throw", async () => {
    // Throwing would make pg-boss the retry mechanism, and retryLimit is 0 --
    // so it is not one. The cron tick is.
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });
    client.queueListHistory(new GmailApiError(401, "UNAUTHENTICATED", [], null));

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.failureClass).toBe("auth_rejected");
    const runs = await runsFor(connection.id);
    expect(runs[0]).toMatchObject({ status: "failed", failureClass: "auth_rejected" });

    const [row] = await db
      .select({ lastSyncError: mailConnections.lastSyncError })
      .from(mailConnections)
      .where(eq(mailConnections.id, connection.id));
    expect(row!.lastSyncError).toBe("auth_failed");
  });

  it("records a permission 403 as missing_scope", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });
    client.queueListHistory(new GmailApiError(403, "PERMISSION_DENIED", [], null));

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.failureClass).toBe("missing_scope");
    const [row] = await db
      .select({ lastSyncError: mailConnections.lastSyncError })
      .from(mailConnections)
      .where(eq(mailConnections.id, connection.id));
    expect(row!.lastSyncError).toBe("missing_scope");
  });

  it("skips a malformed message and stores the rest", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });
    client.queueListHistory({
      historyId: "1100",
      history: [historyRecord("1010", { added: ["good", "bad"] })],
    });
    // Deterministic ordering: collectDeltaIds preserves first-seen order.
    queueMessages(["good"]);
    client.queueMessageMetadata({ id: "bad", threadId: "t-bad", internalDate: "not-a-date" });

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.rejected).toBe(1);
    expect(result.inserted).toBe(1);
    expect(await storedIds(connection.id)).toEqual(["good"]);
    // A rejected message must not stop the cursor: the message is broken, the
    // mailbox is not.
    expect((await readMailCursor(db, connection.id))!.cursorValue).toBe("1100");
  });

  it("treats a 404 on messages.get as benign and keeps going", async () => {
    // Routine in a live mailbox: the message was deleted between being listed
    // and being fetched.
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });
    client.queueListHistory({
      historyId: "1100",
      history: [historyRecord("1010", { added: ["gone", "here"] })],
    });
    client.queueMessageMetadata(new GmailApiError(404, "NOT_FOUND", [], null));
    queueMessages(["here"]);

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.inserted).toBe(1);
    expect(result.rejected).toBe(0);
    expect(await storedIds(connection.id)).toEqual(["here"]);
  });

  it("fails the pass and leaves the cursor untouched when metadata fetching dies", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });
    client.queueListHistory({
      historyId: "1100",
      history: [historyRecord("1010", { added: ["m1"] })],
    });
    client.queueMessageMetadata(new GmailApiError(500, "INTERNAL", [], null));

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.failureClass).toBe("provider_unavailable:500");
    // Not advanced: the pass did not persist what it promised the cursor covers.
    expect((await readMailCursor(db, connection.id))!.cursorValue).toBe("1000");
    expect(await storedIds(connection.id)).toEqual([]);
  });

  it("records a token failure without a provider call when no refresh token is stored", async () => {
    const connection = await seedMailConnection(db, {
      refreshToken: null,
      accessTokenExpiresAt: new Date(NOW.getTime() - 1000),
    });
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.skipped).toBe("no_refresh_token");
    expect(client.calls).toHaveLength(0);
    expect((await runsFor(connection.id))[0]).toMatchObject({
      status: "failed",
      failureClass: "no_refresh_token",
    });
  });
});

// ---------------------------------------------------------------------------

describe("breaker integration", () => {
  it("skips before spending a request once the breaker is open, and writes a skipped run", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id, { cursorValue: "1000" });

    for (let i = 0; i < 5; i++) {
      const at = new Date(NOW.getTime() - (10 - i) * 60_000);
      await db.insert(mailSyncRuns).values({
        connectionId: connection.id,
        cursorId: cursor.id,
        scopeKey: "mailbox",
        kind: "incremental",
        status: "failed",
        failureClass: "missing_scope",
        startedAt: at,
        finishedAt: at,
      });
    }

    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.skipped).toBe("breaker_open");
    expect(client.calls).toHaveLength(0);

    const runs = await runsFor(connection.id);
    expect(runs).toHaveLength(6);
    expect(runs[5]).toMatchObject({ status: "skipped", failureClass: "breaker_open" });
  });

  it("lets a pass through once the cooldown has elapsed", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id, { cursorValue: "1000" });
    const longAgo = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    for (let i = 0; i < 5; i++) {
      await db.insert(mailSyncRuns).values({
        connectionId: connection.id,
        cursorId: cursor.id,
        scopeKey: "mailbox",
        kind: "incremental",
        status: "failed",
        failureClass: "missing_scope",
        startedAt: new Date(longAgo.getTime() + i * 60_000),
        finishedAt: new Date(longAgo.getTime() + i * 60_000),
      });
    }

    client.queueListHistory({ historyId: "1100" });
    const result = await runMailConnectionSync(deps(), { connectionId: connection.id });

    expect(result.skipped).toBeNull();
    expect(client.callsFor("listHistory")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("concurrency", () => {
  it("skips without a run row when another pass already holds the lock", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });

    // A slow first pass: the fake resolves immediately, so the contention is
    // created by starting both and letting the first take the lock.
    client.queueListHistory({ historyId: "1100" });

    const first = runMailConnectionSync(deps(), { connectionId: connection.id });
    const second = runMailConnectionSync(deps(), { connectionId: connection.id });
    const [a, b] = await Promise.all([first, second]);

    const outcomes = [a.skipped, b.skipped];
    expect(outcomes).toContain("lock_not_acquired");
    // The other pass covers the same cursor, so the honest record is no record.
    expect((await runsFor(connection.id)).filter((r) => r.status === "skipped")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("what the pass never does", () => {
  it("never calls a mutating provider method, because none exists", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });
    client.queueListHistory({
      historyId: "1100",
      history: [historyRecord("1010", { added: ["m1"] })],
    });
    queueMessages(["m1"]);

    await runMailConnectionSync(deps(), { connectionId: connection.id });

    // ADR-052 is a TYPE here rather than a policy: MailClient has no send,
    // reply, modify, trash or label method to call. This asserts the observed
    // call set matches.
    const methods = new Set(client.calls.map((c) => c.method));
    expect([...methods].sort()).toEqual(["getMessageMetadata", "listHistory"]);
  });

  it("writes nothing to inbox_items", async () => {
    // ADR-052: no writes to inbox_items, which would require altering the
    // inbox_items_source CHECK -- the exact ADR-050 hazard.
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });
    client.queueListHistory({
      historyId: "1100",
      history: [historyRecord("1010", { added: ["m1"] })],
    });
    queueMessages(["m1"]);

    await runMailConnectionSync(deps(), { connectionId: connection.id });

    const inbox = await db.execute(sql`select count(*)::int as n from inbox_items`);
    expect((inbox as unknown as { rows: { n: number }[] }).rows[0]!.n).toBe(0);
  });

  it("leaves the health tables untouched", async () => {
    const connection = await seedMailConnection(db);
    await seedMailCursor(db, connection.id, { cursorValue: "1000" });
    client.queueListHistory({ historyId: "1100" });

    await runMailConnectionSync(deps(), { connectionId: connection.id });

    const health = await db.execute(
      sql`select
            (select count(*) from health_observations)::int as observations,
            (select count(*) from health_sync_runs)::int as runs`,
    );
    expect(
      (health as unknown as { rows: { observations: number; runs: number }[] }).rows[0],
    ).toEqual({ observations: 0, runs: 0 });
  });
});
