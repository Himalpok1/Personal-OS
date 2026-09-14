import { events, occurrences, tasks, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
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
