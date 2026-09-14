import {
  computeNextLazyOccurrence,
  resolveWallClockToInstant,
  toWallClockComponents,
  wallClockToNaiveDate,
  wallTimeOfNaiveTimestamp,
} from "@personal-os/core";
import { occurrences, tasks } from "@personal-os/db";
import type { Task } from "@personal-os/schema";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

// Checkpoint 9.4: write-time validation of due_date rules with token-only
// errors, the persisted series anchor, a deterministic PATCH branch A (no
// churn when nothing recurrence-relevant changed; anchor = due_at ?? earliest
// occurrence ?? now), and a reopen that leaves a recurring parent actionable.

const TZ = "America/Chicago";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function localAt(daysFromToday: number, hour: number, minute = 0): Date {
  const today = toWallClockComponents(new Date(), TZ);
  const shifted = new Date(Date.UTC(today.year, today.month - 1, today.day + daysFromToday, 12));
  return resolveWallClockToInstant(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour,
      minute,
      second: 0,
    },
    TZ,
  );
}

describe("tasks routes -- Checkpoint 9.4 recurrence", () => {
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

  async function occurrencesOf(taskId: string) {
    return app.db
      .select()
      .from(occurrences)
      .where(eq(occurrences.parentId, taskId))
      .orderBy(asc(occurrences.occursAt), asc(occurrences.id));
  }

  async function insertTask(
    overrides: Partial<typeof tasks.$inferInsert> = {},
  ): Promise<typeof tasks.$inferSelect> {
    const [row] = await app.db
      .insert(tasks)
      .values({ title: "Recurring", status: "active", timezone: TZ, ...overrides })
      .returning();
    return row!;
  }

  describe("POST /tasks due_date rule validation", () => {
    it.each([
      ["a sub-daily FREQ", "FREQ=HOURLY", "unsupported_frequency"],
      ["an embedded COUNT", "FREQ=DAILY;COUNT=3", "embedded_until_count"],
      ["an embedded UNTIL", "FREQ=DAILY;UNTIL=20261231T000000Z", "embedded_until_count"],
      ["an unknown FREQ", "FREQ=WEEKLYY", "invalid_rrule"],
      ["INTERVAL=0", "FREQ=DAILY;INTERVAL=0", "invalid_rrule"],
    ])(
      "rejects %s with 400 validation_failed and a token-only message",
      async (_l, rrule, token) => {
        const response = await app.inject({
          method: "POST",
          url: "/tasks",
          payload: { title: "bad rule", timezone: TZ, rrule, recurrence_anchor: "due_date" },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
          error: "validation_failed",
          issues: [{ code: "custom", path: ["rrule"], message: token }],
        });
        // The rule itself -- request text -- is never echoed.
        expect(response.body).not.toContain(rrule);
        expect(await app.db.select().from(tasks)).toHaveLength(0);
      },
    );

    it("still accepts a valid due_date rule", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "ok", timezone: TZ, rrule: "FREQ=WEEKLY;BYDAY=MO" },
      });
      expect(response.statusCode).toBe(201);
    });
  });

  describe("POST /tasks persists the series anchor as due_at", () => {
    it("due_date rule without due_at: due_at = the request instant, equal to the first window anchor", async () => {
      const before = Date.now();
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "daily", timezone: TZ, rrule: "FREQ=DAILY" },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<Task>();
      expect(body.due_at).not.toBeNull();
      const dueAt = Date.parse(body.due_at!);
      // Floored to the second, so compare against the floored request start.
      expect(dueAt).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
      expect(dueAt).toBeLessThanOrEqual(Date.now());

      // The anchor is a whole second (resolveSeriesAnchor floors), the first
      // materialised occurrence IS the anchor, and a DAILY 90-day window from
      // it holds 91 rows (both ends inclusive) -- 9.4 review: before the
      // floor, the ms-bearing anchor sorted after its own first instance and
      // the window silently dropped it. The one legitimate exception is a
      // fall-back DST transition inside the window: day 90's wall clock then
      // lands an hour AFTER the real-time window end, so 90 rows. Computed
      // rather than hard-coded so the test is honest on every calendar date.
      expect(dueAt % 1000).toBe(0);
      const rows = await occurrencesOf(body.id);
      const anchorWall = toWallClockComponents(new Date(body.due_at!), TZ);
      const windowEnd = dueAt + 90 * DAY_MS;
      let expectedRows = 0;
      for (let day = 0; day <= 90; day += 1) {
        const date = new Date(
          Date.UTC(anchorWall.year, anchorWall.month - 1, anchorWall.day + day),
        );
        const instant = resolveWallClockToInstant(
          {
            ...anchorWall,
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate(),
          },
          TZ,
        );
        if (instant.getTime() <= windowEnd) expectedRows += 1;
      }
      expect(expectedRows).toBeGreaterThanOrEqual(90);
      expect(rows.length).toBe(expectedRows);
      expect(rows[0]!.occursAt.getTime()).toBe(dueAt);
      for (const row of rows) {
        const wall = toWallClockComponents(row.occursAt, TZ);
        expect([wall.hour, wall.minute, wall.second]).toEqual([
          anchorWall.hour,
          anchorWall.minute,
          anchorWall.second,
        ]);
      }
    });

    it("completion_date rule without due_at: due_at = the seeded occurrence's instant", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "chore",
          timezone: TZ,
          rrule: "FREQ=DAILY;INTERVAL=3",
          recurrence_anchor: "completion_date",
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<Task>();
      expect(body.due_at).not.toBeNull();
      const rows = await occurrencesOf(body.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.occursAt.toISOString()).toBe(body.due_at);
      expect(rows[0]!.lazyGenerated).toBe(true);
    });

    it("a supplied due_at is kept as-is, and a non-recurring task without due_at stays null", async () => {
      const dueAt = localAt(2, 9);
      const withDue = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "weekly",
          timezone: TZ,
          rrule: "FREQ=WEEKLY",
          due_at: dueAt.toISOString(),
        },
      });
      expect(withDue.json<Task>().due_at).toBe(dueAt.toISOString());
      const plain = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "plain", timezone: TZ },
      });
      expect(plain.json<Task>().due_at).toBeNull();
    });
  });

  describe("PATCH /tasks/:id branch A is deterministic", () => {
    async function createDaily(): Promise<Task> {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Daily standup prep",
          timezone: TZ,
          rrule: "FREQ=DAILY",
          due_at: localAt(0, 9).toISOString(),
        },
      });
      expect(response.statusCode).toBe(201);
      return response.json<Task>();
    }

    it.each([
      ["only the title", { title: "Renamed" }],
      ["the rule re-sent with an explicit INTERVAL=1", { rrule: "FREQ=DAILY;INTERVAL=1" }],
      ["the same due_at re-sent", (task: Task) => ({ due_at: task.due_at })],
      [
        "the same timezone and anchor re-sent",
        { recurrence_timezone: TZ, recurrence_anchor: "due_date" },
      ],
    ] as const)(
      "leaves every occurrence row byte-identical (ids, instants, snoozes) when %s changes",
      async (_label, patch) => {
        const task = await createDaily();
        const rowsBefore = await occurrencesOf(task.id);
        expect(rowsBefore.length).toBeGreaterThan(80);
        // Snooze a future occurrence: a regeneration would delete it.
        const future = rowsBefore.find((row) => row.occursAt.getTime() > Date.now() + DAY_MS)!;
        const snoozedUntil = new Date(future.occursAt.getTime() + 2 * HOUR_MS);
        const snooze = await app.inject({
          method: "POST",
          url: `/occurrences/${future.id}/snooze`,
          payload: { until: snoozedUntil.toISOString() },
        });
        expect(snooze.statusCode).toBe(200);
        const expected = await occurrencesOf(task.id);

        const response = await app.inject({
          method: "PATCH",
          url: `/tasks/${task.id}`,
          payload: typeof patch === "function" ? patch(task) : patch,
        });
        expect(response.statusCode).toBe(200);

        const rowsAfter = await occurrencesOf(task.id);
        expect(rowsAfter).toEqual(expected);
        expect(rowsAfter.find((row) => row.id === future.id)!.snoozedUntil!.getTime()).toBe(
          snoozedUntil.getTime(),
        );
      },
    );

    it("regenerates the future window when the rule changes, preserving past/done/skipped rows", async () => {
      const task = await createDaily();
      const rowsBefore = await occurrencesOf(task.id);
      const past = await app.db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: task.id,
          occursAt: new Date(Date.now() - 3 * DAY_MS),
          occursLocal: new Date(Date.now() - 3 * DAY_MS),
          status: "scheduled",
          lazyGenerated: false,
        })
        .returning();
      const done = rowsBefore[1]!;
      await app.db
        .update(occurrences)
        .set({ status: "done", completedAt: new Date() })
        .where(eq(occurrences.id, done.id));

      const response = await app.inject({
        method: "PATCH",
        url: `/tasks/${task.id}`,
        payload: { rrule: "FREQ=WEEKLY;BYDAY=MO" },
      });
      expect(response.statusCode).toBe(200);

      const rowsAfter = await occurrencesOf(task.id);
      const idsAfter = new Set(rowsAfter.map((row) => row.id));
      expect(idsAfter.has(past[0]!.id)).toBe(true);
      expect(idsAfter.has(done.id)).toBe(true);
      const futureScheduled = rowsAfter.filter(
        (row) => row.status === "scheduled" && row.occursAt.getTime() >= Date.now(),
      );
      expect(futureScheduled.length).toBeGreaterThanOrEqual(12);
      expect(futureScheduled.length).toBeLessThanOrEqual(14);
      for (const row of futureScheduled) {
        expect(rowsBefore.some((before) => before.id === row.id)).toBe(false);
        expect(toWallClockComponents(row.occursAt, TZ).hour).toBe(9);
      }
    });

    it("regenerates when only due_at changes (the anchor moved)", async () => {
      const task = await createDaily();
      const rowsBefore = await occurrencesOf(task.id);
      const response = await app.inject({
        method: "PATCH",
        url: `/tasks/${task.id}`,
        payload: { due_at: localAt(0, 14).toISOString() },
      });
      expect(response.statusCode).toBe(200);
      const future = (await occurrencesOf(task.id)).filter(
        (row) => row.occursAt.getTime() >= Date.now(),
      );
      expect(future.every((row) => toWallClockComponents(row.occursAt, TZ).hour === 14)).toBe(true);
      expect(future.some((row) => rowsBefore.some((b) => b.id === row.id))).toBe(false);
    });

    it("anchors a due_at-less series at its earliest occurrence, keeping the original wall-clock time", async () => {
      // A series materialised by another writer with no due_at (e.g. a
      // capture committed before 9.4): three rows at 09:00 local.
      const task = await insertTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: null,
      });
      for (const day of [1, 2, 3]) {
        const at = localAt(day, 9);
        await app.db.insert(occurrences).values({
          parentType: "task",
          parentId: task.id,
          occursAt: at,
          occursLocal: new Date(
            Date.UTC(
              toWallClockComponents(at, TZ).year,
              toWallClockComponents(at, TZ).month - 1,
              toWallClockComponents(at, TZ).day,
              9,
            ),
          ),
          status: "scheduled",
          lazyGenerated: false,
        });
      }

      const response = await app.inject({
        method: "PATCH",
        url: `/tasks/${task.id}`,
        payload: { rrule: "FREQ=DAILY;INTERVAL=2" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<Task>().due_at).toBeNull();

      const rows = await occurrencesOf(task.id);
      expect(rows.length).toBeGreaterThan(40);
      // Every regenerated instant is at 09:00 local -- anchored on the
      // earliest existing occurrence, not on the PATCH's own clock.
      for (const row of rows) {
        const wall = toWallClockComponents(row.occursAt, TZ);
        expect([wall.hour, wall.minute]).toEqual([9, 0]);
      }
      // First instant is the original earliest occurrence (day+1 09:00), the
      // next is two days later.
      expect(rows[0]!.occursAt.getTime()).toBe(localAt(1, 9).getTime());
      expect(rows[1]!.occursAt.getTime()).toBe(localAt(3, 9).getTime());
    });

    it("rejects an invalid EFFECTIVE due_date rule with a token-only 400 and writes nothing", async () => {
      const task = await createDaily();
      const before = await app.db.select().from(tasks).where(eq(tasks.id, task.id));
      const rowsBefore = await occurrencesOf(task.id);
      for (const [rrule, token] of [
        ["FREQ=MINUTELY", "unsupported_frequency"],
        ["FREQ=DAILY;COUNT=2", "embedded_until_count"],
        ["FREQ=NOPE", "invalid_rrule"],
      ]) {
        const response = await app.inject({
          method: "PATCH",
          url: `/tasks/${task.id}`,
          payload: { rrule },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
          error: "validation_failed",
          issues: [{ code: "custom", path: ["rrule"], message: token }],
        });
        expect(response.body).not.toContain(rrule);
      }
      expect(await app.db.select().from(tasks).where(eq(tasks.id, task.id))).toEqual(before);
      expect(await occurrencesOf(task.id)).toEqual(rowsBefore);
    });

    it("a completion_date effective-rule rejection is token-only too", async () => {
      const task = await insertTask({
        rrule: "FREQ=DAILY;INTERVAL=3",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "completion_date",
      });
      const response = await app.inject({
        method: "PATCH",
        url: `/tasks/${task.id}`,
        payload: { rrule: "FREQ=WEEKLY;BYDAY=MO" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "validation_failed",
        issues: [{ code: "custom", path: ["rrule"], message: "invalid_rrule" }],
      });
      expect(response.body).not.toContain("BYDAY");
    });
  });

  describe("POST /tasks/:id/reopen on a recurring parent", () => {
    it("seeds one open lazy occurrence for a completion_date parent with nothing open", async () => {
      const task = await insertTask({
        rrule: "FREQ=DAILY;INTERVAL=3",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "completion_date",
        status: "done",
        completedAt: new Date(),
        dueAt: localAt(-10, 9),
      });
      const lastCompletion = new Date(Date.now() - 2 * DAY_MS);
      await app.db.insert(occurrences).values({
        parentType: "task",
        parentId: task.id,
        occursAt: new Date(Date.now() - 3 * DAY_MS),
        occursLocal: new Date(Date.now() - 3 * DAY_MS),
        status: "done",
        completedAt: lastCompletion,
        lazyGenerated: true,
      });

      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
      expect(response.statusCode).toBe(200);
      expect(response.json<Task>().status).toBe("active");

      const rows = await occurrencesOf(task.id);
      const open = rows.filter((row) => row.status === "scheduled");
      expect(open).toHaveLength(1);
      expect(open[0]!.lazyGenerated).toBe(true);
      // Seeded from the last completion through the rule (branch F's rule),
      // not from the stale due_at ten days ago.
      expect(open[0]!.occursAt.getTime()).toBeGreaterThan(lastCompletion.getTime());
      expect(open[0]!.occursAt.getTime()).toBeLessThan(lastCompletion.getTime() + 4 * DAY_MS);

      // A second reopen is refused and changes nothing.
      const again = await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
      expect(again.statusCode).toBe(409);
      expect(again.json<ErrorBody>().error).toBe("task_not_reopenable");
      expect(await occurrencesOf(task.id)).toEqual(rows);
    });

    it("leaves a completion_date parent alone when it already has an open occurrence", async () => {
      const task = await insertTask({
        rrule: "FREQ=DAILY;INTERVAL=3",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "completion_date",
        status: "dropped",
      });
      await app.db.insert(occurrences).values({
        parentType: "task",
        parentId: task.id,
        occursAt: new Date(Date.now() + DAY_MS),
        occursLocal: new Date(Date.now() + DAY_MS),
        status: "scheduled",
        lazyGenerated: true,
      });
      const before = await occurrencesOf(task.id);
      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
      expect(response.statusCode).toBe(200);
      expect(await occurrencesOf(task.id)).toEqual(before);
    });

    it("re-materialises the window for a due_date parent from its anchor, keeping existing rows", async () => {
      const task = await insertTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        status: "dropped",
        dueAt: localAt(-5, 9),
      });
      // One historical done row and one surviving scheduled row.
      const [done] = await app.db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: task.id,
          occursAt: localAt(-5, 9),
          occursLocal: localAt(-5, 9),
          status: "done",
          completedAt: localAt(-5, 10),
          lazyGenerated: false,
        })
        .returning();
      const [kept] = await app.db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: task.id,
          occursAt: localAt(2, 9),
          occursLocal: localAt(2, 9),
          status: "scheduled",
          lazyGenerated: false,
        })
        .returning();

      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
      expect(response.statusCode).toBe(200);
      expect(response.json<Task>().status).toBe("active");

      const rows = await occurrencesOf(task.id);
      expect(rows.length).toBeGreaterThan(80);
      expect(rows.find((row) => row.id === done!.id)?.status).toBe("done");
      expect(rows.find((row) => row.id === kept!.id)).toEqual(kept);
      for (const row of rows) {
        expect(toWallClockComponents(row.occursAt, TZ).hour).toBe(9);
      }
      // Exactly one row per instant -- onConflictDoNothing on the identity index.
      expect(new Set(rows.map((row) => row.occursAt.getTime())).size).toBe(rows.length);
    });

    it("still reopens (200) when the stored rule cannot be expanded, logging ids only", async () => {
      const task = await insertTask({
        rrule: "FREQ=WEEKLYY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        status: "done",
        completedAt: new Date(),
      });
      const warn = vi.spyOn(app.log, "warn");
      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
      expect(response.statusCode).toBe(200);
      expect(response.json<Task>().status).toBe("active");
      expect(await occurrencesOf(task.id)).toEqual([]);
      const line = warn.mock.calls.find(
        (call) => typeof call[1] === "string" && call[1].startsWith("tasks.reopen"),
      );
      expect(line).toBeDefined();
      expect(line![0]).toMatchObject({ taskId: task.id });
      expect(JSON.stringify(line)).not.toContain("WEEKLYY");
      warn.mockRestore();
    });

    it("non-recurring reopen is unchanged: no occurrence is ever created", async () => {
      const task = await insertTask({ status: "done", completedAt: new Date() });
      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
      expect(response.statusCode).toBe(200);
      expect(await occurrencesOf(task.id)).toEqual([]);
    });
  });

  // 9.4 review (B2/B3/B8): every writer of a lazy successor computes the SAME
  // instant, an unsteppable stored rule is a token-only 400 rather than a 500,
  // the /complete redirect follows the effective instant, and branch C seeds
  // through the shared target rule.
  describe("lazy successor target agreement", () => {
    const rule = { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: TZ } as const;

    async function insertTerminal(taskId: string, daysAgo: number, completedAt: Date) {
      const occursAt = localAt(-daysAgo, 9);
      const [row] = await app.db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: taskId,
          occursAt,
          occursLocal: wallClockToNaiveDate(toWallClockComponents(occursAt, TZ)),
          status: "done",
          completedAt,
          lazyGenerated: true,
        })
        .returning();
      return row!;
    }

    function expectedSuccessor(terminal: typeof occurrences.$inferSelect) {
      return computeNextLazyOccurrence(rule, terminal.completedAt!, "completed", {
        wallTime: wallTimeOfNaiveTimestamp(terminal.occursLocal),
        after: terminal.occursAt,
      }).occursAt;
    }

    it("PATCH branch F re-points the open occurrence to the instant a plain complete would have produced", async () => {
      const task = await insertTask({ ...rule, recurrenceAnchor: "completion_date" });
      // Completed at 21:47 the day it was due -- the instance was at 09:00.
      const terminal = await insertTerminal(task.id, 2, localAt(-2, 21, 47));
      const [open] = await app.db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: task.id,
          occursAt: localAt(1, 21, 47),
          occursLocal: wallClockToNaiveDate(toWallClockComponents(localAt(1, 21, 47), TZ)),
          status: "scheduled",
          lazyGenerated: true,
        })
        .returning();

      const response = await app.inject({
        method: "PATCH",
        url: `/tasks/${task.id}`,
        payload: { rrule: "FREQ=DAILY;INTERVAL=3", recurrence_timezone: "Europe/London" },
      });
      expect(response.statusCode).toBe(200);
      const rows = await occurrencesOf(task.id);
      const repointed = rows.find((row) => row.id === open!.id)!;
      const expected = computeNextLazyOccurrence(
        { rrule: rule.rrule, recurrenceTimezone: "Europe/London" },
        terminal.completedAt!,
        "completed",
        { wallTime: wallTimeOfNaiveTimestamp(terminal.occursLocal), after: terminal.occursAt },
      );
      expect(repointed.occursAt.getTime()).toBe(expected.occursAt.getTime());
      // The wall-clock time is the terminal row's 09:00, in the NEW zone --
      // not the 21:47 the owner tapped Done at.
      const wall = toWallClockComponents(repointed.occursAt, "Europe/London");
      expect([wall.hour, wall.minute]).toEqual([9, 0]);
      expect(repointed.occursLocal.getUTCHours()).toBe(9);
    });

    it("POST /tasks/:id/reopen seeds the identical instant", async () => {
      const task = await insertTask({
        ...rule,
        recurrenceAnchor: "completion_date",
        status: "done",
        completedAt: new Date(),
      });
      const terminal = await insertTerminal(task.id, 2, localAt(-2, 21, 47));
      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
      expect(response.statusCode).toBe(200);
      const open = (await occurrencesOf(task.id)).filter((row) => row.status === "scheduled");
      expect(open).toHaveLength(1);
      expect(open[0]!.occursAt.getTime()).toBe(expectedSuccessor(terminal).getTime());
      expect(open[0]!.occursLocal.getUTCHours()).toBe(9);
    });

    it("the successor lands strictly after a terminal row completed early", async () => {
      // Completed a week BEFORE it was due (occurs_at in the future). The
      // +3 candidate from the completion is before the row's own instant;
      // the seed must step past it rather than collide and vanish.
      const task = await insertTask({
        ...rule,
        recurrenceAnchor: "completion_date",
        status: "done",
        completedAt: new Date(),
      });
      const occursAt = localAt(7, 9);
      const [terminal] = await app.db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: task.id,
          occursAt,
          occursLocal: wallClockToNaiveDate(toWallClockComponents(occursAt, TZ)),
          status: "done",
          completedAt: new Date(),
          lazyGenerated: true,
        })
        .returning();
      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
      expect(response.statusCode).toBe(200);
      const open = (await occurrencesOf(task.id)).filter((row) => row.status === "scheduled");
      expect(open).toHaveLength(1);
      expect(open[0]!.occursAt.getTime()).toBeGreaterThan(terminal!.occursAt.getTime());
      expect(open[0]!.occursAt.getTime()).toBe(expectedSuccessor(terminal!).getTime());
    });

    // A terminal row whose occurs_at is thousands of intervals after its
    // completion cannot be stepped past within the engine's bound, so the
    // engine throws -- the one way a VALIDATED rule still fails here. The
    // route must answer with the token, never let it reach the 500 handler
    // (which would log the message, and the message quotes the rule).
    it("PATCH branch F: an unsteppable target is 400 invalid_rrule, token only, nothing written", async () => {
      const task = await insertTask({ ...rule, recurrenceAnchor: "completion_date" });
      await insertTerminal(task.id, -4000, new Date());
      const before = await occurrencesOf(task.id);
      const error = vi.spyOn(app.log, "error");
      const response = await app.inject({
        method: "PATCH",
        url: `/tasks/${task.id}`,
        payload: { title: "renamed", rrule: "FREQ=DAILY;INTERVAL=2" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "validation_failed",
        issues: [{ code: "custom", path: ["rrule"], message: "invalid_rrule" }],
      });
      expect(response.body).not.toContain("INTERVAL");
      expect(await occurrencesOf(task.id)).toEqual(before);
      const [row] = await app.db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(row!.title).toBe("Recurring");
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });

    it("POST /tasks/:id/reopen: an unsteppable target still reopens (200), logging ids only", async () => {
      const task = await insertTask({
        ...rule,
        recurrenceAnchor: "completion_date",
        status: "done",
        completedAt: new Date(),
      });
      await insertTerminal(task.id, -4000, new Date());
      const warn = vi.spyOn(app.log, "warn");
      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
      expect(response.statusCode).toBe(200);
      expect(response.json<Task>().status).toBe("active");
      const line = warn.mock.calls.find(
        (call) => typeof call[1] === "string" && call[1].startsWith("tasks.reopen"),
      );
      expect(line).toBeDefined();
      expect(line![0]).toEqual({ taskId: task.id, error: "InvalidEffectiveRuleError" });
      expect(JSON.stringify(line)).not.toContain("INTERVAL");
      warn.mockRestore();
    });

    it("PATCH branch C (due_date -> completion_date) seeds one open lazy row even when due_at is held by a done row", async () => {
      // The instance AT the anchor was completed; the old seed collided with
      // it and left nothing open.
      const dueAt = localAt(-3, 9);
      const task = await insertTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt,
      });
      const [done] = await app.db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: task.id,
          occursAt: dueAt,
          occursLocal: wallClockToNaiveDate(toWallClockComponents(dueAt, TZ)),
          status: "done",
          completedAt: localAt(-3, 10),
          lazyGenerated: false,
        })
        .returning();
      for (const day of [-2, -1, 0, 1]) {
        await app.db.insert(occurrences).values({
          parentType: "task",
          parentId: task.id,
          occursAt: localAt(day, 9),
          occursLocal: wallClockToNaiveDate(toWallClockComponents(localAt(day, 9), TZ)),
          status: "scheduled",
          lazyGenerated: false,
        });
      }

      const response = await app.inject({
        method: "PATCH",
        url: `/tasks/${task.id}`,
        payload: { rrule: "FREQ=DAILY;INTERVAL=3", recurrence_anchor: "completion_date" },
      });
      expect(response.statusCode).toBe(200);
      const rows = await occurrencesOf(task.id);
      expect(rows.map((row) => row.status)).toEqual(["done", "scheduled"]);
      expect(rows[0]!.id).toBe(done!.id);
      expect(rows[1]!.lazyGenerated).toBe(true);
      expect(rows[1]!.occursAt.getTime()).toBe(
        computeNextLazyOccurrence(rule, done!.completedAt!, "completed", {
          wallTime: wallTimeOfNaiveTimestamp(done!.occursLocal),
          after: done!.occursAt,
        }).occursAt.getTime(),
      );
    });

    it("PATCH branch C on a dropped task deletes the window and seeds nothing", async () => {
      const task = await insertTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        status: "dropped",
        dueAt: localAt(0, 9),
      });
      await app.db.insert(occurrences).values({
        parentType: "task",
        parentId: task.id,
        occursAt: localAt(1, 9),
        occursLocal: wallClockToNaiveDate(toWallClockComponents(localAt(1, 9), TZ)),
        status: "scheduled",
        lazyGenerated: false,
      });
      const response = await app.inject({
        method: "PATCH",
        url: `/tasks/${task.id}`,
        payload: { rrule: "FREQ=DAILY;INTERVAL=3", recurrence_anchor: "completion_date" },
      });
      expect(response.statusCode).toBe(200);
      expect(await occurrencesOf(task.id)).toEqual([]);
    });

    it("/tasks/:id/complete redirects to the open occurrence with the earliest EFFECTIVE instant", async () => {
      const task = await insertTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: localAt(0, 9),
      });
      // Today's instance is snoozed a month out; tomorrow's is untouched.
      // The redirect must point at tomorrow's -- the row Today shows first --
      // never at the far-snoozed one that sorts first by occurs_at.
      const [snoozed] = await app.db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: task.id,
          occursAt: localAt(0, 9),
          occursLocal: wallClockToNaiveDate(toWallClockComponents(localAt(0, 9), TZ)),
          status: "scheduled",
          lazyGenerated: false,
          snoozedUntil: localAt(30, 9),
        })
        .returning();
      const [tomorrow] = await app.db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: task.id,
          occursAt: localAt(1, 9),
          occursLocal: wallClockToNaiveDate(toWallClockComponents(localAt(1, 9), TZ)),
          status: "scheduled",
          lazyGenerated: false,
        })
        .returning();
      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/complete` });
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>()).toEqual({
        error: "recurring_task_use_occurrence",
        occurrence_id: tomorrow!.id,
      });
      expect(snoozed!.id).not.toBe(tomorrow!.id);
    });
  });

  it("GET /tasks/:id/complete redirect still finds the open occurrence after a reopen seed", async () => {
    const task = await insertTask({
      rrule: "FREQ=DAILY;INTERVAL=2",
      recurrenceTimezone: TZ,
      recurrenceAnchor: "completion_date",
      status: "done",
      completedAt: new Date(),
    });
    await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
    const complete = await app.inject({ method: "POST", url: `/tasks/${task.id}/complete` });
    expect(complete.statusCode).toBe(409);
    const body = complete.json<ErrorBody>();
    expect(body.error).toBe("recurring_task_use_occurrence");
    const [open] = await app.db
      .select()
      .from(occurrences)
      .where(and(eq(occurrences.parentId, task.id), eq(occurrences.status, "scheduled")));
    expect(body.occurrence_id).toBe(open!.id);
  });
});
