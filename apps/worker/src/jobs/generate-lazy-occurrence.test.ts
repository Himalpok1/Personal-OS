import {
  computeNextLazyOccurrence,
  toWallClockComponents,
  wallClockToNaiveDate,
} from "@personal-os/core";
import { occurrences, tasks, type Db } from "@personal-os/db";
import { and, eq, sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { setLogSink } from "../logger.js";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import {
  createGenerateLazyOccurrenceHandler,
  generateOne,
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
    // survive as the race fallback -- but ONLY as that. Provoked here through
    // the (parent_type, parent_id, occurs_at) unique index rather than the
    // partial one: a CLOSED row already sitting at the exact instant the job
    // computes passes the open-occurrence read and then conflicts on insert.
    // Before the 9.4 review that was reported as `successor_exists`, which was
    // false: nothing was open, the series had stopped, and the job completed
    // with nobody told. A 23505 is success only when a scheduled occurrence
    // actually exists afterwards; here none does, so it must throw and reach
    // pg-boss's retry / dead-letter / alert path.
    it("treats a unique-index conflict with no open occurrence as a failure, not success", async () => {
      const taskId = await insertCompletionAnchoredTask(db);
      const occurrenceId = await insertDoneOccurrence(db, taskId);
      const next = computeNextLazyOccurrence(
        { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: "America/Chicago" },
        new Date("2026-09-11T02:30:00Z"),
        "completed",
        // The done row's occurs_local is 09:00; the job keeps that wall time.
        { wallTime: { hour: 9, minute: 0, second: 0 }, after: new Date("2026-09-10T14:00:00Z") },
      );
      await db.insert(occurrences).values({
        parentType: "task",
        parentId: taskId,
        occursAt: next.occursAt,
        occursLocal: wallClockToNaiveDate(next.occursLocal),
        status: "skipped",
        lazyGenerated: true,
        completedAt: new Date("2026-09-12T00:00:00Z"),
      });

      const caught = await createGenerateLazyOccurrenceHandler(db)([
        job({ occurrenceId, fromStatus: "completed" }),
      ]).catch((err: unknown) => err);

      expect(caught).toBeInstanceOf(OccurrencesJobError);
      expect(await openOccurrences(db, taskId)).toHaveLength(0);
      expect(records.some((r) => r["reason"] === "successor_exists")).toBe(false);
      expect(
        records.find((r) => r["event"] === "occurrences.generate_lazy.collision"),
      ).toMatchObject({
        level: "warn",
        occurrenceId,
        taskId,
        reason: "collision_no_open_occurrence",
      });
      expect(records.find((r) => r["event"] === "occurrences.generate_lazy.failed")).toMatchObject({
        level: "warn",
        occurrenceId,
        error: "LazySuccessorCollisionError",
      });
      // The class name is the whole token; no instant, rule or title leaks.
      const everything = JSON.stringify(records);
      expect(everything).not.toContain("Water");
      expect(everything).not.toContain("FREQ");
    });

    // The genuine race: a second delivery commits the successor AFTER this
    // delivery's state read and BEFORE its insert. Made deterministic with an
    // open transaction holding the partial-index key uncommitted: the
    // handler's read cannot see it, its insert then blocks on the other
    // transaction's XID, and once that commits the insert fails with 23505.
    // The re-read in the catch finds the committed row, so this IS success --
    // the one case in which a 23505 may be reported as `successor_exists`.
    it("reports a 23505 as success only when a scheduled occurrence exists afterwards", async () => {
      const taskId = await insertCompletionAnchoredTask(db);
      const occurrenceId = await insertDoneOccurrence(db, taskId);

      let releaseConcurrent!: () => void;
      const gate = new Promise<void>((resolve) => (releaseConcurrent = resolve));
      let concurrentInserted!: () => void;
      const insertedGate = new Promise<void>((resolve) => (concurrentInserted = resolve));
      let concurrentId = "";
      const concurrent = db.transaction(async (tx) => {
        const [row] = await tx
          .insert(occurrences)
          .values({
            parentType: "task",
            parentId: taskId,
            // A different instant from the one the job computes, so only the
            // partial one_open_occurrence_per_lazy_parent index can conflict.
            occursAt: new Date("2026-09-25T14:00:00Z"),
            occursLocal: new Date("2026-09-25T09:00:00Z"),
            status: "scheduled",
            lazyGenerated: true,
          })
          .returning({ id: occurrences.id });
        concurrentId = row!.id;
        concurrentInserted();
        await gate;
      });
      await insertedGate;

      const run = generateOne(db, { occurrenceId, fromStatus: "completed" });
      // Wait until the handler's insert is actually parked on the other
      // transaction's lock before letting that transaction commit; a fixed
      // sleep could release too early and exercise the state-read path
      // instead of the catch.
      const deadline = Date.now() + 10_000;
      for (;;) {
        const { rows } = await db.execute<{ n: string }>(
          sql`select count(*)::text as n from pg_stat_activity
              where wait_event_type = 'Lock' and datname = current_database()`,
        );
        if (Number(rows[0]?.n ?? "0") > 0) break;
        if (Date.now() > deadline) throw new Error("handler never blocked on the lock");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      releaseConcurrent();
      await concurrent;

      await expect(run).resolves.toBe("successor_exists");
      const open = await openOccurrences(db, taskId);
      expect(open).toHaveLength(1);
      expect(open[0]!.id).toBe(concurrentId);
      expect(records.find((r) => r["reason"] === "successor_exists")).toMatchObject({
        level: "info",
        occurrenceId,
        taskId,
        openOccurrenceId: concurrentId,
      });
      expect(records.some((r) => r["event"] === "occurrences.generate_lazy.collision")).toBe(false);
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

// ---------------------------------------------------------------------------
// Wall-clock agreement between the two successor writers. Checkpoint 9.4.
// ---------------------------------------------------------------------------
//
// The API's transitionOccurrence (apps/api/src/routes/occurrences.ts) inserts
// the successor in the completion's own transaction from `now` plus the
// completed row's occurs_local time of day; this job re-checks it from the
// SAME row's completed_at and occurs_local. If the two ever computed different
// instants the re-check would insert a second successor at the other one --
// the duplicate-successor hazard the shared `wallTime` closes. These pin that
// the worker's row is byte-for-byte the API's, for a 09:00 chore completed at
// 21:47, on either side of both 2026 America/Chicago transitions.
describe("occurrences.generate-lazy keeps the occurrence's wall-clock time (9.4)", () => {
  let db: Db;
  let restore: () => void;
  const RULE = { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: "America/Chicago" };
  const NINE_AM = { hour: 9, minute: 0, second: 0 };

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
    restore = setLogSink({ write: () => undefined });
    return () => restore();
  });

  afterAll(async () => {
    await truncateTestTables(db);
  });

  // Each case: the completed occurrence's 09:00 local instant, the 21:47 local
  // completion instant, and the expected successor -- 09:00 local three days
  // after the completion's LOCAL date, with the offset that date actually has.
  it.each([
    [
      "spring forward (2026-03-08): completed 03-06 21:47 CST → 03-09 09:00 CDT",
      "2026-03-06T15:00:00Z", // 09:00 CST
      "2026-03-07T03:47:00Z", // 21:47 CST on 03-06
      "2026-03-09T14:00:00Z", // 09:00 CDT
    ],
    [
      "fall back (2026-11-01): completed 10-30 21:47 CDT → 11-02 09:00 CST",
      "2026-10-30T14:00:00Z", // 09:00 CDT
      "2026-10-31T02:47:00Z", // 21:47 CDT on 10-30
      "2026-11-02T15:00:00Z", // 09:00 CST
    ],
    [
      "no transition: completed 09-10 21:47 CDT → 09-13 09:00 CDT",
      "2026-09-10T14:00:00Z",
      "2026-09-11T02:47:00Z",
      "2026-09-13T14:00:00Z",
    ],
  ])("%s", async (_label, occursAtIso, completedAtIso, expectedIso) => {
    const taskId = await insertCompletionAnchoredTask(db);
    const completedAt = new Date(completedAtIso);
    const [done] = await db
      .insert(occurrences)
      .values({
        parentType: "task",
        parentId: taskId,
        occursAt: new Date(occursAtIso),
        occursLocal: wallClockToNaiveDate({
          ...toWallClockComponents(new Date(occursAtIso), RULE.recurrenceTimezone),
        }),
        status: "done",
        lazyGenerated: true,
        completedAt,
      })
      .returning({ id: occurrences.id, occursLocal: occurrences.occursLocal });
    // The stored occurs_local reads back as 09:00 through the UTC getters --
    // the extraction both writers rely on.
    expect(done!.occursLocal.getUTCHours()).toBe(9);
    expect(done!.occursLocal.getUTCMinutes()).toBe(0);

    // API-style: computed at the completion instant from the completed row's
    // wall time, exactly as transitionOccurrence does inside its transaction.
    const apiStyle = computeNextLazyOccurrence(RULE, completedAt, "completed", {
      wallTime: NINE_AM,
    });
    expect(apiStyle.occursAt.toISOString()).toBe(new Date(expectedIso).toISOString());

    // Worker-style: the job reads completed_at and occurs_local back from the
    // row and must land on the identical instant.
    await createGenerateLazyOccurrenceHandler(db)([
      job({ occurrenceId: done!.id, fromStatus: "completed" }),
    ]);
    const open = await openOccurrences(db, taskId);
    expect(open).toHaveLength(1);
    expect(open[0]!.occursAt.toISOString()).toBe(apiStyle.occursAt.toISOString());
    expect(open[0]!.occursLocal.toISOString()).toBe(
      wallClockToNaiveDate(apiStyle.occursLocal).toISOString(),
    );
    expect(open[0]!.occursLocal.getUTCHours()).toBe(9);
  });

  it("collapses onto the API's already-written successor instead of adding a second row", async () => {
    // The API wrote its successor (wall time kept) and it is still open when
    // the re-check runs: the job must leave exactly that row, at exactly that
    // instant, and never a 21:47 one.
    const taskId = await insertCompletionAnchoredTask(db);
    const completedAt = new Date("2026-03-07T03:47:00Z");
    const [done] = await db
      .insert(occurrences)
      .values({
        parentType: "task",
        parentId: taskId,
        occursAt: new Date("2026-03-06T15:00:00Z"),
        occursLocal: new Date("2026-03-06T09:00:00Z"),
        status: "done",
        lazyGenerated: true,
        completedAt,
      })
      .returning({ id: occurrences.id });
    const apiStyle = computeNextLazyOccurrence(RULE, completedAt, "completed", {
      wallTime: NINE_AM,
      after: new Date("2026-03-06T15:00:00Z"),
    });
    const [apiRow] = await db
      .insert(occurrences)
      .values({
        parentType: "task",
        parentId: taskId,
        occursAt: apiStyle.occursAt,
        occursLocal: wallClockToNaiveDate(apiStyle.occursLocal),
        status: "scheduled",
        lazyGenerated: true,
      })
      .returning({ id: occurrences.id });

    await expect(
      createGenerateLazyOccurrenceHandler(db)([
        job({ occurrenceId: done!.id, fromStatus: "completed" }),
      ]),
    ).resolves.toBeUndefined();

    const all = await db.select().from(occurrences).where(eq(occurrences.parentId, taskId));
    // Still exactly the two rows the API wrote; no 21:47 successor appeared.
    expect(all).toHaveLength(2);
    const open = await openOccurrences(db, taskId);
    expect(open).toHaveLength(1);
    expect(open[0]!.id).toBe(apiRow!.id);
  });

  // 9.4 review repro: a Thursday 09:00 occurrence completed on the Monday
  // BEFORE it. Anchoring +3 days from the completion lands on Thursday 09:00
  // -- the completed row's own instant -- which the (parent, occurs_at) key
  // rejects, and before `after` the collision was then reported as success,
  // silently ending the series on every early completion. The successor must
  // be the first instance strictly after the completed row.
  it("an early completion yields a successor strictly after the completed row (after bound)", async () => {
    const taskId = await insertCompletionAnchoredTask(db);
    const thursdayNineAm = new Date("2026-09-17T14:00:00Z"); // Thu 09:00 CDT
    const mondayCompletion = new Date("2026-09-14T16:20:00Z"); // Mon 11:20 CDT
    const [done] = await db
      .insert(occurrences)
      .values({
        parentType: "task",
        parentId: taskId,
        occursAt: thursdayNineAm,
        occursLocal: new Date("2026-09-17T09:00:00Z"),
        status: "done",
        lazyGenerated: true,
        completedAt: mondayCompletion,
      })
      .returning({ id: occurrences.id });

    await expect(
      createGenerateLazyOccurrenceHandler(db)([
        job({ occurrenceId: done!.id, fromStatus: "completed" }),
      ]),
    ).resolves.toBeUndefined();

    const open = await openOccurrences(db, taskId);
    expect(open).toHaveLength(1);
    expect(open[0]!.occursAt.getTime()).toBeGreaterThan(thursdayNineAm.getTime());
    // Mon + 3 = Thu (not after) → Mon + 6 = Sun 09-20 09:00 CDT.
    expect(open[0]!.occursAt.toISOString()).toBe("2026-09-20T14:00:00.000Z");
    expect(open[0]!.occursLocal.getUTCHours()).toBe(9);
    // And it is the instant the API computes from the same row.
    const apiStyle = computeNextLazyOccurrence(RULE, mondayCompletion, "completed", {
      wallTime: NINE_AM,
      after: thursdayNineAm,
    });
    expect(open[0]!.occursAt.toISOString()).toBe(apiStyle.occursAt.toISOString());
  });
});
