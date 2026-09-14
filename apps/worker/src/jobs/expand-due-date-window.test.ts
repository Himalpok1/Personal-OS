import { events, occurrences, tasks, type Db } from "@personal-os/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { setLogSink } from "../logger.js";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import {
  createExpandDueDateWindowHandler,
  expandDueDateWindowJob,
} from "./expand-due-date-window.js";
import { OccurrencesJobError } from "./occurrences-job-error.js";

async function insertRecurringTask(
  db: Db,
  overrides: Partial<typeof tasks.$inferInsert>,
): Promise<string> {
  const [row] = await db
    .insert(tasks)
    .values({
      title: "Weekly regression check",
      status: "active",
      timezone: "America/Chicago",
      dueAt: new Date(),
      rrule: "FREQ=WEEKLY;INTERVAL=1",
      recurrenceTimezone: "America/Chicago",
      recurrenceAnchor: "due_date",
      ...overrides,
    })
    .returning({ id: tasks.id });
  return row!.id;
}

async function insertRecurringEvent(
  db: Db,
  overrides: Partial<typeof events.$inferInsert>,
): Promise<string> {
  const [row] = await db
    .insert(events)
    .values({
      title: "Weekly team standup",
      timezone: "America/Chicago",
      startsAt: new Date(),
      rrule: "FREQ=WEEKLY;INTERVAL=1",
      recurrenceTimezone: "America/Chicago",
      ...overrides,
    })
    .returning({ id: events.id });
  return row!.id;
}

// Canonical all-day shape per EventCreateSchema: allDay=true, startsAt/endsAt
// NULL, startDate set. Before the buildEventRecurrenceRule fix, the job's
// `!event.startsAt` guard silently skipped every row shaped like this.
async function insertRecurringAllDayEvent(
  db: Db,
  overrides: Partial<typeof events.$inferInsert>,
): Promise<string> {
  const [row] = await db
    .insert(events)
    .values({
      title: "Weekly all-day retro",
      timezone: "America/Chicago",
      allDay: true,
      startsAt: null,
      endsAt: null,
      startDate: "2026-01-05",
      endDate: "2026-01-05",
      rrule: "FREQ=WEEKLY;INTERVAL=1",
      recurrenceTimezone: "America/Chicago",
      ...overrides,
    })
    .returning({ id: events.id });
  return row!.id;
}

