import { mailMessages, type Db } from "@personal-os/db";
import { translateMailMessage, type MailMessageRow } from "@personal-os/mail-providers";
import { fakeMessage } from "@personal-os/mail-providers";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { seedMailConnection } from "../test/mail-fixtures.js";
import {
  countLiveMailMessages,
  countTombstonedMailMessages,
  tombstoneMailMessages,
  upsertMailMessages,
} from "./persist.js";

const db: Db = buildTestDb();

function row(opts: {
  id: string;
  subject?: string;
  labels?: string[];
  internalDate?: string;
}): MailMessageRow {
  const result = translateMailMessage(
    fakeMessage({
      id: opts.id,
      threadId: `t-${opts.id}`,
      from: '"Ada Lovelace" <ada@example.com>',
      subject: opts.subject ?? "a subject",
      internalDate: opts.internalDate ?? "1788000000000",
      ...(opts.labels !== undefined ? { labelIds: opts.labels } : {}),
    }),
  );
  if (!result.ok) throw new Error("fixture failed to translate");
  return result.row;
}

/**
 * Physical row identity, for the zero-write proof.
 *
 * `ctid`/`xmin`/`updated_at`, and deliberately NOT `xmax`: the speculative
 * insertion an ON CONFLICT performs sets xmax IN PLACE on rows it merely
 * examined, so an unchanged row's xmax legitimately differs between runs. A
 * test asserting on it would fail for a reason that is not a defect -- the
 * exact trap health/persist.ts documents.
 */
async function physicalIdentity(connectionId: string) {
  return await db
    .select({
      externalId: mailMessages.externalId,
      ctid: sql<string>`ctid::text`,
      xmin: sql<string>`xmin::text`,
      updatedAt: mailMessages.updatedAt,
      contentHash: mailMessages.contentHash,
    })
    .from(mailMessages)
    .where(eq(mailMessages.connectionId, connectionId))
    .orderBy(mailMessages.externalId);
}

beforeEach(async () => {
  await truncateTestTables(db);
});

afterAll(async () => {
  await truncateTestTables(db);
  await db.$client.end();
});

