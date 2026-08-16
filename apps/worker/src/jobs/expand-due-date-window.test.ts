import { occurrences, tasks, type Db } from "@personal-os/db";
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
});
