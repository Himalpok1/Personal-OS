import { computeNextLazyOccurrence, wallTimeOfNaiveTimestamp } from "@personal-os/core";
import { events, occurrences, tasks } from "@personal-os/db";
import type { Occurrence } from "@personal-os/schema";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OCCURRENCES_GENERATE_LAZY_QUEUE } from "../queue-names.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { Paginated } from "../test/types.js";

describe("GET /occurrences (list)", () => {
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

  it("lists occurrences scoped to a parent, filterable by status", async () => {
    const [task] = await app.db
      .insert(tasks)
      .values({ title: "Recurring", status: "active", timezone: "America/Chicago" })
      .returning();

    await app.db.insert(occurrences).values([
      {
        parentType: "task",
        parentId: task!.id,
        occursAt: new Date("2026-08-10T00:00:00Z"),
        occursLocal: new Date("2026-08-10T00:00:00Z"),
        status: "scheduled",
      },
      {
        parentType: "task",
        parentId: task!.id,
        occursAt: new Date("2026-08-17T00:00:00Z"),
        occursLocal: new Date("2026-08-17T00:00:00Z"),
        status: "done",
      },
    ]);

    const all = await app.inject({
      method: "GET",
      url: `/occurrences?parent_type=task&parent_id=${task!.id}`,
    });
    expect(all.json<Paginated<Occurrence>>().total).toBe(2);

    const scheduledOnly = await app.inject({
      method: "GET",
      url: `/occurrences?parent_type=task&parent_id=${task!.id}&status=scheduled`,
    });
    const scheduledBody = scheduledOnly.json<Paginated<Occurrence>>();
    expect(scheduledBody.total).toBe(1);
    expect(scheduledBody.items[0]!.status).toBe("scheduled");
  });

  it("requires parent_type and parent_id", async () => {
    const response = await app.inject({ method: "GET", url: "/occurrences" });
    expect(response.statusCode).toBe(400);
  });
});