describe("upsertMailMessages", () => {
  it("inserts new rows and reports them as inserted", async () => {
    const connection = await seedMailConnection(db);
    const counts = await upsertMailMessages(db, {
      connectionId: connection.id,
      rows: [row({ id: "m1" }), row({ id: "m2" })],
    });
    expect(counts).toEqual({ inserted: 2, updated: 0, unchanged: 0, collapsed: 0 });
    expect(await countLiveMailMessages(db, connection.id)).toBe(2);
  });

  it("writes ZERO rows when the same messages are re-fetched unchanged", async () => {
    // THE PROPERTY THIS MODULE EXISTS FOR. Not "writes the same values twice" --
    // literally no tuple, no updated_at bump.
    const connection = await seedMailConnection(db);
    const rows = [row({ id: "m1" }), row({ id: "m2" }), row({ id: "m3" })];

    await upsertMailMessages(db, { connectionId: connection.id, rows });
    const before = await physicalIdentity(connection.id);

    const second = await upsertMailMessages(db, { connectionId: connection.id, rows });
    const after = await physicalIdentity(connection.id);

    expect(second).toEqual({ inserted: 0, updated: 0, unchanged: 3, collapsed: 0 });
    // Byte-identical physical rows: same tuple, same inserting transaction,
    // same updated_at.
    expect(after).toEqual(before);
  });

  it("updates only the rows whose content actually changed", async () => {
    const connection = await seedMailConnection(db);
    await upsertMailMessages(db, {
      connectionId: connection.id,
      rows: [row({ id: "m1", subject: "one" }), row({ id: "m2", subject: "two" })],
    });
    const before = await physicalIdentity(connection.id);

    const counts = await upsertMailMessages(db, {
      connectionId: connection.id,
      rows: [row({ id: "m1", subject: "one" }), row({ id: "m2", subject: "TWO, changed" })],
    });
    const after = await physicalIdentity(connection.id);

    expect(counts).toEqual({ inserted: 0, updated: 1, unchanged: 1, collapsed: 0 });
    expect(after[0]).toEqual(before[0]);
    expect(after[1]!.ctid).not.toBe(before[1]!.ctid);
  });

  it("treats a label change as a content change", async () => {
    // Not incidental: provider_labels is what a digest triages on, so a message
    // that is read and archived must stop reading UNREAD/INBOX.
    const connection = await seedMailConnection(db);
    await upsertMailMessages(db, {
      connectionId: connection.id,
      rows: [row({ id: "m1", labels: ["INBOX", "UNREAD"] })],
    });
    const counts = await upsertMailMessages(db, {
      connectionId: connection.id,
      rows: [row({ id: "m1", labels: ["INBOX"] })],
    });
    expect(counts.updated).toBe(1);

    const [stored] = await db
      .select({ labels: mailMessages.providerLabels })
      .from(mailMessages)
      .where(eq(mailMessages.externalId, "m1"));
    expect(stored!.labels).toEqual(["INBOX"]);
  });

  it("collapses a duplicate id within one batch instead of failing the statement", async () => {
    // A single history delta legitimately reports the same message several
    // times -- added, then labelled, then unlabelled -- and a multi-row ON
    // CONFLICT raises "cannot affect row a second time" if the key repeats.
    const connection = await seedMailConnection(db);
    const counts = await upsertMailMessages(db, {
      connectionId: connection.id,
      rows: [row({ id: "m1", subject: "first" }), row({ id: "m1", subject: "second" })],
    });

    expect(counts.inserted).toBe(1);
    expect(counts.collapsed).toBe(1);
    const [stored] = await db
      .select({ subject: mailMessages.subject })
      .from(mailMessages)
      .where(eq(mailMessages.externalId, "m1"));
    // Last wins, matching the provider's own ordering: the later record is the
    // more recent statement of the message's state.
    expect(stored!.subject).toBe("second");
  });

  it("scopes identity to the connection, so two mailboxes may hold the same id", async () => {
    // Gmail message ids are per-mailbox. The unique key is
    // (connection_id, external_id) precisely so a personal and a work mailbox
    // cannot collide.
    const a = await seedMailConnection(db, { externalAccountId: "a@example.test" });
    const b = await seedMailConnection(db, { externalAccountId: "b@example.test" });
    await upsertMailMessages(db, { connectionId: a.id, rows: [row({ id: "shared" })] });
    const counts = await upsertMailMessages(db, {
      connectionId: b.id,
      rows: [row({ id: "shared" })],
    });
    expect(counts.inserted).toBe(1);
    expect(await countLiveMailMessages(db, a.id)).toBe(1);
    expect(await countLiveMailMessages(db, b.id)).toBe(1);
  });

  it("does nothing at all for an empty batch", async () => {
    const connection = await seedMailConnection(db);
    expect(await upsertMailMessages(db, { connectionId: connection.id, rows: [] })).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: 0,
      collapsed: 0,
    });
  });
});

