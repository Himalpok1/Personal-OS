import { computeNextLazyOccurrence, wallClockToNaiveDate } from "@personal-os/core";
import { occurrences, tasks, type Db } from "@personal-os/db";
import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { setLogSink } from "../logger.js";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import {
  createGenerateLazyOccurrenceHandler,
  type GenerateLazyOccurrenceJobData,
} from "./generate-lazy-occurrence.js";
import { OccurrencesJobError } from "./occurrences-job-error.js";

// Checkpoint 9.0 -- occurrences.generate-lazy gains structured logging and
// output containment. The handler's BEHAVIOUR is unchanged: a successor is
// inserted, a duplicate delivery is a no-op on the partial unique index, and a
// real failure still throws so pg-boss retries. What changes is what reaches
// the log and what reaches pgboss.job.output.

// A title with the two things a lock screen and a log must never carry from
// here: a rule-shaped fragment and a newline that would weld words together.
const TITLE = "Water the plants\nBYDAY=MO doctor appointment";

async function insertCompletionAnchoredTask(
  db: Db,
  overrides: Partial<typeof tasks.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(tasks)
    .values({
      title: TITLE,
      status: "active",
      timezone: "America/Chicago",
      rrule: "FREQ=DAILY;INTERVAL=3",
      recurrenceTimezone: "America/Chicago",
      recurrenceAnchor: "completion_date",
      ...overrides,
    })
    .returning({ id: tasks.id });
  return row!.id;
}

async function insertDoneOccurrence(db: Db, taskId: string): Promise<string> {
  const [row] = await db
    .insert(occurrences)
    .values({
      parentType: "task",
      parentId: taskId,
      occursAt: new Date("2026-09-10T14:00:00Z"),
      occursLocal: new Date("2026-09-10T09:00:00Z"),
      status: "done",
      lazyGenerated: true,
      completedAt: new Date("2026-09-11T02:30:00Z"),
    })
    .returning({ id: occurrences.id });
  return row!.id;
}

function job(data: GenerateLazyOccurrenceJobData): Job<GenerateLazyOccurrenceJobData> {
  return {
    id: "job-1",
    name: "occurrences.generate-lazy",
    data,
  } as Job<GenerateLazyOccurrenceJobData>;
}

async function openOccurrences(db: Db, taskId: string) {
  return db
    .select()
    .from(occurrences)
    .where(
      and(
        eq(occurrences.parentType, "task"),
        eq(occurrences.parentId, taskId),
        eq(occurrences.status, "scheduled"),
      ),
    );
}

