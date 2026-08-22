import {
  localDayWindow,
  localDayWindowForDate,
  resolveWallClockToInstant,
  wallClockToNaiveDate,
  type WallClockComponents,
} from "@personal-os/core";
import { occurrences, tasks } from "@personal-os/db";
import type { ReviewRecentlyCompletedItem } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { collectRecentlyCompleted } from "./recent-completed.js";

const TZ = "America/Chicago";
const HOUR_MS = 60 * 60 * 1000;

// Same date arithmetic taste as the collector: anchor at noon UTC so adding
// whole days can never straddle a month boundary unexpectedly.
function addLocalDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day, 12) + days * 86_400_000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(next.getUTCFullYear()).padStart(4, "0")}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

describe("collectRecentlyCompleted", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
  });

  function components(localDate: string, hour: number, minute = 0): WallClockComponents {
    const [year, month, day] = localDate.split("-").map(Number);
    return { year: year!, month: month!, day: day!, hour, minute, second: 0 };
  }

  function atLocal(tz: string, localDate: string, hour: number, minute = 0): Date {
    return resolveWallClockToInstant(components(localDate, hour, minute), tz);
  }

  function naiveAt(localDate: string, hour: number, minute = 0): Date {
    return wallClockToNaiveDate(components(localDate, hour, minute));
  }

  async function insertTask(values: Partial<typeof tasks.$inferInsert> & { title: string }) {
    const [row] = await app.db
      .insert(tasks)
      .values({ timezone: TZ, ...values })
      .returning();
    return row!;
  }

  async function insertOccurrence(values: typeof occurrences.$inferInsert) {
    const [row] = await app.db.insert(occurrences).values(values).returning();
    return row!;
  }

  it("returns empty items and an honest zero total on an empty database", async () => {
    const result = await collectRecentlyCompleted(app.db, { tz: TZ });
    expect(result).toEqual({ items: [], total: 0 });
  });

  it("includes only done non-recurring tasks whose completed_at lands in [window start, effectiveNow]", async () => {
    const now = new Date();
    const today = localDayWindow(TZ, now).localDate;

    const recent = await insertTask({
      title: "Two days ago",
      status: "done",
      completedAt: atLocal(TZ, addLocalDays(today, -2), 12),
    });
    await insertTask({
      title: "Eight days ago",
      status: "done",
      completedAt: atLocal(TZ, addLocalDays(today, -8), 12),
    });
    await insertTask({
      title: "Dropped despite a stale completion stamp",
      status: "dropped",
      completedAt: atLocal(TZ, addLocalDays(today, -1), 12),
    });
    await insertTask({
      title: "Completed after effectiveNow",
      status: "done",
      completedAt: new Date(now.getTime() + HOUR_MS),
    });
    const boundary = await insertTask({
      title: "Completed exactly at effectiveNow",
      status: "done",
      completedAt: now,
    });

    const result = await collectRecentlyCompleted(app.db, { tz: TZ, now });

    expect(result.total).toBe(2);
    expect(result.items).toEqual([
      {
        kind: "task",
        id: boundary.id,
        title: "Completed exactly at effectiveNow",
        completed_at: boundary.completedAt!.toISOString(),
      },
      {
        kind: "task",
        id: recent.id,
        title: "Two days ago",
        completed_at: recent.completedAt!.toISOString(),
      },
    ]);
  });

  it("reports done occurrences under the PARENT task's title regardless of parent status, and excludes skipped occurrences", async () => {
    const now = new Date();
    const today = localDayWindow(TZ, now).localDate;

    const parent = await insertTask({
      title: "Water plants",
      status: "active",
      rrule: "FREQ=DAILY",
      recurrenceAnchor: "completion_date",
    });
    const done = await insertOccurrence({
      parentType: "task",
      parentId: parent.id,
      occursAt: atLocal(TZ, addLocalDays(today, -1), 9),
      occursLocal: naiveAt(addLocalDays(today, -1), 9),
      status: "done",
      completedAt: now,
    });
    await insertOccurrence({
      parentType: "task",
      parentId: parent.id,
      occursAt: atLocal(TZ, addLocalDays(today, -2), 9),
      occursLocal: naiveAt(addLocalDays(today, -2), 9),
      status: "skipped",
      completedAt: now,
    });

    const result = await collectRecentlyCompleted(app.db, { tz: TZ, now });

    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      {
        kind: "occurrence",
        occurrence_id: done.id,
        parent_task_id: parent.id,
        title: "Water plants",
        completed_at: now.toISOString(),
      },
    ]);
  });

  it("event-typed occurrences never masquerade as recently-completed task occurrences", async () => {
    const now = new Date();
    const today = localDayWindow(TZ, now).localDate;

    const standInRow = await insertTask({ title: "Event stand-in", status: "active" });
    await insertOccurrence({
      parentType: "event",
      parentId: standInRow.id,
      occursAt: atLocal(TZ, addLocalDays(today, -1), 9),
      occursLocal: naiveAt(addLocalDays(today, -1), 9),
      status: "done",
      completedAt: now,
    });

    const result = await collectRecentlyCompleted(app.db, { tz: TZ, now });
    expect(result).toEqual({ items: [], total: 0 });
  });

  it("keeps archived tasks whose completion falls inside the window -- the window governs, not archive state", async () => {
    const now = new Date();
    const today = localDayWindow(TZ, now).localDate;

    const archived = await insertTask({
      title: "Filed away right after finishing",
      status: "done",
      completedAt: atLocal(TZ, addLocalDays(today, -3), 12),
      archivedAt: new Date(now.getTime() - HOUR_MS),
    });

    const result = await collectRecentlyCompleted(app.db, { tz: TZ, now });

    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      {
        kind: "task",
        id: archived.id,
        title: "Filed away right after finishing",
        completed_at: archived.completedAt!.toISOString(),
      },
    ]);
  });

  it("structurally cannot double count: a recurring task row force-marked done in-window stays excluded by the rrule guard", async () => {
    const now = new Date();
    const today = localDayWindow(TZ, now).localDate;

    await insertTask({
      title: "Series row illegally flipped to done",
      status: "done",
      rrule: "FREQ=DAILY",
      recurrenceAnchor: "due_date",
      completedAt: atLocal(TZ, addLocalDays(today, -1), 12),
    });
    const plain = await insertTask({
      title: "Plain one-off done",
      status: "done",
      completedAt: atLocal(TZ, addLocalDays(today, -1), 13),
    });

    const result = await collectRecentlyCompleted(app.db, { tz: TZ, now });

    expect(result.total).toBe(1);
    expect(result.items.map((item) => (item.kind === "task" ? item.id : null))).toEqual([plain.id]);
  });

  it("orders merged kinds deterministically (completed_at desc, then kind, then id) and reports the honest total past the limit", async () => {
    const now = new Date();

    const expected: ReviewRecentlyCompletedItem[] = [];
    for (let i = 0; i < 6; i += 1) {
      const stamp = new Date(now.getTime() - i * HOUR_MS);
      const parent = await insertTask({
        title: `Series ${i}`,
        status: "active",
        rrule: "FREQ=DAILY",
      });
      const occ = await insertOccurrence({
        parentType: "task",
        parentId: parent.id,
        occursAt: new Date(stamp.getTime() - HOUR_MS),
        occursLocal: new Date(stamp.getTime() - HOUR_MS),
        status: "done",
        completedAt: stamp,
      });
      const task = await insertTask({
        title: `One-off ${i}`,
        status: "done",
        completedAt: stamp,
      });
      expected.push(
        {
          kind: "occurrence",
          occurrence_id: occ.id,
          parent_task_id: parent.id,
          title: `Series ${i}`,
          completed_at: stamp.toISOString(),
        },
        {
          kind: "task",
          id: task.id,
          title: `One-off ${i}`,
          completed_at: stamp.toISOString(),
        },
      );
    }

    const defaulted = await collectRecentlyCompleted(app.db, { tz: TZ, now });
    expect(defaulted.total).toBe(12);
    expect(defaulted.items).toHaveLength(10);
    expect(defaulted.items).toEqual(expected.slice(0, 10));

    const capped = await collectRecentlyCompleted(app.db, { tz: TZ, now, limit: 3 });
    expect(capped.total).toBe(12);
    expect(capped.items).toHaveLength(3);
    expect(capped.items).toEqual(expected.slice(0, 3));
  });

  it("draws the window's lower boundary from the requested tz's calendar, so 23:59 the night before misses and local midnight hits", async () => {
    const now = atLocal(TZ, "2026-08-20", 12);
    const today = localDayWindow(TZ, now).localDate;
    expect(today).toBe("2026-08-20");

    await insertTask({
      title: "23:59:59 local on day -7",
      status: "done",
      completedAt: atLocal(TZ, addLocalDays(today, -7), 23, 59),
    });
    const atBoundary = await insertTask({
      title: "00:00:00 local on day -6",
      status: "done",
      completedAt: atLocal(TZ, addLocalDays(today, -6), 0, 0),
    });

    const result = await collectRecentlyCompleted(app.db, { tz: TZ, now });

    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      {
        kind: "task",
        id: atBoundary.id,
        title: "00:00:00 local on day -6",
        completed_at: atBoundary.completedAt!.toISOString(),
      },
    ]);

    // Same two completions viewed from Tokyo (UTC+9): its local calendar runs
    // ~14-15h ahead, so its 7-day window starts LATER in absolute terms and
    // the Chicago-boundary completion falls out on the wrong side entirely.
    const tokyoResult = await collectRecentlyCompleted(app.db, { tz: "Asia/Tokyo", now });
    expect(localDayWindowForDate("Asia/Tokyo", "2026-08-15").startUtc.getTime()).toBeGreaterThan(
      atBoundary.completedAt!.getTime(),
    );
    expect(tokyoResult.total).toBe(0);
  });
});
