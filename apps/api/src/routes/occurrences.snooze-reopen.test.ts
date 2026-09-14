import {
  MAX_SNOOZE_DAYS,
  type Occurrence,
  type OccurrenceReopenResponse,
} from "@personal-os/schema";
import { occurrences, tasks } from "@personal-os/db";
import { resolveWallClockToInstant, toWallClockComponents } from "@personal-os/core";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody, Paginated } from "../test/types.js";

// Checkpoint 9.4: snooze acts on ONE occurrence and nothing else; reopen undoes
// a complete/skip and, for a completion_date parent, withdraws the derived
// successor first; a lazy successor keeps the previous occurrence's wall-clock
// time of day.

const TZ = "America/Chicago";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// `daysFromToday` at `hour`:00 local, as the instant AND the naive
// occurs_local the recurrence engine would have written for it (wall-clock
// fields on the UTC getters, the wallClockToNaiveDate convention).
function localOccurrence(
  daysFromToday: number,
  hour: number,
): { occursAt: Date; occursLocal: Date } {
  const today = toWallClockComponents(new Date(), TZ);
  const shifted = new Date(Date.UTC(today.year, today.month - 1, today.day + daysFromToday, 12));
  const wall = {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour,
    minute: 0,
    second: 0,
  };
  return {
    occursAt: resolveWallClockToInstant(wall, TZ),
    occursLocal: new Date(Date.UTC(wall.year, wall.month - 1, wall.day, hour, 0, 0)),
  };
}

