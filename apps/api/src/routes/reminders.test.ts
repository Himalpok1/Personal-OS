import { resolveWallClockToInstant, toWallClockComponents } from "@personal-os/core";
import { occurrences, tasks } from "@personal-os/db";
import { RemindersResponseSchema, type RemindersResponse } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

// GET /reminders (Checkpoint 9.4): one item per one-off task with a reminder,
// one item per scheduled occurrence of a recurring task with a reminder, the
// occurrence's instant derived server-side from the parent's remind_at
// wall-clock and day offset in recurrence_timezone.

const TZ = "America/Chicago";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function local(date: string, hour: number, minute = 0, tz = TZ): Date {
  const [year, month, day] = date.split("-").map(Number);
  return resolveWallClockToInstant(
    { year: year!, month: month!, day: day!, hour, minute, second: 0 },
    tz,
  );
}

describe("GET /reminders", () => {
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function insertTask(
    overrides: Partial<typeof tasks.$inferInsert> = {},
  ): Promise<typeof tasks.$inferSelect> {
    const [row] = await app.db
      .insert(tasks)
      .values({ title: "Take the bins out", status: "active", timezone: TZ, ...overrides })
      .returning();
    return row!;
  }

  async function insertOccurrence(
    taskId: string,
    occursAt: Date,
    overrides: Partial<typeof occurrences.$inferInsert> = {},
  ): Promise<typeof occurrences.$inferSelect> {
    const [row] = await app.db
      .insert(occurrences)
      .values({
        parentType: "task",
        parentId: taskId,
        occursAt,
        occursLocal: occursAt,
        status: "scheduled",
        lazyGenerated: false,
        ...overrides,
      })
      .returning();
    return row!;
  }

  async function getReminders(query = ""): Promise<RemindersResponse> {
    const response = await app.inject({ method: "GET", url: `/reminders${query}` });
    expect(response.statusCode).toBe(200);
    return RemindersResponseSchema.parse(response.json());
  }

  it("returns the empty, strictly-shaped response with the default horizon", async () => {
    const response = await app.inject({ method: "GET", url: "/reminders" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], horizon_days: 45 });
  });

  it("rejects an out-of-range or malformed horizon_days", async () => {
    for (const value of ["0", "91", "abc", "1.5"]) {
      const response = await app.inject({ method: "GET", url: `/reminders?horizon_days=${value}` });
      expect(response.statusCode).toBe(400);
    }
  });

  describe("one-off tasks", () => {
    it("lists an open task with a future reminder as task:<id>, occurrence_id null, recurring false", async () => {
      const dueAt = new Date(Date.now() + 2 * DAY_MS);
      const remindAt = new Date(Date.now() + DAY_MS);
      const task = await insertTask({ dueAt, remindAt });

      const body = await getReminders();
      expect(body.items).toEqual([
        {
          key: `task:${task.id}`,
          task_id: task.id,
          occurrence_id: null,
          title: "Take the bins out",
          remind_at: remindAt.toISOString(),
          due_at: dueAt.toISOString(),
          timezone: TZ,
          recurring: false,
        },
      ]);
    });

    it("keeps a reminder that fired within the last hour and drops one older than that", async () => {
      const recent = await insertTask({ remindAt: new Date(Date.now() - 30 * 60 * 1000) });
      await insertTask({ title: "old", remindAt: new Date(Date.now() - 2 * HOUR_MS) });
      const body = await getReminders();
      expect(body.items.map((item) => item.task_id)).toEqual([recent.id]);
    });

    it("excludes done, dropped and archived tasks, tasks without a reminder, and inbox tasks are included", async () => {
      const remindAt = new Date(Date.now() + HOUR_MS);
      await insertTask({ title: "done", status: "done", remindAt });
      await insertTask({ title: "dropped", status: "dropped", remindAt });
      await insertTask({ title: "archived", archivedAt: new Date(), remindAt });
      await insertTask({ title: "no reminder", dueAt: new Date(Date.now() + HOUR_MS) });
      const inbox = await insertTask({ title: "inbox", status: "inbox", remindAt });
      const body = await getReminders();
      expect(body.items.map((item) => item.task_id)).toEqual([inbox.id]);
    });

    it("never lists a recurring parent as a task: item -- its reminder is per occurrence", async () => {
      const task = await insertTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: new Date(Date.now() + HOUR_MS),
        remindAt: new Date(Date.now() + HOUR_MS),
      });
      // No occurrences at all -> nothing to remind about.
      const body = await getReminders();
      expect(body.items).toEqual([]);
      expect(body.items.some((item) => item.key === `task:${task.id}`)).toBe(false);
    });
  });

  describe("recurring tasks", () => {
    it("derives 08:30 local on every occurrence across the 2026-03-08 spring-forward, due_at = occurrence instant", async () => {
      // Friday 2026-03-06 in Chicago (CST); DST starts Sunday 2026-03-08.
      vi.useFakeTimers({ now: new Date("2026-03-06T20:00:00Z"), toFake: ["Date"] });
      const task = await insertTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: local("2026-03-06", 9),
        remindAt: local("2026-03-06", 8, 30),
      });
      const occ = [];
      for (const date of ["2026-03-07", "2026-03-08", "2026-03-09"]) {
        occ.push(await insertOccurrence(task.id, local(date, 9)));
      }

      const body = await getReminders();
      expect(body.items).toHaveLength(3);
      expect(body.items.map((item) => item.occurrence_id)).toEqual(occ.map((o) => o.id));
      for (const [index, item] of body.items.entries()) {
        expect(item.key).toBe(`occ:${occ[index]!.id}`);
        expect(item.task_id).toBe(task.id);
        expect(item.recurring).toBe(true);
        expect(item.timezone).toBe(TZ);
        expect(item.due_at).toBe(occ[index]!.occursAt.toISOString());
        const wall = toWallClockComponents(new Date(item.remind_at), TZ);
        expect([wall.hour, wall.minute]).toEqual([8, 30]);
        // Same local date as the occurrence (offset 0 days).
        const occWall = toWallClockComponents(occ[index]!.occursAt, TZ);
        expect([wall.year, wall.month, wall.day]).toEqual([
          occWall.year,
          occWall.month,
          occWall.day,
        ]);
      }
      // The UTC instants shift with the offset change: CST vs CDT.
      expect(body.items.map((item) => item.remind_at)).toEqual([
        "2026-03-07T14:30:00.000Z",
        "2026-03-08T13:30:00.000Z",
        "2026-03-09T13:30:00.000Z",
      ]);
    });

    it("applies a day-before reminder offset to each occurrence", async () => {
      vi.useFakeTimers({ now: new Date("2026-03-06T20:00:00Z"), toFake: ["Date"] });
      const task = await insertTask({
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: local("2026-03-09", 9),
        remindAt: local("2026-03-08", 20),
      });
      await insertOccurrence(task.id, local("2026-03-09", 9));
      await insertOccurrence(task.id, local("2026-03-16", 9));

      const body = await getReminders();
      expect(body.items.map((item) => item.remind_at)).toEqual([
        local("2026-03-08", 20).toISOString(),
        local("2026-03-15", 20).toISOString(),
      ]);
    });

    it("a snoozed occurrence's reminder and due_at are its snoozed_until", async () => {
      const task = await insertTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: new Date(Date.now() - DAY_MS),
        remindAt: new Date(Date.now() - DAY_MS - HOUR_MS),
      });
      const snoozedUntil = new Date(Date.now() + 3 * HOUR_MS);
      // The occurrence itself is well in the past (its derived reminder would
      // be excluded); the snooze brings it back into the window.
      const occ = await insertOccurrence(task.id, new Date(Date.now() - 2 * DAY_MS), {
        snoozedUntil,
      });
      const body = await getReminders();
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        key: `occ:${occ.id}`,
        occurrence_id: occ.id,
        remind_at: snoozedUntil.toISOString(),
        due_at: snoozedUntil.toISOString(),
        recurring: true,
      });
    });

    it("bounds the window by horizon_days and echoes it; a DERIVED reminder gets no grace hour", async () => {
      // Pinned to local noon so "now + 1h" and "now - 30min" share a local
      // date (the derivation is date-based; near midnight this test would
      // depend on the clock it was run at).
      vi.useFakeTimers({ now: local("2026-09-14", 12), toFake: ["Date"] });
      // Due at noon, reminded at 11:30 the same day (offset 0, wall 11:30).
      const task = await insertTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: new Date(Date.now()),
        remindAt: new Date(Date.now() - 30 * 60 * 1000),
      });
      const inside = await insertOccurrence(task.id, new Date(Date.now() + 5 * DAY_MS));
      await insertOccurrence(task.id, new Date(Date.now() + 12 * DAY_MS));
      // Occurred 30 minutes ago: inside the occurrence window's grace hour,
      // but its derived reminder (11:30 today) is already past -- and an
      // un-snoozed derived reminder is listed only when strictly ahead of
      // now (9.4 review), or a freshly generated successor whose derived
      // reminder has already passed would fire the instant it was created.
      await insertOccurrence(task.id, new Date(Date.now() - 30 * 60 * 1000));
      // Occurred two hours ago: gone on both counts.
      await insertOccurrence(task.id, new Date(Date.now() - 2 * HOUR_MS));

      const body = await getReminders("?horizon_days=10");
      expect(body.horizon_days).toBe(10);
      expect(body.items.map((item) => item.occurrence_id)).toEqual([inside.id]);
    });

    it("a SNOOZED occurrence keeps the grace hour: its snoozed_until is an instant the owner set", async () => {
      vi.useFakeTimers({ now: local("2026-09-14", 12), toFake: ["Date"] });
      const task = await insertTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: new Date(Date.now() + HOUR_MS),
        remindAt: new Date(Date.now() + HOUR_MS),
      });
      const snoozedUntil = new Date(Date.now() - 30 * 60 * 1000);
      const recent = await insertOccurrence(task.id, new Date(Date.now() - 3 * HOUR_MS), {
        snoozedUntil,
      });
      await insertOccurrence(task.id, new Date(Date.now() - 4 * HOUR_MS), {
        snoozedUntil: new Date(Date.now() - 2 * HOUR_MS),
      });
      const body = await getReminders();
      expect(body.items.map((item) => item.occurrence_id)).toEqual([recent.id]);
      expect(body.items[0]!.remind_at).toBe(snoozedUntil.toISOString());
    });

    it("a snooze BEFORE the instance's instant moves the reminder but not due_at (greatest, never earlier)", async () => {
      vi.useFakeTimers({ now: local("2026-09-14", 12), toFake: ["Date"] });
      // Due tomorrow 09:00, reminded the evening before at 20:00; the owner
      // snoozes tonight's reminder by an hour. The reminder fires at 21:00,
      // the instance is still due tomorrow at 09:00.
      const task = await insertTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: local("2026-09-15", 9),
        remindAt: local("2026-09-14", 20),
      });
      const snoozedUntil = local("2026-09-14", 21);
      const occ = await insertOccurrence(task.id, local("2026-09-15", 9), { snoozedUntil });
      const body = await getReminders();
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        occurrence_id: occ.id,
        remind_at: snoozedUntil.toISOString(),
        due_at: occ.occursAt.toISOString(),
      });
    });

    it("drops an occurrence whose DERIVED reminder is older than the grace hour even though the occurrence is ahead", async () => {
      // Reminder is set a day before the due date; an occurrence 30 minutes
      // from now therefore had its reminder ~23.5 hours ago.
      vi.useFakeTimers({ now: local("2026-09-14", 12), toFake: ["Date"] });
      const task = await insertTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: new Date(Date.now() + 30 * 60 * 1000),
        remindAt: new Date(Date.now() + 30 * 60 * 1000 - DAY_MS),
      });
      await insertOccurrence(task.id, new Date(Date.now() + 30 * 60 * 1000));
      const tomorrow = await insertOccurrence(
        task.id,
        new Date(Date.now() + DAY_MS + 30 * 60 * 1000),
      );
      const body = await getReminders();
      expect(body.items.map((item) => item.occurrence_id)).toEqual([tomorrow.id]);
    });

    it("excludes dropped/archived parents, parents without a reminder, and non-scheduled occurrences", async () => {
      const base = {
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date" as const,
        dueAt: new Date(Date.now() + HOUR_MS),
        remindAt: new Date(Date.now() + HOUR_MS),
      };
      const dropped = await insertTask({ ...base, title: "dropped", status: "dropped" });
      const archived = await insertTask({ ...base, title: "archived", archivedAt: new Date() });
      const silent = await insertTask({ ...base, title: "silent", remindAt: null });
      const live = await insertTask({ ...base, title: "live" });
      for (const t of [dropped, archived, silent, live]) {
        await insertOccurrence(t.id, new Date(Date.now() + DAY_MS));
      }
      await insertOccurrence(live.id, new Date(Date.now() + 2 * DAY_MS), {
        status: "done",
        completedAt: new Date(),
      });
      await insertOccurrence(live.id, new Date(Date.now() + 3 * DAY_MS), { status: "skipped" });

      const body = await getReminders();
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.task_id).toBe(live.id);
    });

    it("sorts by remind_at ascending across one-off and occurrence items", async () => {
      const oneOff = await insertTask({ remindAt: new Date(Date.now() + 2 * DAY_MS) });
      const recurring = await insertTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: new Date(Date.now() + HOUR_MS),
        remindAt: new Date(Date.now() + HOUR_MS),
      });
      const soon = await insertOccurrence(recurring.id, new Date(Date.now() + DAY_MS));
      const later = await insertOccurrence(recurring.id, new Date(Date.now() + 3 * DAY_MS));
      const body = await getReminders();
      expect(body.items.map((item) => item.key)).toEqual([
        `occ:${soon.id}`,
        `task:${oneOff.id}`,
        `occ:${later.id}`,
      ]);
    });
  });
});
