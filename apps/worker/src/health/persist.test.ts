import { healthConnections, healthDailyMetrics, healthSessions, type Db } from "@personal-os/db";
import { contentHash, sessionContentInput, type SessionRow } from "@personal-os/health-providers";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import {
  densifyDates,
  tombstoneMissingSessions,
  upsertDailyMetrics,
  upsertSessions,
} from "./persist.js";

// SYNTHETIC data only. Nothing here came from a real account.

const db: Db = buildTestDb();

async function insertConnection(healthUserId: string): Promise<string> {
  const [row] = await db
    .insert(healthConnections)
    .values({ provider: "google", healthUserId, status: "active" })
    .returning({ id: healthConnections.id });
  return row!.id;
}

function dailyRow(localDate: string, value: string) {
  return {
    metric: "steps",
    localDate,
    hasData: true as const,
    value,
    breakdown: null,
    sourceCount: null,
  };
}

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    metric: "sleep",
    externalKey: "users/me/dataPoints/synthetic-1",
    externalKeySource: "data_point_name",
    dataPointName: "users/me/dataPoints/synthetic-1",
    attributedLocalDate: "2026-08-21",
    civilStartLocal: new Date(Date.UTC(2026, 7, 20, 22, 41, 0)),
    civilEndLocal: new Date(Date.UTC(2026, 7, 21, 6, 52, 0)),
    startAt: new Date("2026-08-21T03:41:00.000Z"),
    endAt: new Date("2026-08-21T11:52:00.000Z"),
    startUtcOffsetSeconds: -18000,
    endUtcOffsetSeconds: -18000,
    durationSeconds: 29460,
    detail: {
      source: { recordingMethod: null, deviceFormFactor: null, applicationPlatform: null },
      sessionType: "SLEEP",
      sessionSubtype: null,
    },
    providerCreatedAt: null,
    providerUpdatedAt: null,
    ...overrides,
  };
}

interface RowIdentity {
  local_date?: string;
  external_key?: string;
  ctid: string;
  xmin: string;
  updated_at: string;
}

async function dailyIdentities(connectionId: string): Promise<RowIdentity[]> {
  const res = await db.execute(
    sql`select local_date::text as local_date, ctid::text as ctid, xmin::text as xmin,
               updated_at::text as updated_at
        from health_daily_metrics where connection_id = ${connectionId}
        order by local_date`,
  );
  return res.rows as unknown as RowIdentity[];
}