describe("POST /occurrences/:id/snooze | reopen", () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function insertTask(
    overrides: Partial<typeof tasks.$inferInsert> = {},
  ): Promise<typeof tasks.$inferSelect> {
    const [row] = await app.db
      .insert(tasks)
      .values({ title: "Water the plants", status: "active", timezone: TZ, ...overrides })
      .returning();
    return row!;
  }

  async function insertOccurrence(
    taskId: string,
    overrides: Partial<typeof occurrences.$inferInsert> = {},
  ): Promise<typeof occurrences.$inferSelect> {
    const at = overrides.occursAt ?? new Date();
    const [row] = await app.db
      .insert(occurrences)
      .values({
        parentType: "task",
        parentId: taskId,
        occursAt: at,
        occursLocal: at,
        status: "scheduled",
        lazyGenerated: false,
        ...overrides,
      })
      .returning();
    return row!;
  }

  async function occurrencesOf(taskId: string) {
    return app.db
      .select()
      .from(occurrences)
      .where(eq(occurrences.parentId, taskId))
      .orderBy(asc(occurrences.occursAt));
  }

  async function insertEventOccurrence(
    status: "scheduled" | "done",
  ): Promise<typeof occurrences.$inferSelect> {
    const [row] = await app.db
      .insert(occurrences)
      .values({
        parentType: "event",
        parentId: "22222222-2222-4222-8222-222222222222",
        occursAt: new Date(),
        occursLocal: new Date(),
        status,
        completedAt: status === "done" ? new Date() : null,
      })
      .returning();
    return row!;
  }

  const dueDate = {
    rrule: "FREQ=DAILY",
    recurrenceTimezone: TZ,
    recurrenceAnchor: "due_date",
  } as const;
  const completionDate = {
    rrule: "FREQ=DAILY;INTERVAL=3",
    recurrenceTimezone: TZ,
    recurrenceAnchor: "completion_date",
  } as const;

  describe("snooze", () => {
    it("sets ONLY snoozed_until, returns the occurrence with it, and leaves the parent untouched", async () => {
      const task = await insertTask({ ...dueDate, dueAt: new Date(), remindAt: new Date() });
      const open = await insertOccurrence(task.id);
      const until = new Date(Date.now() + 2 * HOUR_MS);

      const response = await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/snooze`,
        payload: { until: until.toISOString() },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<Occurrence>();
      expect(body.id).toBe(open.id);
      expect(body.status).toBe("scheduled");
      expect(body.snoozed_until).toBe(until.toISOString());
      expect(body.occurs_at).toBe(open.occursAt.toISOString());

      const [row] = await app.db.select().from(occurrences).where(eq(occurrences.id, open.id));
      expect(row!.snoozedUntil!.getTime()).toBe(until.getTime());
      expect(row!.occursAt.getTime()).toBe(open.occursAt.getTime());
      expect(row!.occursLocal.getTime()).toBe(open.occursLocal.getTime());
      expect(row!.status).toBe("scheduled");
      expect(row!.completedAt).toBeNull();

      const [parent] = await app.db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(parent).toEqual(task);
    });

    it("is idempotent: repeating the same until re-writes the same value, a new until replaces it", async () => {
      const task = await insertTask(dueDate);
      const open = await insertOccurrence(task.id);
      const first = new Date(Date.now() + 3 * HOUR_MS);
      const second = new Date(Date.now() + 5 * HOUR_MS);

      for (const until of [first, first, second]) {
        const response = await app.inject({
          method: "POST",
          url: `/occurrences/${open.id}/snooze`,
          payload: { until: until.toISOString() },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json<Occurrence>().snoozed_until).toBe(until.toISOString());
      }
      const [row] = await app.db.select().from(occurrences).where(eq(occurrences.id, open.id));
      expect(row!.snoozedUntil!.getTime()).toBe(second.getTime());
      expect(await occurrencesOf(task.id)).toHaveLength(1);
    });

    it.each(["done", "skipped"] as const)(
      "409 occurrence_not_open on a %s occurrence, writing nothing",
      async (status) => {
        const task = await insertTask(dueDate);
        const terminal = await insertOccurrence(task.id, { status, completedAt: new Date() });
        const response = await app.inject({
          method: "POST",
          url: `/occurrences/${terminal.id}/snooze`,
          payload: { until: new Date(Date.now() + HOUR_MS).toISOString() },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json<ErrorBody>().error).toBe("occurrence_not_open");
        const [row] = await app.db
          .select()
          .from(occurrences)
          .where(eq(occurrences.id, terminal.id));
        expect(row!.snoozedUntil).toBeNull();
        expect(row!.status).toBe(status);
      },
    );

    it("404s for an unknown occurrence", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/occurrences/00000000-0000-0000-0000-000000000000/snooze",
        payload: { until: new Date(Date.now() + HOUR_MS).toISOString() },
      });
      expect(response.statusCode).toBe(404);
    });

    it("409 occurrence_not_task for an event occurrence, writing nothing", async () => {
      const event = await insertEventOccurrence("scheduled");
      const response = await app.inject({
        method: "POST",
        url: `/occurrences/${event.id}/snooze`,
        payload: { until: new Date(Date.now() + HOUR_MS).toISOString() },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>().error).toBe("occurrence_not_task");
      const [row] = await app.db.select().from(occurrences).where(eq(occurrences.id, event.id));
      expect(row!.snoozedUntil).toBeNull();
    });

    it.each([
      ["in the past", -HOUR_MS],
      ["exactly now-ish (one second ago)", -1000],
      ["beyond MAX_SNOOZE_DAYS", (MAX_SNOOZE_DAYS + 1) * DAY_MS],
    ])("400 validation_failed on path [until] when until is %s", async (_label, offsetMs) => {
      const task = await insertTask(dueDate);
      const open = await insertOccurrence(task.id);
      const response = await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/snooze`,
        payload: { until: new Date(Date.now() + offsetMs).toISOString() },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "validation_failed",
        issues: [{ path: ["until"], message: "snooze_out_of_range" }],
      });
      const [row] = await app.db.select().from(occurrences).where(eq(occurrences.id, open.id));
      expect(row!.snoozedUntil).toBeNull();
    });

    it("accepts an until inside MAX_SNOOZE_DAYS and rejects a malformed or extra field", async () => {
      const task = await insertTask(dueDate);
      const open = await insertOccurrence(task.id);
      const ok = await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/snooze`,
        payload: { until: new Date(Date.now() + (MAX_SNOOZE_DAYS - 1) * DAY_MS).toISOString() },
      });
      expect(ok.statusCode).toBe(200);

      const malformed = await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/snooze`,
        payload: { until: "tomorrow" },
      });
      expect(malformed.statusCode).toBe(400);
      const extra = await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/snooze`,
        payload: { until: new Date(Date.now() + HOUR_MS).toISOString(), occurs_at: "x" },
      });
      expect(extra.statusCode).toBe(400);
    });

    it("GET /occurrences lists snoozed_until and orders by occurs_at then id", async () => {
      const task = await insertTask(dueDate);
      const later = await insertOccurrence(task.id, { occursAt: new Date(Date.now() + DAY_MS) });
      const earlier = await insertOccurrence(task.id, { occursAt: new Date() });
      const until = new Date(Date.now() + HOUR_MS);
      await app.inject({
        method: "POST",
        url: `/occurrences/${earlier.id}/snooze`,
        payload: { until: until.toISOString() },
      });

      const response = await app.inject({
        method: "GET",
        url: `/occurrences?parent_type=task&parent_id=${task.id}`,
      });
      const body = response.json<Paginated<Occurrence>>();
      expect(body.items.map((item) => item.id)).toEqual([earlier.id, later.id]);
      expect(body.items[0]!.snoozed_until).toBe(until.toISOString());
      expect(body.items[1]!.snoozed_until).toBeNull();

      // order=desc reverses the order (the Undo lookup for "latest terminal
      // row" reads page one of this); an explicit asc matches the default,
      // and an unknown value is a 400 like any other query-schema failure.
      const descending = await app.inject({
        method: "GET",
        url: `/occurrences?parent_type=task&parent_id=${task.id}&order=desc`,
      });
      expect(descending.json<Paginated<Occurrence>>().items.map((item) => item.id)).toEqual([
        later.id,
        earlier.id,
      ]);
      const ascending = await app.inject({
        method: "GET",
        url: `/occurrences?parent_type=task&parent_id=${task.id}&order=asc`,
      });
      expect(ascending.json<Paginated<Occurrence>>().items.map((item) => item.id)).toEqual([
        earlier.id,
        later.id,
      ]);
      const bad = await app.inject({
        method: "GET",
        url: `/occurrences?parent_type=task&parent_id=${task.id}&order=sideways`,
      });
      expect(bad.statusCode).toBe(400);
    });
  });

  describe("complete/skip clear the snooze and keep the wall-clock time", () => {
    it("clears snoozed_until on the transition", async () => {
      const task = await insertTask(dueDate);
      const open = await insertOccurrence(task.id);
      await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/snooze`,
        payload: { until: new Date(Date.now() + HOUR_MS).toISOString() },
      });
      const response = await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/complete`,
      });
      expect(response.statusCode).toBe(200);
      const [row] = await app.db.select().from(occurrences).where(eq(occurrences.id, open.id));
      expect(row!.status).toBe("done");
      expect(row!.snoozedUntil).toBeNull();
    });

    it("the lazy successor lands at the previous occurrence's wall-clock time, not the completion time", async () => {
      const task = await insertTask(completionDate);
      vi.spyOn(app.boss, "send").mockResolvedValue(null);
      // The open occurrence is at 09:00 local; occurs_local is written the
      // way the recurrence engine writes it (naive wall clock as UTC fields).
      const local = toWallClockComponents(new Date(), TZ);
      const occursLocal = new Date(Date.UTC(local.year, local.month - 1, local.day, 9, 0, 0));
      const open = await insertOccurrence(task.id, {
        occursAt: new Date(),
        occursLocal,
        lazyGenerated: true,
      });

      const response = await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/complete`,
      });
      expect(response.statusCode).toBe(200);

      const rows = await occurrencesOf(task.id);
      const successor = rows.find((r) => r.id !== open.id)!;
      expect(successor.status).toBe("scheduled");
      expect(successor.lazyGenerated).toBe(true);
      const successorLocal = toWallClockComponents(successor.occursAt, TZ);
      expect([successorLocal.hour, successorLocal.minute, successorLocal.second]).toEqual([
        9, 0, 0,
      ]);
      // And occurs_local agrees with occurs_at on the wall clock.
      expect(successor.occursLocal.getUTCHours()).toBe(9);
      // Three days after the completion's local date.
      const completedLocal = toWallClockComponents(successor.occursAt, TZ);
      const dayDelta = Math.round(
        (Date.UTC(completedLocal.year, completedLocal.month - 1, completedLocal.day) -
          Date.UTC(local.year, local.month - 1, local.day)) /
          DAY_MS,
      );
      expect(dayDelta).toBe(3);
    });

    it.each(["complete", "skip"] as const)(
      "%s of a successor on the day it was created lands the next one strictly after it (exactly one open row)",
      async (verb) => {
        // The reviewer repro. Seed at 09:00 today; complete it today -> the
        // successor is +3 days at 09:00. Then act on THAT successor today, i.e.
        // three days early: completion date + INTERVAL is the successor's own
        // instant, which the unique key rejects -- without the `after` bound
        // the insert silently no-ops and the series ends. With it the next
        // row is the first instance strictly after the successor: +6 days.
        const task = await insertTask(completionDate);
        vi.spyOn(app.boss, "send").mockResolvedValue(null);
        const seed = await insertOccurrence(task.id, {
          ...localOccurrence(0, 9),
          lazyGenerated: true,
        });

        const first = await app.inject({ method: "POST", url: `/occurrences/${seed.id}/${verb}` });
        expect(first.statusCode).toBe(200);
        let rows = await occurrencesOf(task.id);
        expect(rows).toHaveLength(2);
        const successor = rows.find((r) => r.id !== seed.id)!;
        expect(successor.status).toBe("scheduled");
        expect(successor.occursAt.getTime()).toBe(localOccurrence(3, 9).occursAt.getTime());

        const second = await app.inject({
          method: "POST",
          url: `/occurrences/${successor.id}/${verb}`,
        });
        expect(second.statusCode).toBe(200);
        rows = await occurrencesOf(task.id);
        expect(rows).toHaveLength(3);
        const open = rows.filter((r) => r.status === "scheduled");
        expect(open).toHaveLength(1);
        expect(open[0]!.occursAt.getTime()).toBeGreaterThan(successor.occursAt.getTime());
        expect(open[0]!.occursAt.getTime()).toBe(localOccurrence(6, 9).occursAt.getTime());
        expect(open[0]!.occursLocal.getUTCHours()).toBe(9);
        expect(open[0]!.lazyGenerated).toBe(true);
      },
    );

    it("logs an ids-only warn when the successor insert collides and leaves nothing open", async () => {
      // A done row already holds the instant the successor would land on
      // (+3 days at 09:00). onConflictDoNothing makes that indistinguishable
      // from success unless the route looks; it must say so, ids only, and
      // still enqueue the worker re-check.
      const task = await insertTask(completionDate);
      const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);
      const warn = vi.spyOn(app.log, "warn");
      const seed = await insertOccurrence(task.id, {
        ...localOccurrence(0, 9),
        lazyGenerated: true,
      });
      const blocker = await insertOccurrence(task.id, {
        ...localOccurrence(3, 9),
        status: "done",
        completedAt: new Date(),
        lazyGenerated: true,
      });

      const response = await app.inject({
        method: "POST",
        url: `/occurrences/${seed.id}/complete`,
      });
      expect(response.statusCode).toBe(200);
      const rows = await occurrencesOf(task.id);
      expect(rows.map((r) => [r.id, r.status])).toEqual([
        [seed.id, "done"],
        [blocker.id, "done"],
      ]);
      const line = warn.mock.calls.find(
        (call) => typeof call[1] === "string" && call[1].includes("successor insert collided"),
      );
      expect(line).toBeDefined();
      expect(line![0]).toEqual({ occurrenceId: seed.id, taskId: task.id });
      expect(JSON.stringify(line)).not.toContain("Water the plants");
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("still returns 200 when the re-check cannot be enqueued: completion and successor are committed", async () => {
      const task = await insertTask(completionDate);
      vi.spyOn(app.boss, "send").mockRejectedValue(new Error("queue exploded"));
      const warn = vi.spyOn(app.log, "warn");
      const seed = await insertOccurrence(task.id, {
        ...localOccurrence(0, 9),
        lazyGenerated: true,
      });

      const response = await app.inject({
        method: "POST",
        url: `/occurrences/${seed.id}/complete`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ id: seed.id, status: "done" });
      const rows = await occurrencesOf(task.id);
      expect(rows.map((r) => r.status).sort()).toEqual(["done", "scheduled"]);
      const line = warn.mock.calls.find(
        (call) => typeof call[1] === "string" && call[1].includes("re-check could not be enqueued"),
      );
      expect(line).toBeDefined();
      expect(line![0]).toEqual({ occurrenceId: seed.id, error: "Error" });
      expect(JSON.stringify(line)).not.toContain("queue exploded");
    });
  });

  describe("reopen", () => {
    it("flips a done due_date occurrence back to scheduled, clearing completed_at and the snooze", async () => {
      const task = await insertTask(dueDate);
      const open = await insertOccurrence(task.id);
      await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/snooze`,
        payload: { until: new Date(Date.now() + HOUR_MS).toISOString() },
      });
      // Simulate a completion that (pre-9.4) kept the snooze on the row.
      await app.db
        .update(occurrences)
        .set({ status: "done", completedAt: new Date() })
        .where(eq(occurrences.id, open.id));

      const response = await app.inject({ method: "POST", url: `/occurrences/${open.id}/reopen` });
      expect(response.statusCode).toBe(200);
      expect(response.json<OccurrenceReopenResponse>()).toEqual({
        id: open.id,
        status: "scheduled",
        withdrawn_successor_id: null,
      });
      const [row] = await app.db.select().from(occurrences).where(eq(occurrences.id, open.id));
      expect(row!.status).toBe("scheduled");
      expect(row!.completedAt).toBeNull();
      expect(row!.snoozedUntil).toBeNull();
      expect(await occurrencesOf(task.id)).toHaveLength(1);
    });

    it("withdraws the lazy successor for a completion_date parent and leaves exactly one open row", async () => {
      const task = await insertTask(completionDate);
      const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);
      const open = await insertOccurrence(task.id, { lazyGenerated: true });
      const complete = await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/complete`,
      });
      expect(complete.statusCode).toBe(200);
      const successor = (await occurrencesOf(task.id)).find((r) => r.id !== open.id)!;
      expect(successor.status).toBe("scheduled");
      send.mockClear();

      const response = await app.inject({ method: "POST", url: `/occurrences/${open.id}/reopen` });
      expect(response.statusCode).toBe(200);
      expect(response.json<OccurrenceReopenResponse>()).toEqual({
        id: open.id,
        status: "scheduled",
        withdrawn_successor_id: successor.id,
      });

      const rows = await occurrencesOf(task.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(open.id);
      expect(rows[0]!.status).toBe("scheduled");
      expect(rows[0]!.lazyGenerated).toBe(true);
      expect(rows[0]!.completedAt).toBeNull();
      // A reopen never enqueues anything.
      expect(send).not.toHaveBeenCalled();
    });

    it("reopening a skipped occurrence works the same way", async () => {
      const task = await insertTask(completionDate);
      vi.spyOn(app.boss, "send").mockResolvedValue(null);
      const open = await insertOccurrence(task.id, { lazyGenerated: true });
      await app.inject({ method: "POST", url: `/occurrences/${open.id}/skip` });
      const response = await app.inject({ method: "POST", url: `/occurrences/${open.id}/reopen` });
      expect(response.statusCode).toBe(200);
      const rows = await occurrencesOf(task.id);
      expect(rows.map((r) => r.status)).toEqual(["scheduled"]);
    });

    it("409 occurrence_not_task for an event occurrence, writing nothing", async () => {
      const done = await insertEventOccurrence("done");
      const response = await app.inject({ method: "POST", url: `/occurrences/${done.id}/reopen` });
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>().error).toBe("occurrence_not_task");
      const [row] = await app.db.select().from(occurrences).where(eq(occurrences.id, done.id));
      expect(row!.status).toBe("done");
      expect(row!.completedAt).not.toBeNull();
    });

    it("only the LATEST terminal row may be reopened: A done, B done, C open -> A is 409, B withdraws C", async () => {
      const task = await insertTask(completionDate);
      const a = await insertOccurrence(task.id, {
        ...localOccurrence(-6, 9),
        status: "done",
        completedAt: new Date(Date.now() - 6 * DAY_MS),
        lazyGenerated: true,
      });
      const b = await insertOccurrence(task.id, {
        ...localOccurrence(-3, 9),
        status: "skipped",
        completedAt: new Date(Date.now() - 3 * DAY_MS),
        lazyGenerated: true,
      });
      const c = await insertOccurrence(task.id, { ...localOccurrence(0, 9), lazyGenerated: true });

      const older = await app.inject({ method: "POST", url: `/occurrences/${a.id}/reopen` });
      expect(older.statusCode).toBe(409);
      expect(older.json<ErrorBody>().error).toBe("occurrence_not_reopenable");
      expect((await occurrencesOf(task.id)).map((r) => [r.id, r.status])).toEqual([
        [a.id, "done"],
        [b.id, "skipped"],
        [c.id, "scheduled"],
      ]);

      const latest = await app.inject({ method: "POST", url: `/occurrences/${b.id}/reopen` });
      expect(latest.statusCode).toBe(200);
      expect(latest.json<OccurrenceReopenResponse>()).toEqual({
        id: b.id,
        status: "scheduled",
        withdrawn_successor_id: c.id,
      });
      expect((await occurrencesOf(task.id)).map((r) => [r.id, r.status])).toEqual([
        [a.id, "done"],
        [b.id, "scheduled"],
      ]);
    });

    it("withdraws EVERY open row of a completion_date parent, lazy or not, reporting the lazy one", async () => {
      // A non-lazy scheduled row that survived an anchor switch plus the
      // real lazy successor: reopening must leave exactly one open row, and
      // the id it reports is the derived successor's.
      const task = await insertTask(completionDate);
      const done = await insertOccurrence(task.id, {
        ...localOccurrence(-3, 9),
        status: "done",
        completedAt: new Date(Date.now() - 3 * DAY_MS),
        lazyGenerated: true,
      });
      const stray = await insertOccurrence(task.id, {
        ...localOccurrence(5, 9),
        lazyGenerated: false,
      });
      const successor = await insertOccurrence(task.id, {
        ...localOccurrence(0, 9),
        lazyGenerated: true,
      });
      const response = await app.inject({ method: "POST", url: `/occurrences/${done.id}/reopen` });
      expect(response.statusCode).toBe(200);
      expect(response.json<OccurrenceReopenResponse>().withdrawn_successor_id).toBe(successor.id);
      const rows = await occurrencesOf(task.id);
      expect(rows.map((r) => [r.id, r.status])).toEqual([[done.id, "scheduled"]]);
      expect(rows.some((r) => r.id === stray.id)).toBe(false);
    });

    it.each([
      ["dropped", { status: "dropped" as const }],
      ["archived", { archivedAt: new Date() }],
    ])("409 task_not_open for a %s parent, writing nothing", async (_label, overrides) => {
      const task = await insertTask({ ...completionDate, ...overrides });
      const done = await insertOccurrence(task.id, {
        status: "done",
        completedAt: new Date(),
        lazyGenerated: true,
      });
      const successor = await insertOccurrence(task.id, {
        occursAt: new Date(Date.now() + 3 * DAY_MS),
        lazyGenerated: true,
      });
      const response = await app.inject({ method: "POST", url: `/occurrences/${done.id}/reopen` });
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>().error).toBe("task_not_open");
      const rows = await occurrencesOf(task.id);
      expect(rows.map((r) => [r.id, r.status])).toEqual([
        [done.id, "done"],
        [successor.id, "scheduled"],
      ]);
    });

    it("409 occurrence_not_reopenable on a second reopen (already scheduled)", async () => {
      const task = await insertTask(dueDate);
      const done = await insertOccurrence(task.id, { status: "done", completedAt: new Date() });
      expect(
        (await app.inject({ method: "POST", url: `/occurrences/${done.id}/reopen` })).statusCode,
      ).toBe(200);
      const second = await app.inject({ method: "POST", url: `/occurrences/${done.id}/reopen` });
      expect(second.statusCode).toBe(409);
      expect(second.json<ErrorBody>().error).toBe("occurrence_not_reopenable");
    });

    it("404s for an unknown occurrence", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/occurrences/00000000-0000-0000-0000-000000000000/reopen",
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