describe("occurrences.generate-lazy handler", () => {
  let db: Db;
  let records: Record<string, unknown>[];
  let restore: () => void;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
    records = [];
    restore = setLogSink({ write: (_level, record) => records.push(record) });
    return () => restore();
  });

  afterAll(async () => {
    await truncateTestTables(db);
  });

  it("inserts exactly one lazy successor after a completion (behaviour unchanged)", async () => {
    const taskId = await insertCompletionAnchoredTask(db);
    const occurrenceId = await insertDoneOccurrence(db, taskId);

    await createGenerateLazyOccurrenceHandler(db)([job({ occurrenceId, fromStatus: "completed" })]);

    const open = await openOccurrences(db, taskId);
    expect(open).toHaveLength(1);
    expect(open[0]!.lazyGenerated).toBe(true);
    // Three days after the COMPLETION instant, not after the due instant --
    // that is the whole point of completion anchoring.
    expect(open[0]!.occursAt.getTime()).toBeGreaterThan(
      new Date("2026-09-11T02:30:00Z").getTime() + 2 * 24 * 60 * 60 * 1000,
    );
  });

  it("treats a duplicate delivery as success on the one-open-occurrence index", async () => {
    const taskId = await insertCompletionAnchoredTask(db);
    const occurrenceId = await insertDoneOccurrence(db, taskId);
    const handler = createGenerateLazyOccurrenceHandler(db);

    await handler([job({ occurrenceId, fromStatus: "completed" })]);
    await expect(
      handler([job({ occurrenceId, fromStatus: "completed" })]),
    ).resolves.toBeUndefined();

    expect(await openOccurrences(db, taskId)).toHaveLength(1);
    expect(records.map((r) => r["reason"])).toContain("successor_exists");
  });

  // Checkpoint 9.3: POST /occurrences/:id/complete|skip inserts the successor
  // in the same transaction as the status update and STILL enqueues this job
  // as a belt-and-braces re-check, so "an open occurrence already exists" is
  // now the common delivery, not the duplicate-delivery corner case. The job
  // must be a no-op: no second row, no re-pointing of the one the API wrote,
  // no throw.
  describe("no-op when an open scheduled occurrence already exists (9.3)", () => {
    // Deliberately NOT the instant the job would compute, so a re-pointed or
    // re-inserted row is distinguishable from the one the API seeded.
    const SEEDED_OCCURS_AT = new Date("2026-09-20T14:00:00Z");

    async function insertOpenOccurrence(
      db: Db,
      taskId: string,
      lazyGenerated: boolean,
    ): Promise<string> {
      const [row] = await db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: taskId,
          occursAt: SEEDED_OCCURS_AT,
          occursLocal: new Date("2026-09-20T09:00:00Z"),
          status: "scheduled",
          lazyGenerated,
        })
        .returning({ id: occurrences.id });
      return row!.id;
    }

    it.each([
      ["lazy-generated (the API's in-transaction successor)", true],
      ["not lazy-generated (outside the partial unique index)", false],
    ])("leaves the existing open occurrence untouched when it is %s", async (_label, lazy) => {
      const taskId = await insertCompletionAnchoredTask(db);
      const occurrenceId = await insertDoneOccurrence(db, taskId);
      const openId = await insertOpenOccurrence(db, taskId, lazy);

      await expect(
        createGenerateLazyOccurrenceHandler(db)([job({ occurrenceId, fromStatus: "completed" })]),
      ).resolves.toBeUndefined();

      const open = await openOccurrences(db, taskId);
      expect(open).toHaveLength(1);
      expect(open[0]!.id).toBe(openId);
      expect(open[0]!.occursAt.toISOString()).toBe(SEEDED_OCCURS_AT.toISOString());
      expect(open[0]!.lazyGenerated).toBe(lazy);

      const skip = records.find((r) => r["event"] === "occurrences.generate_lazy.skipped");
      expect(skip).toMatchObject({
        level: "info",
        occurrenceId,
        taskId,
        reason: "successor_exists",
        openOccurrenceId: openId,
      });
      expect(records.some((r) => r["event"] === "occurrences.generate_lazy.failed")).toBe(false);
    });

    it("does not consult the open-occurrence guard for a different parent", async () => {
      const taskId = await insertCompletionAnchoredTask(db);
      const otherTaskId = await insertCompletionAnchoredTask(db);
      const occurrenceId = await insertDoneOccurrence(db, taskId);
      await insertOpenOccurrence(db, otherTaskId, true);

      await createGenerateLazyOccurrenceHandler(db)([
        job({ occurrenceId, fromStatus: "completed" }),
      ]);

      expect(await openOccurrences(db, taskId)).toHaveLength(1);
      expect(await openOccurrences(db, otherTaskId)).toHaveLength(1);
    });

    // The state read and the insert are not atomic, so the 23505 path must
    // survive as the race fallback. Provoked deterministically through the
    // (parent_type, parent_id, occurs_at) unique index rather than the partial
    // one: a closed row already sitting at the exact instant the job computes
    // passes the open-occurrence read and then conflicts on insert.
    it("treats a unique-index conflict on the insert as success, not a failure to retry", async () => {
      const taskId = await insertCompletionAnchoredTask(db);
      const occurrenceId = await insertDoneOccurrence(db, taskId);
      const next = computeNextLazyOccurrence(
        { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: "America/Chicago" },
        new Date("2026-09-11T02:30:00Z"),
        "completed",
      );
      await db.insert(occurrences).values({
        parentType: "task",
        parentId: taskId,
        occursAt: next.occursAt,
        occursLocal: wallClockToNaiveDate(next.occursLocal),
        status: "skipped",
        lazyGenerated: true,
      });

      await expect(
        createGenerateLazyOccurrenceHandler(db)([job({ occurrenceId, fromStatus: "completed" })]),
      ).resolves.toBeUndefined();

      const skip = records.find((r) => r["reason"] === "successor_exists");
      expect(skip).toMatchObject({ level: "info", occurrenceId, taskId });
      expect(records.some((r) => r["event"] === "occurrences.generate_lazy.failed")).toBe(false);
    });
  });

  it.each([
    ["occurrence_missing", () => Promise.resolve({ occurrenceId: crypto.randomUUID() })],
    [
      "not_completion_anchored",
      async () => {
        const taskId = await insertCompletionAnchoredTask(db, { recurrenceAnchor: "due_date" });
        return { occurrenceId: await insertDoneOccurrence(db, taskId) };
      },
    ],
  ])("logs a structured %s skip instead of console.warn", async (reason, setup) => {
    const { occurrenceId } = await setup();
    await createGenerateLazyOccurrenceHandler(db)([job({ occurrenceId, fromStatus: "skipped" })]);

    const skip = records.find((r) => r["event"] === "occurrences.generate_lazy.skipped");
    expect(skip).toMatchObject({ level: "warn", reason, occurrenceId });
  });

  // Checkpoint 9.3 review: a dropped or archived parent used to get a
  // successor anyway -- the lazy strategy was the one path that kept a closed
  // task recurring. Old code: one new scheduled row per case.
  it.each([
    ["dropped", { status: "dropped" as const }],
    ["archived", { archivedAt: new Date("2026-09-11T00:00:00Z") }],
  ])(
    "generates no successor for a %s parent and logs a parent_closed skip",
    async (_label, overrides) => {
      const taskId = await insertCompletionAnchoredTask(db, overrides);
      const occurrenceId = await insertDoneOccurrence(db, taskId);

      await expect(
        createGenerateLazyOccurrenceHandler(db)([job({ occurrenceId, fromStatus: "completed" })]),
      ).resolves.toBeUndefined();

      expect(await openOccurrences(db, taskId)).toHaveLength(0);
      const skip = records.find((r) => r["event"] === "occurrences.generate_lazy.skipped");
      expect(skip).toMatchObject({ reason: "parent_closed", occurrenceId, taskId });
      expect(records.some((r) => r["event"] === "occurrences.generate_lazy.failed")).toBe(false);
    },
  );

  // A data-integrity fault (a BY* part on a completion-anchored rule, which
  // write-time validation should have refused) is the realistic persistent
  // failure: it throws on every attempt, exhausts the retries, and reaches the
  // dead-letter queue. The throw MUST survive -- pg-boss's retry depends on it
  // -- but what it carries must not.
  it("contains a persistent failure: rethrows as OccurrencesJobError with no rule text", async () => {
    const taskId = await insertCompletionAnchoredTask(db, { rrule: "FREQ=DAILY;BYDAY=MO" });
    const occurrenceId = await insertDoneOccurrence(db, taskId);

    const caught = await createGenerateLazyOccurrenceHandler(db)([
      job({ occurrenceId, fromStatus: "completed" }),
    ]).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(OccurrencesJobError);
    const serialized = JSON.stringify({
      ...(caught as OccurrencesJobError),
      message: (caught as Error).message,
      stack: (caught as Error).stack,
    });
    expect(serialized).not.toContain("BYDAY");
    expect(serialized).not.toContain("FREQ");
    expect((caught as Error).message).toBe("occurrences.generate-lazy failed");
    expect(await openOccurrences(db, taskId)).toHaveLength(0);
  });

  it("logs a classified failure line, ids and token only, before rethrowing", async () => {
    const taskId = await insertCompletionAnchoredTask(db, { rrule: "FREQ=DAILY;BYDAY=MO" });
    const occurrenceId = await insertDoneOccurrence(db, taskId);

    await createGenerateLazyOccurrenceHandler(db)([
      job({ occurrenceId, fromStatus: "completed" }),
    ]).catch(() => undefined);

    const failed = records.find((r) => r["event"] === "occurrences.generate_lazy.failed");
    expect(failed).toMatchObject({
      level: "warn",
      occurrenceId,
      fromStatus: "completed",
      // packages/core throws a bare Error here, so the token is its class name.
      error: "Error",
    });
  });

  it("never writes the title, the rule or an error message to the log", async () => {
    const taskId = await insertCompletionAnchoredTask(db, { rrule: "FREQ=DAILY;BYDAY=MO" });
    const occurrenceId = await insertDoneOccurrence(db, taskId);
    const handler = createGenerateLazyOccurrenceHandler(db);

    await handler([job({ occurrenceId, fromStatus: "completed" })]).catch(() => undefined);
    await handler([job({ occurrenceId: crypto.randomUUID(), fromStatus: "skipped" })]);

    const everything = JSON.stringify(records);
    for (const forbidden of ["Water", "BYDAY", "FREQ", "doctor", "may only use", "\\n"]) {
      expect(everything).not.toContain(forbidden);
    }
    expect(records.length).toBeGreaterThan(0);
  });
});