describe("health persistence", () => {
  beforeEach(async () => {
    await truncateTestTables(db);
  });

  it("writes real rows, then writes NOTHING at all on an identical second pass", async () => {
    const connectionId = await insertConnection("persist-1");
    const rows = [dailyRow("2026-08-20", "1234"), dailyRow("2026-08-21", "0")];

    const first = await upsertDailyMetrics(db, { connectionId, rows, sourceFamily: null });
    expect(first).toEqual({ inserted: 2, updated: 0, unchanged: 0, collapsed: 0 });

    const before = await dailyIdentities(connectionId);
    const second = await upsertDailyMetrics(db, { connectionId, rows, sourceFamily: null });
    expect(second).toEqual({ inserted: 0, updated: 0, unchanged: 2, collapsed: 0 });

    // ctid proves no new tuple version; xmin proves no write transaction
    // touched it; updated_at proves the SET never ran. xmax is deliberately NOT
    // compared -- ON CONFLICT's speculative lock stamps it in place on rows it
    // merely examined.
    expect(await dailyIdentities(connectionId)).toEqual(before);
  });

  it("keeps a TRUE ZERO distinct from a verified absence", async () => {
    const connectionId = await insertConnection("persist-2");
    await upsertDailyMetrics(db, {
      connectionId,
      rows: [dailyRow("2026-08-20", "0")],
      sourceFamily: null,
    });
    await densifyDates(db, {
      connectionId,
      metric: "steps",
      dates: ["2026-08-21"],
      sourceFamily: null,
      insertOnly: false,
    });

    const stored = await db
      .select()
      .from(healthDailyMetrics)
      .where(eq(healthDailyMetrics.connectionId, connectionId))
      .orderBy(healthDailyMetrics.localDate);

    expect(stored).toHaveLength(2);
    // A day with a recorded zero.
    expect(stored[0]).toMatchObject({ localDate: "2026-08-20", hasData: true, value: "0" });
    // A day verified to have nothing. The 0013 CHECK makes collapsing these two
    // impossible; this asserts we are not collapsing them ourselves.
    expect(stored[1]).toMatchObject({ localDate: "2026-08-21", hasData: false, value: null });
  });

  it("replaces a verified absence when real data later arrives, and back again", async () => {
    const connectionId = await insertConnection("persist-3");
    await densifyDates(db, {
      connectionId,
      metric: "steps",
      dates: ["2026-08-20"],
      sourceFamily: null,
      insertOnly: false,
    });

    const filled = await upsertDailyMetrics(db, {
      connectionId,
      rows: [dailyRow("2026-08-20", "900")],
      sourceFamily: null,
    });
    expect(filled).toEqual({ inserted: 0, updated: 1, unchanged: 0, collapsed: 0 });

    // ...and the reverse, which is the ONLY deletion detection daily metrics
    // have: an authoritative window that stops returning a day blanks it.
    const blanked = await densifyDates(db, {
      connectionId,
      metric: "steps",
      dates: ["2026-08-20"],
      sourceFamily: null,
      insertOnly: false,
    });
    expect(blanked.updated).toBe(1);
    const [row] = await db
      .select()
      .from(healthDailyMetrics)
      .where(eq(healthDailyMetrics.connectionId, connectionId));
    expect(row).toMatchObject({ hasData: false, value: null });
  });

  it("insert-only densification never downgrades an existing real row", async () => {
    const connectionId = await insertConnection("persist-4");
    await upsertDailyMetrics(db, {
      connectionId,
      rows: [dailyRow("2026-08-20", "900")],
      sourceFamily: null,
    });

    const counts = await densifyDates(db, {
      connectionId,
      metric: "steps",
      dates: ["2026-08-20", "2026-08-21"],
      sourceFamily: null,
      // Backfill: may ADD absence markers, must never remove data.
      insertOnly: true,
    });
    expect(counts).toEqual({ inserted: 1, updated: 0, unchanged: 1, collapsed: 0 });

    const stored = await db
      .select()
      .from(healthDailyMetrics)
      .where(eq(healthDailyMetrics.connectionId, connectionId))
      .orderBy(healthDailyMetrics.localDate);
    expect(stored[0]).toMatchObject({ localDate: "2026-08-20", hasData: true, value: "900" });
    expect(stored[1]).toMatchObject({ localDate: "2026-08-21", hasData: false });
  });

  it("collapses duplicate conflict keys in one statement rather than raising", async () => {
    const connectionId = await insertConnection("persist-5");
    // Two records for one civil date in a single chunk. Postgres raises
    // `cannot affect row a second time` if both reach one INSERT statement.
    const counts = await upsertDailyMetrics(db, {
      connectionId,
      rows: [dailyRow("2026-08-20", "1"), dailyRow("2026-08-20", "2")],
      sourceFamily: null,
    });
    expect(counts).toEqual({ inserted: 1, updated: 0, unchanged: 0, collapsed: 1 });
  });

  it("upserts sessions, then writes nothing on an identical second pass", async () => {
    const connectionId = await insertConnection("persist-6");
    const rows = [sessionRow()];
    expect(await upsertSessions(db, { connectionId, rows })).toMatchObject({ inserted: 1 });
    expect(await upsertSessions(db, { connectionId, rows })).toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: 1,
    });
  });

  it("treats an updateTime-only change as exactly one update", async () => {
    const connectionId = await insertConnection("persist-7");
    await upsertSessions(db, { connectionId, rows: [sessionRow()] });
    const counts = await upsertSessions(db, {
      connectionId,
      rows: [sessionRow({ providerUpdatedAt: "2026-08-22T09:00:00.000Z" })],
    });
    // Provider timestamps are part of the hashed content precisely so this is
    // detected rather than silently leaving a stale value in the database.
    expect(counts).toMatchObject({ inserted: 0, updated: 1, unchanged: 0 });
  });

  it("tombstones NOTHING when the seen-key set is empty", async () => {
    const connectionId = await insertConnection("persist-8");
    await upsertSessions(db, { connectionId, rows: [sessionRow()] });

    // `x <> ALL('{}'::text[])` is TRUE in Postgres, so an unguarded sweep with
    // no seen keys would tombstone the entire window in one statement. This is
    // the single most destructive bug available in this file.
    const swept = await tombstoneMissingSessions(db, {
      connectionId,
      metric: "sleep",
      axis: "civil_end",
      windowStartDate: "2026-07-20",
      windowEndDateExclusive: "2026-08-26",
      seenKeys: [],
    });
    expect(swept).toBe(0);

    const [row] = await db
      .select()
      .from(healthSessions)
      .where(eq(healthSessions.connectionId, connectionId));
    expect(row!.deletedAt).toBeNull();
  });

  it("tombstones a missing session, and un-tombstones it under the same external key", async () => {
    const connectionId = await insertConnection("persist-9");
    const present = sessionRow();
    await upsertSessions(db, { connectionId, rows: [present] });

    const swept = await tombstoneMissingSessions(db, {
      connectionId,
      metric: "sleep",
      axis: "civil_end",
      windowStartDate: "2026-07-20",
      windowEndDateExclusive: "2026-08-26",
      seenKeys: ["users/me/dataPoints/some-other-session"],
    });
    expect(swept).toBe(1);

    // Byte-identical content returning after a tombstone MUST resurrect the
    // row. Hash equality alone would skip the update and leave it deleted
    // forever -- the `or deleted_at is not null` half of the setWhere.
    const revived = await upsertSessions(db, { connectionId, rows: [present] });
    expect(revived).toMatchObject({ updated: 1 });
    const [row] = await db
      .select()
      .from(healthSessions)
      .where(eq(healthSessions.connectionId, connectionId));
    expect(row!.deletedAt).toBeNull();
    // The identity did not change, so no duplicate was created.
    expect(row!.contentHash).toBe(contentHash(sessionContentInput(present)));
  });

  it("never tombstones a DERIVED-key session", async () => {
    const connectionId = await insertConnection("persist-10");
    await upsertSessions(db, {
      connectionId,
      rows: [
        sessionRow({
          externalKey: "derived-hash-abc",
          externalKeySource: "list_derived",
          dataPointName: null,
        }),
      ],
    });

    // A derived key is a hash over fields the provider may recompute. Its
    // absence is evidence of a changed key, not of a deleted session.
    const swept = await tombstoneMissingSessions(db, {
      connectionId,
      metric: "sleep",
      axis: "civil_end",
      windowStartDate: "2026-07-20",
      windowEndDateExclusive: "2026-08-26",
      seenKeys: ["something-else"],
    });
    expect(swept).toBe(0);
  });

  it("sweeps only within the chunk's own civil window, on the requested axis", async () => {
    const connectionId = await insertConnection("persist-11");
    await upsertSessions(db, { connectionId, rows: [sessionRow()] });

    // The session's civil END is 2026-08-21; a window that ends before it must
    // not touch it, or a backfill chunk would delete a neighbouring chunk's
    // sessions.
    const outside = await tombstoneMissingSessions(db, {
      connectionId,
      metric: "sleep",
      axis: "civil_end",
      windowStartDate: "2026-07-01",
      windowEndDateExclusive: "2026-08-01",
      seenKeys: ["other"],
    });
    expect(outside).toBe(0);

    const inside = await tombstoneMissingSessions(db, {
      connectionId,
      metric: "sleep",
      axis: "civil_end",
      windowStartDate: "2026-08-21",
      windowEndDateExclusive: "2026-08-22",
      seenKeys: ["other"],
    });
    expect(inside).toBe(1);
  });

  it("is idempotent: a second identical sweep tombstones nothing", async () => {
    const connectionId = await insertConnection("persist-12");
    await upsertSessions(db, { connectionId, rows: [sessionRow()] });
    const params = {
      connectionId,
      metric: "sleep",
      axis: "civil_end" as const,
      windowStartDate: "2026-07-20",
      windowEndDateExclusive: "2026-08-26",
      seenKeys: ["other"],
    };
    expect(await tombstoneMissingSessions(db, params)).toBe(1);
    expect(await tombstoneMissingSessions(db, params)).toBe(0);
  });
});