describe("tombstoneMailMessages", () => {
  it("marks exactly the ids the provider named", async () => {
    const connection = await seedMailConnection(db);
    await upsertMailMessages(db, {
      connectionId: connection.id,
      rows: [row({ id: "m1" }), row({ id: "m2" }), row({ id: "m3" })],
    });

    const tombstoned = await tombstoneMailMessages(db, {
      connectionId: connection.id,
      externalIds: ["m2"],
    });

    expect(tombstoned).toBe(1);
    expect(await countLiveMailMessages(db, connection.id)).toBe(2);
    expect(await countTombstonedMailMessages(db, connection.id)).toBe(1);
  });

  it("does NOTHING for an empty id list", async () => {
    // The ADR-047a hazard in miniature: `x <> ALL('{}'::text[])` is TRUE in
    // Postgres, so an ungated sweep would tombstone everything. Mail's signal is
    // explicit rather than absence-based, but the guard costs nothing and this
    // asserts it.
    const connection = await seedMailConnection(db);
    await upsertMailMessages(db, {
      connectionId: connection.id,
      rows: [row({ id: "m1" }), row({ id: "m2" })],
    });

    expect(await tombstoneMailMessages(db, { connectionId: connection.id, externalIds: [] })).toBe(
      0,
    );
    expect(await countLiveMailMessages(db, connection.id)).toBe(2);
    expect(await countTombstonedMailMessages(db, connection.id)).toBe(0);
  });

  it("never reaches across connections", async () => {
    const a = await seedMailConnection(db, { externalAccountId: "a@example.test" });
    const b = await seedMailConnection(db, { externalAccountId: "b@example.test" });
    await upsertMailMessages(db, { connectionId: a.id, rows: [row({ id: "shared" })] });
    await upsertMailMessages(db, { connectionId: b.id, rows: [row({ id: "shared" })] });

    await tombstoneMailMessages(db, { connectionId: a.id, externalIds: ["shared"] });

    expect(await countLiveMailMessages(db, a.id)).toBe(0);
    expect(await countLiveMailMessages(db, b.id)).toBe(1);
  });

  it("is idempotent: a replayed delta does not move deleted_at forward", async () => {
    const connection = await seedMailConnection(db);
    await upsertMailMessages(db, { connectionId: connection.id, rows: [row({ id: "m1" })] });

    const first = new Date("2026-09-01T00:00:00.000Z");
    await tombstoneMailMessages(db, { connectionId: connection.id, externalIds: ["m1"] }, first);

    const second = await tombstoneMailMessages(
      db,
      { connectionId: connection.id, externalIds: ["m1"] },
      new Date("2026-09-02T00:00:00.000Z"),
    );

    expect(second).toBe(0);
    const [stored] = await db
      .select({ deletedAt: mailMessages.deletedAt })
      .from(mailMessages)
      .where(eq(mailMessages.externalId, "m1"));
    expect(stored!.deletedAt?.toISOString()).toBe(first.toISOString());
  });

  it("retains the row rather than deleting it", async () => {
    // ADR-047a's distinction, applied to mail: a provider-side deletion marker
    // is reconciliation with upstream truth, not local data destruction. The
    // row stays indefinitely; ADR-054's permitted prune is a separate decision
    // nothing here performs.
    const connection = await seedMailConnection(db);
    await upsertMailMessages(db, { connectionId: connection.id, rows: [row({ id: "m1" })] });
    await tombstoneMailMessages(db, { connectionId: connection.id, externalIds: ["m1"] });

    const rows = await db
      .select({ id: mailMessages.id, subject: mailMessages.subject })
      .from(mailMessages)
      .where(eq(mailMessages.connectionId, connection.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subject).toBe("a subject");
  });

  it("clears the tombstone when the message reappears", async () => {
    // Reversible in both directions, which is what makes the marker
    // reconciliation rather than a verdict.
    const connection = await seedMailConnection(db);
    await upsertMailMessages(db, { connectionId: connection.id, rows: [row({ id: "m1" })] });
    await tombstoneMailMessages(db, { connectionId: connection.id, externalIds: ["m1"] });
    expect(await countTombstonedMailMessages(db, connection.id)).toBe(1);

    // Byte-identical content: the hash gate alone would skip the write, so the
    // `or deleted_at is not null` half of the setWhere is what un-tombstones it.
    const counts = await upsertMailMessages(db, {
      connectionId: connection.id,
      rows: [row({ id: "m1" })],
    });

    expect(counts.updated).toBe(1);
    expect(await countTombstonedMailMessages(db, connection.id)).toBe(0);
    expect(await countLiveMailMessages(db, connection.id)).toBe(1);
  });
});

describe("stored shape", () => {
  it("stores no body, snippet or attachment content, because no such column exists", async () => {
    // A structural assertion rather than a policy one: ADR-054's guarantee is
    // that a body is unfetchable under gmail.metadata, and this confirms the
    // table cannot hold one even if a future writer tried.
    const columns = await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'mail_messages'`,
    );
    const names = (columns as unknown as { rows: { column_name: string }[] }).rows.map(
      (r) => r.column_name,
    );
    for (const forbidden of ["body", "snippet", "payload", "raw", "content_type"]) {
      expect(names.some((n) => n.includes(forbidden))).toBe(false);
    }
    // `has_attachment` is a BOOLEAN FLAG, not attachment content, so a naive
    // substring sweep for "attachment" flags it -- which is why the only
    // attachment-shaped column permitted is named exactly.
    expect(names.filter((n) => n.includes("attachment"))).toEqual(["has_attachment"]);
    expect(names).toContain("subject");
    expect(names).toContain("provider_labels");
  });

  it("persists the sender split into address, domain and display name", async () => {
    const connection = await seedMailConnection(db);
    await upsertMailMessages(db, { connectionId: connection.id, rows: [row({ id: "m1" })] });
    const [stored] = await db
      .select({
        fromAddress: mailMessages.fromAddress,
        fromDomain: mailMessages.fromDomain,
        fromDisplayName: mailMessages.fromDisplayName,
        hasAttachment: mailMessages.hasAttachment,
      })
      .from(mailMessages)
      .where(and(eq(mailMessages.connectionId, connection.id), eq(mailMessages.externalId, "m1")));

    expect(stored).toEqual({
      fromAddress: "ada@example.com",
      fromDomain: "example.com",
      fromDisplayName: "Ada Lovelace",
      // Not derivable under gmail.metadata. "Not known to carry an attachment",
      // never "proven to carry none".
      hasAttachment: false,
    });
  });
});
