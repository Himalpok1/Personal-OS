import {
  aiProviderConnections,
  aiTaskRoutes,
  healthConnections,
  healthSyncRuns,
  mailConnections,
  mailDigests,
  mailMessages,
  mailSyncCursors,
  mailSyncRuns,
  monitorChecks,
  monitorIncidents,
  monitorTargets,
  notes,
  tasks,
  type Db,
} from "@personal-os/db";
import { createMonitorTarget } from "@personal-os/monitoring";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { seedMailConnection, seedMailCursor, seedMailMessage } from "../test/mail-fixtures.js";
import {
  retentionCleanupJob,
  RetentionCleanupError,
  TABLE_CLEANERS,
  type RetentionTableCleaner,
} from "./retention-cleanup.js";

const db: Db = buildTestDb();

// A fixed instant well clear of any DST edge, so "N days ago" arithmetic below
// is exact and reviewable rather than computed against a moving `Date.now()`.
const NOW = new Date("2026-09-12T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

async function seedHealthConnection(): Promise<string> {
  const [row] = await db
    .insert(healthConnections)
    .values({ provider: "google", healthUserId: `hu-${Math.random()}`, status: "active" })
    .returning({ id: healthConnections.id });
  return row!.id;
}

async function seedHealthSyncRun(
  connectionId: string,
  overrides: Partial<typeof healthSyncRuns.$inferInsert> = {},
): Promise<typeof healthSyncRuns.$inferSelect> {
  const [row] = await db
    .insert(healthSyncRuns)
    .values({
      connectionId,
      metric: "steps",
      kind: "hot",
      rangeStartDate: "2026-01-01",
      rangeEndDate: "2026-01-01",
      status: "succeeded",
      startedAt: NOW,
      finishedAt: NOW,
      ...overrides,
    })
    .returning();
  return row!;
}

async function seedMailSyncRun(
  connectionId: string,
  overrides: Partial<typeof mailSyncRuns.$inferInsert> = {},
): Promise<typeof mailSyncRuns.$inferSelect> {
  const [row] = await db
    .insert(mailSyncRuns)
    .values({
      connectionId,
      scopeKey: "mailbox",
      kind: "incremental",
      status: "succeeded",
      startedAt: NOW,
      finishedAt: NOW,
      ...overrides,
    })
    .returning();
  return row!;
}

async function seedMonitorCheck(targetId: string, checkedAt: Date): Promise<void> {
  await db.insert(monitorChecks).values({ targetId, status: "up", checkedAt });
}

async function seedMailDigest(digestDate: string): Promise<void> {
  await db.insert(mailDigests).values({ digestDate, timezone: "UTC", content: { text: "digest" } });
}

beforeEach(async () => {
  await truncateTestTables(db);
});

afterAll(async () => {
  await truncateTestTables(db);
  await db.$client.end();
});

describe("retentionCleanupJob (Checkpoint 8.6C)", () => {
  describe("general behavior", () => {
    it("is idempotent -- a rerun immediately after a clean pass deletes 0 additional rows", async () => {
      const target = await createMonitorTarget(db, { name: "t", kind: "http", url: "http://x/" });
      await seedMonitorCheck(target.id, daysAgo(31));

      const first = await retentionCleanupJob(db, NOW);
      expect(first.find((r) => r.table === "monitor_checks")!.deleted).toBe(1);

      const second = await retentionCleanupJob(db, NOW);
      expect(second.find((r) => r.table === "monitor_checks")!.deleted).toBe(0);
    });

    it("computes an exact, deterministic cutoff: strictly-older-than-30-days is deleted, exactly-30-days and younger survive", async () => {
      // "Older than 30 days" is a strict inequality (checked_at < cutoff),
      // so a row exactly AT the cutoff instant is exactly 30 days old --
      // not yet older than 30 days -- and must survive. Only a row strictly
      // before the cutoff (here, 1ms further back) is actually deleted.
      const target = await createMonitorTarget(db, { name: "t", kind: "http", url: "http://x/" });
      const cutoff = daysAgo(30);
      const strictlyOlder = new Date(cutoff.getTime() - 1);
      const exactlyAtCutoff = cutoff;
      const justYounger = new Date(cutoff.getTime() + 1);
      await seedMonitorCheck(target.id, strictlyOlder);
      await seedMonitorCheck(target.id, exactlyAtCutoff);
      await seedMonitorCheck(target.id, justYounger);

      await retentionCleanupJob(db, NOW);

      const remaining = await db
        .select({ checkedAt: monitorChecks.checkedAt })
        .from(monitorChecks)
        .where(eq(monitorChecks.targetId, target.id));
      const remainingTimes = remaining.map((r) => r.checkedAt.getTime()).sort();
      expect(remainingTimes).toEqual([exactlyAtCutoff.getTime(), justYounger.getTime()].sort());
    });

    it("one table's failure does not prevent the others from being cleaned, and the job still reports overall failure", async () => {
      const target = await createMonitorTarget(db, { name: "t", kind: "http", url: "http://x/" });
      await seedMonitorCheck(target.id, daysAgo(31));

      const connection = await seedMailConnection(db);
      await seedMailMessage(db, connection.id, { internalDate: daysAgo(46) });

      // A faithful list of the real cleaners with `mail_messages` replaced by
      // one that deterministically throws -- proving the LOOP's own
      // behavior (continue past a failure, still throw at the end) without
      // needing to break a real Postgres privilege, which `posops_app`
      // cannot do to itself (see the module comment on `retentionCleanupJob`).
      const cleanersWithOneFailing: RetentionTableCleaner[] = TABLE_CLEANERS.map((c) =>
        c.table === "mail_messages"
          ? { table: c.table, clean: () => Promise.reject(new Error("simulated failure")) }
          : c,
      );

      await expect(retentionCleanupJob(db, NOW, cleanersWithOneFailing)).rejects.toThrow(
        RetentionCleanupError,
      );

      // monitor_checks was still cleaned despite mail_messages "failing".
      const remainingChecks = await db
        .select()
        .from(monitorChecks)
        .where(eq(monitorChecks.targetId, target.id));
      expect(remainingChecks).toHaveLength(0);

      // and the real mail_messages row is untouched by the simulated failure.
      const stillThere = await db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.connectionId, connection.id));
      expect(stillThere).toHaveLength(1);
    });

    it("the thrown error names exactly the failing table(s), never the underlying error's message", async () => {
      const cleanersWithOneFailing: RetentionTableCleaner[] = TABLE_CLEANERS.map((c) =>
        c.table === "mail_sync_runs"
          ? {
              table: c.table,
              clean: () =>
                Promise.reject(new Error("some internal postgres detail that must not leak")),
            }
          : c,
      );

      let caught: unknown;
      try {
        await retentionCleanupJob(db, NOW, cleanersWithOneFailing);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RetentionCleanupError);
      const error = caught as RetentionCleanupError;
      expect(error.failedTables).toEqual(["mail_sync_runs"]);
      expect(error.message).not.toContain("postgres detail");
    });

    it("never logs a row's own content -- only the expected scalar field names ever reach the logger", async () => {
      // Structural proof, not a log-scraping test: `log.info`/`log.error`'s
      // own `LogFields` type accepts only string|number|boolean|null|
      // undefined, so passing a raw row or Error would already be a type
      // error -- this file's own clean typecheck is half the proof. This
      // test asserts the other half dynamically: every field name the source
      // actually passes is one this test expects, so a future edit adding an
      // unreviewed field is caught here too.
      const source = await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("./retention-cleanup.ts", import.meta.url), "utf8"),
      );
      const logCalls = [...source.matchAll(/log\.(info|error)\("([^"]+)",\s*\{([^}]*)\}/g)];
      expect(logCalls.length).toBeGreaterThan(0);
      const allowed = new Set([
        "table",
        "cutoff",
        "deleted",
        "durationMs",
        "error",
        "tablesOk",
        "tablesFailed",
        "totalDeleted",
      ]);
      for (const match of logCalls) {
        const fieldsBlock = match[3]!;
        const fieldNames = [...fieldsBlock.matchAll(/(\w+):/g)].map((m) => m[1]!);
        for (const name of fieldNames) {
          expect(allowed.has(name), `unexpected log field "${name}"`).toBe(true);
        }
      }
    });
  });

  describe("monitor_checks (D3, 30 days)", () => {
    it("deletes rows older than 30 days", async () => {
      const target = await createMonitorTarget(db, { name: "t", kind: "http", url: "http://x/" });
      await seedMonitorCheck(target.id, daysAgo(31));
      await retentionCleanupJob(db, NOW);
      const rows = await db
        .select()
        .from(monitorChecks)
        .where(eq(monitorChecks.targetId, target.id));
      expect(rows).toHaveLength(0);
    });

    it("preserves rows within 30 days", async () => {
      const target = await createMonitorTarget(db, { name: "t", kind: "http", url: "http://x/" });
      await seedMonitorCheck(target.id, daysAgo(29));
      await retentionCleanupJob(db, NOW);
      const rows = await db
        .select()
        .from(monitorChecks)
        .where(eq(monitorChecks.targetId, target.id));
      expect(rows).toHaveLength(1);
    });

    it("preserves monitor_targets and monitor_incidents untouched", async () => {
      const target = await createMonitorTarget(db, { name: "t", kind: "http", url: "http://x/" });
      await seedMonitorCheck(target.id, daysAgo(60));
      const [incident] = await db
        .insert(monitorIncidents)
        .values({
          targetId: target.id,
          status: "resolved",
          openedAt: daysAgo(90),
          resolvedAt: daysAgo(89),
        })
        .returning();

      await retentionCleanupJob(db, NOW);

      const targetRow = await db
        .select()
        .from(monitorTargets)
        .where(eq(monitorTargets.id, target.id));
      expect(targetRow).toHaveLength(1);
      const incidentRow = await db
        .select()
        .from(monitorIncidents)
        .where(eq(monitorIncidents.id, incident!.id));
      expect(incidentRow).toHaveLength(1);
    });
  });

  describe("mail_messages (D4, 45 days, keyed on internal_date)", () => {
    it("uses internal_date, NOT created_at, as the retention axis", async () => {
      const connection = await seedMailConnection(db);
      // internal_date is old; created_at is "now" (defaultNow()) since the
      // row was just inserted -- deletion here proves the predicate reads
      // internal_date, not a local write-time column.
      const message = await seedMailMessage(db, connection.id, { internalDate: daysAgo(46) });

      await retentionCleanupJob(db, NOW);

      const row = await db.select().from(mailMessages).where(eq(mailMessages.id, message.id));
      expect(row).toHaveLength(0);
    });

    it("deletes rows older than 45 days", async () => {
      const connection = await seedMailConnection(db);
      await seedMailMessage(db, connection.id, { internalDate: daysAgo(46) });
      const results = await retentionCleanupJob(db, NOW);
      expect(results.find((r) => r.table === "mail_messages")!.deleted).toBe(1);
    });

    it("preserves recent rows", async () => {
      const connection = await seedMailConnection(db);
      const message = await seedMailMessage(db, connection.id, { internalDate: daysAgo(44) });
      const results = await retentionCleanupJob(db, NOW);
      expect(results.find((r) => r.table === "mail_messages")!.deleted).toBe(0);
      const stillThere = await db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.id, message.id));
      expect(stillThere).toHaveLength(1);
    });

    it("deletes an old row regardless of its deleted_at (tombstone) status -- both axes are independent", async () => {
      const connection = await seedMailConnection(db);
      await seedMailMessage(db, connection.id, {
        internalDate: daysAgo(46),
        deletedAt: null,
        externalId: "not-tombstoned-old",
      });
      await seedMailMessage(db, connection.id, {
        internalDate: daysAgo(46),
        deletedAt: daysAgo(1),
        externalId: "tombstoned-old",
      });
      const results = await retentionCleanupJob(db, NOW);
      expect(results.find((r) => r.table === "mail_messages")!.deleted).toBe(2);
    });

    it("does NOT touch mail_sync_cursors -- current sync state is untouched by retention", async () => {
      const connection = await seedMailConnection(db);
      await seedMailCursor(db, connection.id, { cursorValue: "999999" });
      await seedMailMessage(db, connection.id, { internalDate: daysAgo(46) });

      await retentionCleanupJob(db, NOW);

      const [cursor] = await db
        .select()
        .from(mailSyncCursors)
        .where(eq(mailSyncCursors.connectionId, connection.id));
      expect(cursor!.cursorValue).toBe("999999");
    });

    it("does NOT touch mail_connections", async () => {
      const connection = await seedMailConnection(db);
      await seedMailMessage(db, connection.id, { internalDate: daysAgo(46) });
      await retentionCleanupJob(db, NOW);
      const rows = await db
        .select()
        .from(mailConnections)
        .where(eq(mailConnections.id, connection.id));
      expect(rows).toHaveLength(1);
    });
  });

  describe("mail_digests (D5)", () => {
    it("deletes digests older than the source-mail retention window", async () => {
      await seedMailDigest(daysAgo(46).toISOString().slice(0, 10));
      const results = await retentionCleanupJob(db, NOW);
      expect(results.find((r) => r.table === "mail_digests")!.deleted).toBe(1);
    });

    it("preserves recent digests", async () => {
      await seedMailDigest(daysAgo(1).toISOString().slice(0, 10));
      const results = await retentionCleanupJob(db, NOW);
      expect(results.find((r) => r.table === "mail_digests")!.deleted).toBe(0);
    });
  });

  describe("sync-run tables (D6, 30 days, finished_at only)", () => {
    it("mail_sync_runs: deletes a completed run older than 30 days", async () => {
      const connection = await seedMailConnection(db);
      await seedMailSyncRun(connection.id, { startedAt: daysAgo(31), finishedAt: daysAgo(31) });
      const results = await retentionCleanupJob(db, NOW);
      expect(results.find((r) => r.table === "mail_sync_runs")!.deleted).toBe(1);
    });

    it("mail_sync_runs: preserves a recent completed run", async () => {
      const connection = await seedMailConnection(db);
      await seedMailSyncRun(connection.id, { startedAt: daysAgo(1), finishedAt: daysAgo(1) });
      const results = await retentionCleanupJob(db, NOW);
      expect(results.find((r) => r.table === "mail_sync_runs")!.deleted).toBe(0);
    });

    it("mail_sync_runs: NEVER deletes a row with finished_at NULL, however old started_at is", async () => {
      const connection = await seedMailConnection(db);
      const run = await seedMailSyncRun(connection.id, {
        startedAt: daysAgo(90),
        finishedAt: null,
      });
      await retentionCleanupJob(db, NOW);
      const rows = await db.select().from(mailSyncRuns).where(eq(mailSyncRuns.id, run.id));
      expect(rows).toHaveLength(1);
    });

    it("health_sync_runs: deletes a completed run older than 30 days", async () => {
      const connection = await seedHealthConnection();
      await seedHealthSyncRun(connection, { startedAt: daysAgo(31), finishedAt: daysAgo(31) });
      const results = await retentionCleanupJob(db, NOW);
      expect(results.find((r) => r.table === "health_sync_runs")!.deleted).toBe(1);
    });

    it("health_sync_runs: preserves a recent completed run", async () => {
      const connection = await seedHealthConnection();
      await seedHealthSyncRun(connection, { startedAt: daysAgo(1), finishedAt: daysAgo(1) });
      const results = await retentionCleanupJob(db, NOW);
      expect(results.find((r) => r.table === "health_sync_runs")!.deleted).toBe(0);
    });

    it("health_sync_runs: NEVER deletes a row with finished_at NULL, however old started_at is", async () => {
      const connection = await seedHealthConnection();
      const run = await seedHealthSyncRun(connection, { startedAt: daysAgo(90), finishedAt: null });
      await retentionCleanupJob(db, NOW);
      const rows = await db.select().from(healthSyncRuns).where(eq(healthSyncRuns.id, run.id));
      expect(rows).toHaveLength(1);
    });

    it("does NOT touch health_connections", async () => {
      const connection = await seedHealthConnection();
      await seedHealthSyncRun(connection, { startedAt: daysAgo(60), finishedAt: daysAgo(60) });
      await retentionCleanupJob(db, NOW);
      const rows = await db
        .select()
        .from(healthConnections)
        .where(eq(healthConnections.id, connection));
      expect(rows).toHaveLength(1);
    });
  });

  describe("safety: no retention path touches unrelated durable data", () => {
    it("touches no notes, tasks, AI configuration, or credential tables", async () => {
      const [note] = await db
        .insert(notes)
        .values({ title: "keep me", body: "b" })
        .returning({ id: notes.id });
      const [task] = await db
        .insert(tasks)
        .values({ title: "keep me too", status: "active", timezone: "UTC" })
        .returning({ id: tasks.id });
      const taskRoutesBefore = await db.select().from(aiTaskRoutes);
      const connectionsBefore = await db.select().from(aiProviderConnections);

      // Give the job real, old, eligible data in every table too, so this is
      // not a vacuously-passing test against an empty database.
      const target = await createMonitorTarget(db, { name: "t", kind: "http", url: "http://x/" });
      await seedMonitorCheck(target.id, daysAgo(60));
      const mailConn = await seedMailConnection(db);
      await seedMailMessage(db, mailConn.id, { internalDate: daysAgo(60) });

      await retentionCleanupJob(db, NOW);

      const noteRows = await db.select().from(notes).where(eq(notes.id, note!.id));
      expect(noteRows).toHaveLength(1);
      const taskRows = await db.select().from(tasks).where(eq(tasks.id, task!.id));
      expect(taskRows).toHaveLength(1);
      expect(await db.select().from(aiTaskRoutes)).toEqual(taskRoutesBefore);
      expect(await db.select().from(aiProviderConnections)).toEqual(connectionsBefore);
    });
  });
});