// Regression coverage for the Phase 2 fix: before this, the job's query had
// no status/archived_at filter at all, so dropping or archiving a
// recurring task did nothing to stop the nightly cron from continuing to
// generate occurrences for it (see docs/STATUS.md's "Phase 2 backend
// implementation" entry).
describe("expandDueDateWindowJob", () => {
  let db: Db;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
  });

  afterAll(async () => {
    await truncateTestTables(db);
  });

  it("expands occurrences for an active, unarchived recurring task", async () => {
    const taskId = await insertRecurringTask(db, {});
    await expandDueDateWindowJob(db);

    const rows = await db.select().from(occurrences).where(eq(occurrences.parentId, taskId));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("generates zero occurrences for a dropped recurring task", async () => {
    const taskId = await insertRecurringTask(db, { status: "dropped" });
    await expandDueDateWindowJob(db);

    const rows = await db.select().from(occurrences).where(eq(occurrences.parentId, taskId));
    expect(rows).toHaveLength(0);
  });

  it("generates zero occurrences for an archived recurring task", async () => {
    const taskId = await insertRecurringTask(db, { archivedAt: new Date() });
    await expandDueDateWindowJob(db);

    const rows = await db.select().from(occurrences).where(eq(occurrences.parentId, taskId));
    expect(rows).toHaveLength(0);
  });

  // Mirrors the two task cases above -- events gained their own archive
  // axis at Checkpoint 4.1 (packages/db/src/schema/events.ts's archivedAt),
  // and the same cron regression the task filter guards against applies to
  // events: without isNull(events.archivedAt) in the query, the nightly job
  // would keep silently regenerating occurrences for an archived recurring
  // event.
  it("expands occurrences for an active, unarchived recurring event", async () => {
    const eventId = await insertRecurringEvent(db, {});
    await expandDueDateWindowJob(db);

    const rows = await db.select().from(occurrences).where(eq(occurrences.parentId, eventId));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("generates zero occurrences for an archived recurring event", async () => {
    const eventId = await insertRecurringEvent(db, { archivedAt: new Date() });
    await expandDueDateWindowJob(db);

    const rows = await db.select().from(occurrences).where(eq(occurrences.parentId, eventId));
    expect(rows).toHaveLength(0);
  });

  // Regression coverage for the buildEventRecurrenceRule fix: a canonical
  // all-day recurring event (starts_at NULL, start_date set) must now
  // materialize occurrences rows instead of being silently skipped by the
  // old `!event.startsAt` guard.
  it("expands occurrences for a canonical all-day recurring event", async () => {
    const eventId = await insertRecurringAllDayEvent(db, {});
    await expandDueDateWindowJob(db);

    const rows = await db.select().from(occurrences).where(eq(occurrences.parentId, eventId));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("lands each generated all-day instance on its own correct calendar date, one week apart", async () => {
    const eventId = await insertRecurringAllDayEvent(db, { startDate: "2026-01-05" });
    await expandDueDateWindowJob(db);

    const rows = await db
      .select()
      .from(occurrences)
      .where(eq(occurrences.parentId, eventId))
      .orderBy(occurrences.occursAt);

    expect(rows.length).toBeGreaterThan(0);
    // occursLocal is stored via wallClockToNaiveDate -- a Date whose UTC
    // fields encode the wall-clock components (see packages/core/src/timezone.ts).
    // Every instance should be a Monday (matching 2026-01-05), exactly 7 days
    // apart from the previous one.
    const localDates = rows.map((row) => row.occursLocal);
    for (let i = 0; i < localDates.length; i++) {
      expect(localDates[i]!.getUTCDay()).toBe(1); // Monday
      if (i > 0) {
        const diffDays =
          (localDates[i]!.getTime() - localDates[i - 1]!.getTime()) / (24 * 60 * 60 * 1000);
        expect(diffDays).toBe(7);
      }
    }
  });

  it("generates zero occurrences for an archived canonical all-day recurring event", async () => {
    const eventId = await insertRecurringAllDayEvent(db, { archivedAt: new Date() });
    await expandDueDateWindowJob(db);

    const rows = await db.select().from(occurrences).where(eq(occurrences.parentId, eventId));
    expect(rows).toHaveLength(0);
  });

  it("is idempotent -- re-running the job produces no duplicate rows for a canonical all-day event", async () => {
    const eventId = await insertRecurringAllDayEvent(db, {});
    await expandDueDateWindowJob(db);
    const firstRun = await db.select().from(occurrences).where(eq(occurrences.parentId, eventId));

    await expandDueDateWindowJob(db);
    const secondRun = await db.select().from(occurrences).where(eq(occurrences.parentId, eventId));

    expect(secondRun).toHaveLength(firstRun.length);
  });

  it("is idempotent -- re-running the job produces no duplicate rows for a timed recurring task", async () => {
    const taskId = await insertRecurringTask(db, {});
    await expandDueDateWindowJob(db);
    const firstRun = await db.select().from(occurrences).where(eq(occurrences.parentId, taskId));

    await expandDueDateWindowJob(db);
    const secondRun = await db.select().from(occurrences).where(eq(occurrences.parentId, taskId));

    expect(secondRun).toHaveLength(firstRun.length);
  });
});

// ---------------------------------------------------------------------------
// Per-parent containment. Checkpoint 9.0.
// ---------------------------------------------------------------------------
//
// Before this, the job ran both loops bare: one parent whose rule could not be
// expanded threw out of the whole sweep, every parent after it was silently
// skipped that night, three retries hit the same parent, and there was no
// dead-letter queue to report the exhaustion. These pin the new contract: the
// bad parent is isolated, the good ones still expand, the sweep still FAILS so
// pg-boss retries and eventually dead-letters, and nothing raw reaches the
// thrown error or the log.
// Checkpoint 9.3 review: a due_date series with no due_at is materialized once
// at creation (POST /tasks and the capture commit both anchor the rule at the
// creation instant) and used to be skipped by this job forever after, so it
// stopped dead 90 days in. The job now anchors such a series on its earliest
// existing occurrence -- the seed the creator wrote, already truncated to
// seconds -- which reproduces the identical instants for the overlapping window
// and continues the series beyond it.
describe("expandDueDateWindowJob -- due_date series with no due_at", () => {
  const db = buildTestDb();
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(async () => {
    await truncateTestTables(db);
  });

  it("continues a creation-materialized series past its original window with identical overlapping instants", async () => {
    const taskId = await insertRecurringTask(db, {
      dueAt: null,
      rrule: "FREQ=DAILY;INTERVAL=1",
    });
    // Reproduce the creation-time materialization exactly as
    // commit-parsed-entity / POST /tasks do it, but from a creation instant
    // 60 days in the past: the rule anchored at that instant (wall clock,
    // seconds precision), expanded 90 days forward from it.
    const creationNow = new Date(Date.now() - 60 * DAY_MS);
    const { expandDueDateWindow, toWallClockComponents, wallClockToNaiveDate } =
      await import("@personal-os/core");
    const seedRule = {
      rrule: "FREQ=DAILY;INTERVAL=1",
      recurrenceTimezone: "America/Chicago",
      dtstart: toWallClockComponents(creationNow, "America/Chicago"),
    };
    const seeded = expandDueDateWindow(seedRule, 90, creationNow);
    expect(seeded.length).toBeGreaterThanOrEqual(88);
    for (const occurrence of seeded) {
      await db.insert(occurrences).values({
        parentType: "task",
        parentId: taskId,
        occursAt: occurrence.occursAt,
        occursLocal: wallClockToNaiveDate(occurrence.occursLocal),
        status: "scheduled",
        lazyGenerated: false,
      });
    }
    const before = await db.select().from(occurrences).where(eq(occurrences.parentId, taskId));
    const beforeInstants = new Set(before.map((row) => row.occursAt.getTime()));
    const seedAnchor = Math.min(...beforeInstants);

    await expandDueDateWindowJob(db);

    const after = await db.select().from(occurrences).where(eq(occurrences.parentId, taskId));
    const afterInstants = after.map((row) => row.occursAt.getTime());
    // Every pre-existing row survives untouched (ON CONFLICT DO NOTHING on the
    // identical instants -- no parallel series a few hundred ms off).
    expect(after.length).toBeGreaterThan(before.length);
    for (const instant of beforeInstants) expect(afterInstants).toContain(instant);
    // Every new row is a whole number of days after the seed anchor (same wall
    // clock in America/Chicago, allowing for a one-hour DST shift), lands
    // beyond the creation-time window, and inside the job's own 90-day window.
    const added = after.filter((row) => !beforeInstants.has(row.occursAt.getTime()));
    expect(added.length).toBeGreaterThan(0);
    const creationHorizon = creationNow.getTime() + 90 * DAY_MS;
    for (const row of added) {
      const offset = (row.occursAt.getTime() - seedAnchor) % DAY_MS;
      expect([0, 60 * 60 * 1000, 23 * 60 * 60 * 1000]).toContain(offset);
      expect(row.occursAt.getTime()).toBeGreaterThan(creationHorizon - DAY_MS);
      expect(row.occursAt.getTime()).toBeLessThanOrEqual(Date.now() + 91 * DAY_MS);
      expect(row.status).toBe("scheduled");
      expect(row.lazyGenerated).toBe(false);
    }
    // And a second run is a no-op.
    await expandDueDateWindowJob(db);
    const again = await db.select().from(occurrences).where(eq(occurrences.parentId, taskId));
    expect(again).toHaveLength(after.length);
  });

  it("still skips a due_at-less series that has no occurrence at all", async () => {
    const taskId = await insertRecurringTask(db, { dueAt: null });
    await expandDueDateWindowJob(db);
    const rows = await db.select().from(occurrences).where(eq(occurrences.parentId, taskId));
    expect(rows).toHaveLength(0);
  });
});

describe("expandDueDateWindowJob per-parent containment", () => {
  let db: Db;
  let records: Record<string, unknown>[];
  let restore: () => void;

  // A zone Intl does not know: `toWallClockComponents` throws a RangeError
  // whose message names the zone, so it is both a realistic persistent
  // per-item fault and a string the log must not carry.
  const BAD_ZONE = "Not/AZone";

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

  it("one unexpandable parent does not stop the others, and the sweep still fails", async () => {
    const badTaskId = await insertRecurringTask(db, { recurrenceTimezone: BAD_ZONE });
    const goodTaskId = await insertRecurringTask(db, {});
    // The events loop runs strictly AFTER the tasks loop, so a good event is
    // the deterministic proof that a throwing task no longer aborts the rest
    // of the sweep whatever order Postgres returns the task rows in.
    const goodEventId = await insertRecurringEvent(db, {});

    const caught = await expandDueDateWindowJob(db).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(OccurrencesJobError);
    expect((caught as OccurrencesJobError).failedParents).toBe(1);
    expect((caught as OccurrencesJobError).totalParents).toBe(3);
    expect((caught as Error).message).toBe(
      "occurrences.expand-window failed: 1 of 3 parents failed",
    );
    // The thrown error -- and therefore pgboss.job.output, and therefore the
    // dead job -- names WHICH parent, by id and type only.
    expect((caught as OccurrencesJobError).failedParentRefs).toEqual([
      { parentType: "task", parentId: badTaskId },
    ]);

    const bad = await db.select().from(occurrences).where(eq(occurrences.parentId, badTaskId));
    const good = await db.select().from(occurrences).where(eq(occurrences.parentId, goodTaskId));
    const event = await db.select().from(occurrences).where(eq(occurrences.parentId, goodEventId));
    expect(bad).toHaveLength(0);
    expect(good.length).toBeGreaterThan(0);
    expect(event.length).toBeGreaterThan(0);
  });

  it("records each failed parent by id and token, plus one summary line", async () => {
    const badTaskId = await insertRecurringTask(db, { recurrenceTimezone: BAD_ZONE });
    await insertRecurringEvent(db, {});

    await expandDueDateWindowJob(db).catch(() => undefined);

    const failed = records.filter((r) => r["event"] === "occurrences.expand_window.parent_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      level: "warn",
      parentType: "task",
      parentId: badTaskId,
      error: "RangeError",
    });
    const summary = records.find((r) => r["event"] === "occurrences.expand_window.completed");
    expect(summary).toMatchObject({ tasks: 1, events: 1, attempted: 2, failed: 1 });
  });

  it("carries neither the zone, the rule nor an error message anywhere", async () => {
    await insertRecurringTask(db, { recurrenceTimezone: BAD_ZONE, title: "Pay rent to landlord" });

    const caught = await expandDueDateWindowJob(db).catch((err: unknown) => err);

    const thrown = JSON.stringify({
      ...(caught as object),
      message: (caught as Error).message,
      stack: (caught as Error).stack,
    });
    const logged = JSON.stringify(records);
    for (const forbidden of [BAD_ZONE, "Invalid time zone", "FREQ=", "landlord"]) {
      expect(thrown).not.toContain(forbidden);
      expect(logged).not.toContain(forbidden);
    }
  });

  it("still succeeds cleanly, with a summary line, when nothing fails", async () => {
    await insertRecurringTask(db, {});
    await expect(expandDueDateWindowJob(db)).resolves.toBeUndefined();
    expect(records.find((r) => r["event"] === "occurrences.expand_window.completed")).toMatchObject(
      { failed: 0, attempted: 1 },
    );
  });

  it("the pg-boss factory contains the sweep's own failure unchanged", async () => {
    // The counts-carrying error passes through the wrapper as-is, so
    // pgboss.job.output keeps "1 of 1 parents failed" rather than a bare
    // "failed"; anything else thrown is wrapped by the same class.
    await insertRecurringTask(db, { recurrenceTimezone: BAD_ZONE });
    const caught = await createExpandDueDateWindowHandler(db)([]).catch((err: unknown) => err);
    expect(caught).toBeInstanceOf(OccurrencesJobError);
    expect((caught as OccurrencesJobError).failedParents).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 -- lazy reconciliation. Checkpoint 9.4.
// ---------------------------------------------------------------------------
//
// A completion-anchored task must hold exactly one open occurrence. The API's
// in-transaction successor and generate-lazy's re-check keep that on every path
// that runs; a completion recorded while pg-boss was down, or a successor that
// dead-lettered, leaves a task with a terminal history and nothing open --
// which nothing else ever repairs. The nightly sweep now does, from the same
// inputs the on-line writers use, with the same per-parent containment.
describe("expandDueDateWindowJob -- lazy reconciliation (9.4)", () => {
  let db: Db;
  let records: Record<string, unknown>[];
  let restore: () => void;
  const RULE = "FREQ=DAILY;INTERVAL=3";

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

  async function insertLazyTask(overrides: Partial<typeof tasks.$inferInsert> = {}) {
    return insertRecurringTask(db, {
      title: "Water the plants",
      dueAt: null,
      rrule: RULE,
      recurrenceAnchor: "completion_date",
      ...overrides,
    });
  }

  // A 09:00 CDT occurrence completed at 21:47 CDT the same day. The successor
  // must be three days after the completion's local DATE at the occurrence's
  // own wall time: 2026-09-13 09:00 CDT.
  const OCCURS_AT = new Date("2026-09-10T14:00:00Z");
  const OCCURS_LOCAL = new Date("2026-09-10T09:00:00Z");
  const COMPLETED_AT = new Date("2026-09-11T02:47:00Z");
  const EXPECTED_SUCCESSOR = "2026-09-13T14:00:00.000Z";

  async function insertTerminal(
    taskId: string,
    overrides: Partial<typeof occurrences.$inferInsert> = {},
  ): Promise<string> {
    const [row] = await db
      .insert(occurrences)
      .values({
        parentType: "task",
        parentId: taskId,
        occursAt: OCCURS_AT,
        occursLocal: OCCURS_LOCAL,
        status: "done",
        lazyGenerated: true,
        completedAt: COMPLETED_AT,
        ...overrides,
      })
      .returning({ id: occurrences.id });
    return row!.id;
  }

  async function rowsFor(taskId: string) {
    return db
      .select()
      .from(occurrences)
      .where(eq(occurrences.parentId, taskId))
      .orderBy(occurrences.occursAt);
  }

  function summary() {
    return records.find((r) => r["event"] === "occurrences.reconcile_lazy.completed");
  }

  it("repairs a lazy parent with no open occurrence: successor at completed_at + interval, at the completed row's wall time", async () => {
    const taskId = await insertLazyTask();
    await insertTerminal(taskId);

    await expect(expandDueDateWindowJob(db)).resolves.toBeUndefined();

    const rows = await rowsFor(taskId);
    expect(rows).toHaveLength(2);
    const successor = rows[1]!;
    expect(successor.status).toBe("scheduled");
    expect(successor.lazyGenerated).toBe(true);
    expect(successor.occursAt.toISOString()).toBe(EXPECTED_SUCCESSOR);
    // 09:00, not 21:47.
    expect(successor.occursLocal.getUTCHours()).toBe(9);
    expect(successor.occursLocal.getUTCMinutes()).toBe(0);
    expect(summary()).toMatchObject({ level: "info", candidates: 1, repaired: 1, failed: 0 });
    expect(records.find((r) => r["event"] === "occurrences.reconcile_lazy.repaired")).toMatchObject(
      { taskId, occurrenceId: successor.id },
    );
  });

  it("anchors a skipped row from its skip instant, exactly as the on-line writers do", async () => {
    const taskId = await insertLazyTask();
    await insertTerminal(taskId, { status: "skipped" });
    await expandDueDateWindowJob(db);
    const rows = await rowsFor(taskId);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.occursAt.toISOString()).toBe(EXPECTED_SUCCESSOR);
  });

  it("repairs from the LATEST terminal row by completed_at, not the latest by occurs_at", async () => {
    const taskId = await insertLazyTask();
    // An older occurrence completed late -- after the newer one was skipped.
    await insertTerminal(taskId, {
      occursAt: new Date("2026-09-04T14:00:00Z"),
      occursLocal: new Date("2026-09-04T09:00:00Z"),
      completedAt: new Date("2026-09-12T02:47:00Z"), // 09-11 21:47 CDT
    });
    await insertTerminal(taskId, {
      status: "skipped",
      completedAt: new Date("2026-09-11T02:47:00Z"), // 09-10 21:47 CDT
    });

    await expandDueDateWindowJob(db);

    const open = (await rowsFor(taskId)).filter((r) => r.status === "scheduled");
    expect(open).toHaveLength(1);
    // Three days after 09-11 (the late completion), at 09:00 CDT.
    expect(open[0]!.occursAt.toISOString()).toBe("2026-09-14T14:00:00.000Z");
  });

  it("does nothing when an open occurrence already exists, lazy or not", async () => {
    for (const lazy of [true, false]) {
      const taskId = await insertLazyTask();
      await insertTerminal(taskId);
      const [open] = await db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: taskId,
          occursAt: new Date("2026-09-20T14:00:00Z"),
          occursLocal: new Date("2026-09-20T09:00:00Z"),
          status: "scheduled",
          lazyGenerated: lazy,
        })
        .returning({ id: occurrences.id });

      await expandDueDateWindowJob(db);

      const rows = await rowsFor(taskId);
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.status === "scheduled").map((r) => r.id)).toEqual([open!.id]);
    }
    expect(summary()).toMatchObject({ candidates: 0, repaired: 0, failed: 0 });
  });

  it("treats an inbox parent as open and repairs it", async () => {
    const taskId = await insertLazyTask({ status: "inbox" });
    await insertTerminal(taskId);
    await expandDueDateWindowJob(db);
    expect((await rowsFor(taskId)).filter((r) => r.status === "scheduled")).toHaveLength(1);
  });

  it.each([
    ["dropped", { status: "dropped" as const }],
    ["done", { status: "done" as const }],
    ["archived", { archivedAt: new Date("2026-09-12T00:00:00Z") }],
  ])("skips a %s parent entirely", async (_label, overrides) => {
    const taskId = await insertLazyTask(overrides);
    await insertTerminal(taskId);
    await expandDueDateWindowJob(db);
    expect(await rowsFor(taskId)).toHaveLength(1);
    expect(summary()).toMatchObject({ candidates: 0 });
  });

  it("skips a parent with no terminal history -- there is no instant to repair from", async () => {
    const taskId = await insertLazyTask();
    // A terminal row with no completed_at is not history either.
    await insertTerminal(taskId, { completedAt: null });
    await expandDueDateWindowJob(db);
    expect(await rowsFor(taskId)).toHaveLength(1);
    expect(summary()).toMatchObject({ candidates: 0, repaired: 0 });
  });

  it("never touches a due_date parent, whatever its occurrence state", async () => {
    const taskId = await insertRecurringTask(db, {
      dueAt: null,
      rrule: RULE,
      recurrenceAnchor: "due_date",
    });
    // Only a terminal row, so phase 1 anchors on it and phase 2 must not.
    await insertTerminal(taskId, { lazyGenerated: false });
    await expandDueDateWindowJob(db);
    const rows = await rowsFor(taskId);
    expect(rows.some((r) => r.lazyGenerated)).toBe(false);
    expect(summary()).toMatchObject({ candidates: 0 });
  });

  it("is idempotent: a second run repairs nothing and adds no row", async () => {
    const taskId = await insertLazyTask();
    await insertTerminal(taskId);
    await expandDueDateWindowJob(db);
    const first = await rowsFor(taskId);
    records = [];

    await expandDueDateWindowJob(db);

    expect(await rowsFor(taskId)).toHaveLength(first.length);
    expect(summary()).toMatchObject({ candidates: 0, repaired: 0, failed: 0 });
  });

  it("contains a malformed stored rule: counted, others still repaired, sweep fails with the id", async () => {
    // A BY* part on a completion-anchored rule -- refused at write time now,
    // but a row stored before that check existed is still in the table.
    const badTaskId = await insertLazyTask({ rrule: "FREQ=DAILY;BYDAY=MO" });
    await insertTerminal(badTaskId);
    const goodTaskId = await insertLazyTask();
    await insertTerminal(goodTaskId);
    // Phase 1 still runs and still succeeds for its own parents.
    const eventId = await insertRecurringEvent(db, {});

    const caught = await expandDueDateWindowJob(db).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(OccurrencesJobError);
    expect((caught as OccurrencesJobError).failedParentRefs).toEqual([
      { parentType: "task", parentId: badTaskId },
    ]);
    expect((caught as OccurrencesJobError).failedParents).toBe(1);
    // One event in phase 1 plus two candidates in phase 2.
    expect((caught as OccurrencesJobError).totalParents).toBe(3);
    expect((caught as Error).message).toBe(
      "occurrences.expand-window failed: 1 of 3 parents failed",
    );
    expect(await rowsFor(badTaskId)).toHaveLength(1);
    expect((await rowsFor(goodTaskId)).filter((r) => r.status === "scheduled")).toHaveLength(1);
    expect((await rowsFor(eventId)).length).toBeGreaterThan(0);
    expect(summary()).toMatchObject({ candidates: 2, repaired: 1, failed: 1 });
    expect(
      records.find((r) => r["event"] === "occurrences.reconcile_lazy.parent_failed"),
    ).toMatchObject({ level: "warn", parentType: "task", parentId: badTaskId, error: "Error" });
  });

  it("carries neither the rule, the title nor an error message anywhere", async () => {
    const taskId = await insertLazyTask({
      rrule: "FREQ=DAILY;BYDAY=MO",
      title: "Pay the landlord",
    });
    await insertTerminal(taskId);

    const caught = await expandDueDateWindowJob(db).catch((err: unknown) => err);

    const thrown = JSON.stringify({
      ...(caught as object),
      message: (caught as Error).message,
      stack: (caught as Error).stack,
    });
    const logged = JSON.stringify(records);
    for (const forbidden of ["BYDAY", "FREQ=", "landlord", "may only use"]) {
      expect(thrown).not.toContain(forbidden);
      expect(logged).not.toContain(forbidden);
    }
  });

  it("the pg-boss factory contains a phase-2 failure unchanged, with its counts", async () => {
    const taskId = await insertLazyTask({ rrule: "FREQ=DAILY;BYDAY=MO" });
    await insertTerminal(taskId);
    const caught = await createExpandDueDateWindowHandler(db)([]).catch((err: unknown) => err);
    expect(caught).toBeInstanceOf(OccurrencesJobError);
    expect((caught as OccurrencesJobError).failedParents).toBe(1);
    expect((caught as OccurrencesJobError).totalParents).toBe(1);
  });

  // 9.4 review: the repaired line says whether the successor it wrote is
  // already in the past. A days-old gap repaired overnight usually is; a
  // completion whose interval has not elapsed yet is not.
  it.each([
    ["overdue", COMPLETED_AT, true],
    ["still ahead", new Date("2030-09-11T02:47:00Z"), false],
  ])("flags the repaired successor as %s", async (_label, completedAt, overdue) => {
    const taskId = await insertLazyTask();
    await insertTerminal(taskId, { completedAt });
    await expandDueDateWindowJob(db);
    expect(records.find((r) => r["event"] === "occurrences.reconcile_lazy.repaired")).toMatchObject(
      { taskId, overdue },
    );
  });

  // 9.4 review repro, phase-2 edition: a Thursday 09:00 row completed the
  // Monday before. +3 days from the completion IS the completed row's own
  // instant, so without the exclusive `after` bound the insert conflicted
  // with the row it was repairing from, ON CONFLICT DO NOTHING swallowed it,
  // and the sweep reported `repaired:0 failed:0` for a parent still stuck.
  it("repairs an early completion with a successor strictly after the completed row", async () => {
    const taskId = await insertLazyTask();
    const thursdayNineAm = new Date("2026-09-17T14:00:00Z");
    await insertTerminal(taskId, {
      occursAt: thursdayNineAm,
      occursLocal: new Date("2026-09-17T09:00:00Z"),
      completedAt: new Date("2026-09-14T16:20:00Z"), // Mon 11:20 CDT
    });

    await expect(expandDueDateWindowJob(db)).resolves.toBeUndefined();

    const rows = await rowsFor(taskId);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.status).toBe("scheduled");
    expect(rows[1]!.occursAt.getTime()).toBeGreaterThan(thursdayNineAm.getTime());
    expect(rows[1]!.occursAt.toISOString()).toBe("2026-09-20T14:00:00.000Z");
    expect(rows[1]!.occursLocal.getUTCHours()).toBe(9);
    expect(summary()).toMatchObject({ candidates: 1, repaired: 1, failed: 0 });
  });

  // A closed row already at the computed instant: the insert is refused on
  // (parent, occurs_at), the parent STILL has nothing open, and that is a
  // failure the dead-letter/alert path must see -- not a quiet no-op.
  it("counts a collision that leaves the parent with nothing open as a failure", async () => {
    const taskId = await insertLazyTask();
    await insertTerminal(taskId);
    // The instant the pass computes, occupied by a skipped row with an OLDER
    // completion so the source row above stays the latest terminal.
    await insertTerminal(taskId, {
      occursAt: new Date(EXPECTED_SUCCESSOR),
      occursLocal: new Date("2026-09-13T09:00:00Z"),
      status: "skipped",
      completedAt: new Date("2026-09-09T00:00:00Z"),
    });
    const goodTaskId = await insertLazyTask();
    await insertTerminal(goodTaskId);

    const caught = await expandDueDateWindowJob(db).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(OccurrencesJobError);
    expect((caught as OccurrencesJobError).failedParentRefs).toEqual([
      { parentType: "task", parentId: taskId },
    ]);
    expect((caught as OccurrencesJobError).failedParents).toBe(1);
    expect((caught as OccurrencesJobError).totalParents).toBe(2);
    expect((await rowsFor(taskId)).filter((r) => r.status === "scheduled")).toHaveLength(0);
    expect((await rowsFor(goodTaskId)).filter((r) => r.status === "scheduled")).toHaveLength(1);
    expect(summary()).toMatchObject({ candidates: 2, repaired: 1, failed: 1 });
    expect(
      records.find((r) => r["event"] === "occurrences.reconcile_lazy.parent_failed"),
    ).toMatchObject({
      level: "warn",
      parentType: "task",
      parentId: taskId,
      reason: "collision",
      error: "LazySuccessorCollisionError",
    });
    expect(
      records.some(
        (r) => r["event"] === "occurrences.reconcile_lazy.repaired" && r["taskId"] === taskId,
      ),
    ).toBe(false);
    const logged = JSON.stringify(records);
    expect(logged).not.toContain("Water");
    expect(logged).not.toContain("FREQ");
  });

  // The other way the insert can return nothing: a completion committed its
  // own successor between the candidate read and the insert, so the partial
  // one_open_occurrence_per_lazy_parent index refuses the sweep's row. The
  // parent is fine, and it must be counted as neither repaired nor failed.
  // Made deterministic the same way generate-lazy-occurrence.test.ts does:
  // an uncommitted transaction holds the key, the sweep's insert blocks on
  // its XID, and it commits only once the sweep is observed waiting.
  it("does not count a parent whose successor landed under the sweep as failed", async () => {
    const taskId = await insertLazyTask();
    await insertTerminal(taskId);

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

    const run = expandDueDateWindowJob(db);
    const deadline = Date.now() + 10_000;
    for (;;) {
      const { rows } = await db.execute<{ n: string }>(
        sql`select count(*)::text as n from pg_stat_activity
            where wait_event_type = 'Lock' and datname = current_database()`,
      );
      if (Number(rows[0]?.n ?? "0") > 0) break;
      if (Date.now() > deadline) throw new Error("sweep never blocked on the lock");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    releaseConcurrent();
    await concurrent;

    await expect(run).resolves.toBeUndefined();
    const open = (await rowsFor(taskId)).filter((r) => r.status === "scheduled");
    expect(open).toHaveLength(1);
    expect(open[0]!.id).toBe(concurrentId);
    expect(summary()).toMatchObject({ candidates: 1, repaired: 0, failed: 0 });
    expect(records.find((r) => r["event"] === "occurrences.reconcile_lazy.skipped")).toMatchObject({
      taskId,
      reason: "successor_exists",
      openOccurrenceId: concurrentId,
    });
  });
});

// The shared anchor (Checkpoint 9.4): a due_at-less series must keep its
// original wall-clock time when the nightly job re-expands it. resolveSeriesAnchor
// puts the parent's earliest occurrence before `now`, so the re-expansion
// reproduces the seed's instants rather than minting a parallel series at the
// time the sweep happened to run.
describe("expandDueDateWindowJob -- series anchor agreement (9.4)", () => {
  const db = buildTestDb();

  beforeEach(async () => {
    await truncateTestTables(db);
  });

  it("a due_at-less series keeps its original wall time on re-expansion", async () => {
    const taskId = await insertRecurringTask(db, { dueAt: null, rrule: "FREQ=DAILY;INTERVAL=1" });
    // One seed only, at 07:30 America/Chicago, well inside the window so the
    // sweep has both an anchor and room to continue the series.
    const seedAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const { toWallClockComponents, wallClockToNaiveDate, resolveWallClockToInstant } =
      await import("@personal-os/core");
    const seedLocal = {
      ...toWallClockComponents(seedAt, "America/Chicago"),
      hour: 7,
      minute: 30,
      second: 0,
    };
    const seedInstant = resolveWallClockToInstant(seedLocal, "America/Chicago");
    await db.insert(occurrences).values({
      parentType: "task",
      parentId: taskId,
      occursAt: seedInstant,
      occursLocal: wallClockToNaiveDate(seedLocal),
      status: "scheduled",
      lazyGenerated: false,
    });

    await expandDueDateWindowJob(db);

    const rows = await db.select().from(occurrences).where(eq(occurrences.parentId, taskId));
    expect(rows.length).toBeGreaterThan(30);
    for (const row of rows) {
      // Every instance -- including across the next DST transition -- is at
      // 07:30 on the wall clock, which is what the seed established.
      expect(row.occursLocal.getUTCHours()).toBe(7);
      expect(row.occursLocal.getUTCMinutes()).toBe(30);
      const local = toWallClockComponents(row.occursAt, "America/Chicago");
      expect([local.hour, local.minute]).toEqual([7, 30]);
    }
    // The seed itself survived untouched (same instant, ON CONFLICT DO NOTHING).
    expect(rows.filter((r) => r.occursAt.getTime() === seedInstant.getTime())).toHaveLength(1);
  });

  it("a series with a due_at anchors on it even when older occurrences exist", async () => {
    const dueAt = new Date("2026-09-15T14:00:00Z"); // 09:00 CDT
    const taskId = await insertRecurringTask(db, { dueAt, rrule: "FREQ=DAILY;INTERVAL=1" });
    // A stray earlier row at a different wall time must NOT become the anchor.
    await db.insert(occurrences).values({
      parentType: "task",
      parentId: taskId,
      occursAt: new Date("2026-09-01T20:00:00Z"),
      occursLocal: new Date("2026-09-01T15:00:00Z"),
      status: "done",
      lazyGenerated: false,
      completedAt: new Date("2026-09-01T21:00:00Z"),
    });

    await expandDueDateWindowJob(db);

    const rows = await db.select().from(occurrences).where(eq(occurrences.parentId, taskId));
    const generated = rows.filter((r) => r.status === "scheduled");
    expect(generated.length).toBeGreaterThan(0);
    for (const row of generated) expect(row.occursLocal.getUTCHours()).toBe(9);
  });
});
