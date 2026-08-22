import { events, occurrences, tasks, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { expandDueDateWindowJob } from "./expand-due-date-window.js";

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