// Checkpoint 9.3, shared contract 3: a terminal occurrence is idempotent
// (no re-stamp, no enqueue), and a completion_date-anchored parent's
// successor is inserted in the same transaction as the status update.
describe("POST /occurrences/:id/complete|skip", () => {
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
      .values({
        title: "Water the plants",
        status: "active",
        timezone: "America/Chicago",
        ...overrides,
      })
      .returning();
    return row!;
  }

  async function insertOpenOccurrence(
    taskId: string,
    lazyGenerated: boolean,
    occursAt = new Date(),
  ): Promise<typeof occurrences.$inferSelect> {
    const [row] = await app.db
      .insert(occurrences)
      .values({
        parentType: "task",
        parentId: taskId,
        occursAt,
        occursLocal: occursAt,
        status: "scheduled",
        lazyGenerated,
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

  const completionAnchored = {
    rrule: "FREQ=DAILY;INTERVAL=3",
    recurrenceTimezone: "America/Chicago",
    recurrenceAnchor: "completion_date",
  } as const;

  it("404s for an unknown occurrence", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/occurrences/00000000-0000-0000-0000-000000000000/complete",
    });
    expect(response.statusCode).toBe(404);
  });

  it("inserts the completion_date successor in the same transaction as the completion", async () => {
    const task = await insertTask(completionAnchored);
    const open = await insertOpenOccurrence(task.id, true);
    const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);

    const before = Date.now();
    const response = await app.inject({ method: "POST", url: `/occurrences/${open.id}/complete` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: open.id, status: "done" });

    const rows = await occurrencesOf(task.id);
    expect(rows).toHaveLength(2);
    const completed = rows.find((r) => r.id === open.id)!;
    expect(completed.status).toBe("done");
    expect(completed.completedAt).not.toBeNull();
    expect(completed.completedAt!.getTime()).toBeGreaterThanOrEqual(before);

    const successor = rows.find((r) => r.id !== open.id)!;
    expect(successor.status).toBe("scheduled");
    expect(successor.lazyGenerated).toBe(true);
    // Exactly what generateOne would compute from the recorded completion
    // instant AND the completed row's wall-clock time (Checkpoint 9.4) -- so
    // the worker's belt-and-braces run collides on the unique index and
    // reads as successor_exists, never as a second successor.
    const expected = computeNextLazyOccurrence(
      {
        rrule: completionAnchored.rrule,
        recurrenceTimezone: completionAnchored.recurrenceTimezone,
      },
      completed.completedAt!,
      "completed",
      // The same options the route and the worker pass (Checkpoint 9.4):
      // the completed row's occurs_local time through the shared reader and
      // its occurs_at as the exclusive lower bound.
      { wallTime: wallTimeOfNaiveTimestamp(completed.occursLocal), after: completed.occursAt },
    );
    expect(successor.occursAt.getTime()).toBe(expected.occursAt.getTime());

    // The worker re-check is still enqueued, once, for the source occurrence.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      OCCURRENCES_GENERATE_LAZY_QUEUE,
      { occurrenceId: open.id, fromStatus: "completed" },
      { singletonKey: `generate-lazy:task:${task.id}` },
    );
  });

  it("anchors a skipped occurrence's successor from the skip instant, tagged fromStatus skipped", async () => {
    const task = await insertTask(completionAnchored);
    // Overdue by a week: the successor must come from NOW, not from the
    // missed date (docs/ARCHITECTURE.md: "Skipping anchors from the skip
    // timestamp").
    const open = await insertOpenOccurrence(
      task.id,
      true,
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    );
    const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: `/occurrences/${open.id}/skip` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: open.id, status: "skipped" });

    const rows = await occurrencesOf(task.id);
    const successor = rows.find((r) => r.id !== open.id)!;
    expect(successor.occursAt.getTime()).toBeGreaterThan(Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(send).toHaveBeenCalledWith(
      OCCURRENCES_GENERATE_LAZY_QUEUE,
      { occurrenceId: open.id, fromStatus: "skipped" },
      expect.anything(),
    );
  });

  it("inserts no successor and enqueues nothing for a due_date-anchored parent", async () => {
    const task = await insertTask({
      rrule: "FREQ=WEEKLY;INTERVAL=1",
      recurrenceTimezone: "America/Chicago",
      recurrenceAnchor: "due_date",
    });
    const open = await insertOpenOccurrence(task.id, false);
    const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: `/occurrences/${open.id}/complete` });
    expect(response.statusCode).toBe(200);

    const rows = await occurrencesOf(task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("done");
    expect(send).not.toHaveBeenCalled();
  });

  it("inserts no successor for an event occurrence", async () => {
    const [open] = await app.db
      .insert(occurrences)
      .values({
        parentType: "event",
        parentId: "22222222-2222-4222-8222-222222222222",
        occursAt: new Date(),
        occursLocal: new Date(),
        status: "scheduled",
      })
      .returning();
    const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: `/occurrences/${open!.id}/skip` });
    expect(response.statusCode).toBe(200);
    const rows = await app.db.select().from(occurrences);
    expect(rows).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });

  // Checkpoint 9.5 ownership contract: an external event's occurrences are
  // read-only like every other write surface for that event.
  describe("event occurrences of an EXTERNAL series (Checkpoint 9.5)", () => {
    async function insertEventOccurrence(eventOverrides: Partial<typeof events.$inferInsert>) {
      const [event] = await app.db
        .insert(events)
        .values({
          title: "Series",
          timezone: "America/Chicago",
          startsAt: new Date("2026-09-07T14:00:00Z"),
          endsAt: new Date("2026-09-07T14:30:00Z"),
          rrule: "FREQ=WEEKLY",
          recurrenceTimezone: "America/Chicago",
          ...eventOverrides,
        })
        .returning();
      const [open] = await app.db
        .insert(occurrences)
        .values({
          parentType: "event",
          parentId: event!.id,
          occursAt: new Date("2026-09-14T14:00:00Z"),
          occursLocal: new Date("2026-09-14T09:00:00"),
          status: "scheduled",
        })
        .returning();
      return { event: event!, open: open! };
    }

    it.each(["complete", "skip"] as const)(
      "%s on an occurrence whose parent event is external returns 409 event_not_owned and writes nothing",
      async (action) => {
        const { open } = await insertEventOccurrence({ origin: "external" });
        const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);
        const response = await app.inject({
          method: "POST",
          url: `/occurrences/${open.id}/${action}`,
        });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ error: "event_not_owned" });
        const [row] = await app.db.select().from(occurrences).where(eq(occurrences.id, open.id));
        expect(row!.status).toBe("scheduled");
        expect(row!.completedAt).toBeNull();
        expect(send).not.toHaveBeenCalled();
      },
    );

    it("a detached child whose PARENT is external is refused too", async () => {
      const { event: parent } = await insertEventOccurrence({ origin: "external" });
      const [child] = await app.db
        .insert(events)
        .values({
          title: "Moved",
          timezone: "America/Chicago",
          startsAt: new Date("2026-09-21T15:00:00Z"),
          endsAt: new Date("2026-09-21T15:30:00Z"),
          parentEventId: parent.id,
          originalStartAt: new Date("2026-09-21T14:00:00Z"),
          origin: "local",
        })
        .returning();
      const [open] = await app.db
        .insert(occurrences)
        .values({
          parentType: "event",
          parentId: child!.id,
          occursAt: new Date("2026-09-21T15:00:00Z"),
          occursLocal: new Date("2026-09-21T10:00:00"),
          status: "scheduled",
        })
        .returning();
      const response = await app.inject({
        method: "POST",
        url: `/occurrences/${open!.id}/complete`,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "event_not_owned" });
    });

    it("a LOCAL event occurrence still completes (200) with no successor and no enqueue", async () => {
      const { open } = await insertEventOccurrence({ origin: "local" });
      const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);
      const response = await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/complete`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ id: open.id, status: "done" });
      expect(await app.db.select().from(occurrences)).toHaveLength(1);
      expect(send).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["complete", "done"],
    ["skip", "skipped"],
  ] as const)(
    "%s on an already-terminal occurrence is idempotent: current status, no re-stamp, no enqueue",
    async (action, terminal) => {
      const task = await insertTask(completionAnchored);
      const open = await insertOpenOccurrence(task.id, true);

      const first = await app.inject({ method: "POST", url: `/occurrences/${open.id}/${action}` });
      expect(first.statusCode).toBe(200);
      const [stamped] = await app.db.select().from(occurrences).where(eq(occurrences.id, open.id));
      expect(stamped!.status).toBe(terminal);
      const firstStamp = stamped!.completedAt!.getTime();
      const rowsAfterFirst = await occurrencesOf(task.id);
      expect(rowsAfterFirst).toHaveLength(2);

      // Wait past millisecond resolution so a re-stamp would be observable.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);

      const second = await app.inject({ method: "POST", url: `/occurrences/${open.id}/${action}` });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ id: open.id, status: terminal });

      const [again] = await app.db.select().from(occurrences).where(eq(occurrences.id, open.id));
      expect(again!.completedAt!.getTime()).toBe(firstStamp);
      expect(await occurrencesOf(task.id)).toHaveLength(2);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("reports the EXISTING terminal status when the other verb is called on it", async () => {
    const task = await insertTask(completionAnchored);
    const open = await insertOpenOccurrence(task.id, true);
    await app.inject({ method: "POST", url: `/occurrences/${open.id}/skip` });

    const response = await app.inject({ method: "POST", url: `/occurrences/${open.id}/complete` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: open.id, status: "skipped" });
    const [row] = await app.db.select().from(occurrences).where(eq(occurrences.id, open.id));
    expect(row!.status).toBe("skipped");
  });

  it("does not insert a second open occurrence when one already exists for the parent", async () => {
    const task = await insertTask(completionAnchored);
    const open = await insertOpenOccurrence(task.id, true);
    // The partial index one_open_occurrence_per_lazy_parent cannot be
    // pre-loaded (the row being completed IS the one open lazy occurrence),
    // so exercise the other unique index: pin the clock, pre-insert a
    // scheduled row at exactly the instant the successor will compute to,
    // and prove the insert is a no-op rather than a 500.
    const completionInstant = new Date();
    const expected = computeNextLazyOccurrence(
      {
        rrule: completionAnchored.rrule,
        recurrenceTimezone: completionAnchored.recurrenceTimezone,
      },
      completionInstant,
      "completed",
      { wallTime: wallTimeOfNaiveTimestamp(open.occursLocal), after: open.occursAt },
    );
    await insertOpenOccurrence(task.id, false, expected.occursAt);
    vi.spyOn(app.boss, "send").mockResolvedValue(null);
    vi.useFakeTimers({ now: completionInstant, toFake: ["Date"] });
    try {
      const response = await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/complete`,
      });
      expect(response.statusCode).toBe(200);
    } finally {
      vi.useRealTimers();
    }

    const rows = await occurrencesOf(task.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === "scheduled")).toHaveLength(1);
  });

  // Checkpoint 9.3 review. Write-time validation used to check part NAMES
  // only, so `FREQ=WEEKLYY` and `FREQ=DAILY;INTERVAL=0` were storable; the
  // first transactional version of this route then let computeNextLazyOccurrence's
  // throw roll the completion itself back -- the task could never be
  // completed again, every tap a 500. Old code: 500, occurrence still
  // `scheduled`, nothing enqueued.
  describe("a stored rule the successor computation rejects", () => {
    it.each([
      ["unknown FREQ", "FREQ=WEEKLYY"],
      ["INTERVAL=0", "FREQ=DAILY;INTERVAL=0"],
    ])(
      "%s: the completion still commits, an ids-only warn line is logged, and the worker re-check is still enqueued",
      async (_label, rrule) => {
        const task = await insertTask({ ...completionAnchored, rrule });
        const open = await insertOpenOccurrence(task.id, true);
        const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);
        const warn = vi.spyOn(app.log, "warn");

        const response = await app.inject({
          method: "POST",
          url: `/occurrences/${open.id}/complete`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ id: open.id, status: "done" });

        const rows = await occurrencesOf(task.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe("done");
        expect(rows[0]!.completedAt).not.toBeNull();

        // The failure is carried to the durable evidence path: the
        // generate-lazy job retries, dead-letters and alerts (ADR-062).
        expect(send).toHaveBeenCalledWith(
          OCCURRENCES_GENERATE_LAZY_QUEUE,
          { occurrenceId: open.id, fromStatus: "completed" },
          expect.anything(),
        );

        const line = warn.mock.calls.find(
          (call) => typeof call[1] === "string" && call[1].includes("successor generation failed"),
        );
        expect(line).toBeDefined();
        expect(line![0]).toMatchObject({ occurrenceId: open.id, taskId: task.id });
        expect(String((line![0] as Record<string, unknown>)["error"])).toMatch(
          /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
        );
        expect(JSON.stringify(line)).not.toContain(rrule);
      },
    );

    it("a second complete on the same task still works (no permanent 500)", async () => {
      const task = await insertTask({ ...completionAnchored, rrule: "FREQ=WEEKLYY" });
      vi.spyOn(app.boss, "send").mockResolvedValue(null);
      vi.spyOn(app.log, "warn");
      const first = await insertOpenOccurrence(task.id, true);
      expect(
        (await app.inject({ method: "POST", url: `/occurrences/${first.id}/complete` })).statusCode,
      ).toBe(200);
      const second = await insertOpenOccurrence(task.id, true);
      expect(
        (await app.inject({ method: "POST", url: `/occurrences/${second.id}/skip` })).statusCode,
      ).toBe(200);
      const rows = await occurrencesOf(task.id);
      expect(rows.map((r) => r.status).sort()).toEqual(["done", "skipped"]);
    });
  });

  // Checkpoint 9.3 review: a dropped or archived parent recurs no further.
  // Old code: successor inserted and job enqueued for both.
  it.each([
    ["dropped", { status: "dropped" as const }],
    ["archived", { archivedAt: new Date("2026-09-11T00:00:00Z") }],
  ])(
    "commits the status change but inserts no successor and enqueues nothing for a %s parent",
    async (_label, overrides) => {
      const task = await insertTask({ ...completionAnchored, ...overrides });
      const open = await insertOpenOccurrence(task.id, true);
      const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);

      const response = await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/complete`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ id: open.id, status: "done" });

      const rows = await occurrencesOf(task.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("done");
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("still inserts the successor when pg-boss is unavailable, and enqueues nothing", async () => {
    const task = await insertTask(completionAnchored);
    const open = await insertOpenOccurrence(task.id, true);
    const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);
    const wasReady = app.bossReady;
    app.bossReady = false;
    try {
      const response = await app.inject({
        method: "POST",
        url: `/occurrences/${open.id}/complete`,
      });
      expect(response.statusCode).toBe(200);
    } finally {
      app.bossReady = wasReady;
    }

    const rows = await occurrencesOf(task.id);
    expect(rows.filter((r) => r.status === "scheduled" && r.lazyGenerated)).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });
});
