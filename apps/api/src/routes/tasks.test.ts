import { computeNextLazyOccurrence, wallTimeOfNaiveTimestamp } from "@personal-os/core";
import { occurrences, tasks } from "@personal-os/db";
import {
  ENTITY_TITLE_MAX_CHARS,
  TASK_BODY_MAX_CHARS,
  tooLongMessage,
  type Project,
  type Task,
} from "@personal-os/schema";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody, Paginated } from "../test/types.js";

describe("tasks routes", () => {
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

  it("creates a task with status active, not inbox", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "Write tests", timezone: "America/Chicago" },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<Task>();
    expect(body.status).toBe("active");
    expect(body.archived_at).toBeNull();
  });

  it("rejects status/archived_at on create with 400, not a silent strip", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "bad", timezone: "America/Chicago", status: "done" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error).toBe("validation_failed");
  });

  describe("recurrence on tasks", () => {
    it("creates a due-date task with recurrence and materializes 90-day occurrence window", async () => {
      const now = new Date();
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Daily due-date task",
          timezone: "America/Chicago",
          due_at: now.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrence_anchor: "due_date",
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<Task>();
      expect(body.rrule).toBe("FREQ=DAILY;INTERVAL=1");
      expect(body.recurrence_anchor).toBe("due_date");
      expect(body.recurrence_timezone).toBe("America/Chicago");

      const occs = await app.db.select().from(occurrences).where(eq(occurrences.parentId, body.id));
      expect(occs.length).toBeGreaterThanOrEqual(89);
      expect(occs.every((o) => o.status === "scheduled" && !o.lazyGenerated)).toBe(true);
    });

    it("creates a completion-date task with recurrence and seeds a single lazy occurrence", async () => {
      const now = new Date();
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Completion-anchored task",
          timezone: "America/Chicago",
          due_at: now.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=3",
          recurrence_anchor: "completion_date",
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<Task>();
      expect(body.rrule).toBe("FREQ=DAILY;INTERVAL=3");
      expect(body.recurrence_anchor).toBe("completion_date");

      const occs = await app.db.select().from(occurrences).where(eq(occurrences.parentId, body.id));
      expect(occs).toHaveLength(1);
      expect(occs[0]?.status).toBe("scheduled");
      expect(occs[0]?.lazyGenerated).toBe(true);
    });

    it("rejects mutual exclusivity of recurrence_until and recurrence_count with 400", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Invalid recurrence",
          timezone: "America/Chicago",
          due_at: new Date().toISOString(),
          rrule: "FREQ=DAILY",
          recurrence_until: "2026-12-31T23:59:59.000Z",
          recurrence_count: 5,
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
    });

    it("rejects completion_date task with recurrence_until, recurrence_count, or invalid rrule with 400", async () => {
      const untilResp = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Invalid until",
          timezone: "America/Chicago",
          due_at: new Date().toISOString(),
          rrule: "FREQ=DAILY",
          recurrence_anchor: "completion_date",
          recurrence_until: "2026-12-31T23:59:59.000Z",
        },
      });
      expect(untilResp.statusCode).toBe(400);

      const countResp = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Invalid count",
          timezone: "America/Chicago",
          due_at: new Date().toISOString(),
          rrule: "FREQ=DAILY",
          recurrence_anchor: "completion_date",
          recurrence_count: 5,
        },
      });
      expect(countResp.statusCode).toBe(400);

      const complexRuleResp = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Invalid complex rrule",
          timezone: "America/Chicago",
          due_at: new Date().toISOString(),
          rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
          recurrence_anchor: "completion_date",
        },
      });
      expect(complexRuleResp.statusCode).toBe(400);
    });

    it("transitions due-date -> completion-date with overdue scheduled occurrence (verifying overdue row is deleted and single lazy row is created)", async () => {
      const pastDue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Due date to convert",
          timezone: "America/Chicago",
          due_at: pastDue.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrence_anchor: "due_date",
        },
      });
      const taskId = created.json<Task>().id;

      // Add a done occurrence and a skipped occurrence in the past
      await app.db.insert(occurrences).values([
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          status: "done",
          completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          lazyGenerated: false,
        },
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          status: "skipped",
          lazyGenerated: false,
        },
        // Overdue scheduled occurrence
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          status: "scheduled",
          lazyGenerated: false,
        },
      ]);

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/tasks/${taskId}`,
        payload: {
          rrule: "FREQ=DAILY;INTERVAL=3",
          recurrence_anchor: "completion_date",
        },
      });
      expect(patchResp.statusCode).toBe(200);
      expect(patchResp.json<Task>().recurrence_anchor).toBe("completion_date");

      const allOccs = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, taskId));

      // Overdue scheduled non-lazy row and all future scheduled non-lazy rows deleted
      const nonLazyScheduled = allOccs.filter((o) => !o.lazyGenerated && o.status === "scheduled");
      expect(nonLazyScheduled).toHaveLength(0);

      // Single lazy scheduled occurrence created
      const lazyScheduled = allOccs.filter((o) => o.lazyGenerated && o.status === "scheduled");
      expect(lazyScheduled).toHaveLength(1);

      // Done and skipped preserved
      const doneOccs = allOccs.filter((o) => o.status === "done");
      expect(doneOccs).toHaveLength(1);
      const skippedOccs = allOccs.filter((o) => o.status === "skipped");
      expect(skippedOccs).toHaveLength(1);
    });

    it("transitions completion-date -> due-date with overdue open lazy occurrence (verifying open lazy row is deleted and window is materialized)", async () => {
      const pastDue = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Completion date to convert",
          timezone: "America/Chicago",
          due_at: pastDue.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=3",
          recurrence_anchor: "completion_date",
        },
      });
      const taskId = created.json<Task>().id;

      // Add done & skipped rows
      await app.db.insert(occurrences).values([
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          status: "done",
          completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          lazyGenerated: true,
        },
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
          status: "skipped",
          lazyGenerated: true,
        },
      ]);

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/tasks/${taskId}`,
        payload: {
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrence_anchor: "due_date",
          due_at: new Date().toISOString(),
        },
      });
      expect(patchResp.statusCode).toBe(200);
      expect(patchResp.json<Task>().recurrence_anchor).toBe("due_date");

      const allOccs = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, taskId));

      // Open lazy scheduled row deleted
      const lazyScheduled = allOccs.filter((o) => o.lazyGenerated && o.status === "scheduled");
      expect(lazyScheduled).toHaveLength(0);

      // 90-day window materialized
      const nonLazyScheduled = allOccs.filter((o) => !o.lazyGenerated && o.status === "scheduled");
      expect(nonLazyScheduled.length).toBeGreaterThanOrEqual(89);

      // Done and skipped preserved
      expect(allOccs.filter((o) => o.status === "done")).toHaveLength(1);
      expect(allOccs.filter((o) => o.status === "skipped")).toHaveLength(1);
    });

    it("clears recurrence with overdue scheduled occurrence (verifying overdue row is deleted and parent becomes non-recurring)", async () => {
      const now = new Date();
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Clear recurrence test",
          timezone: "America/Chicago",
          due_at: now.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrence_anchor: "due_date",
        },
      });
      const taskId = created.json<Task>().id;

      // Add overdue scheduled, done, and skipped rows
      await app.db.insert(occurrences).values([
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          status: "scheduled",
          lazyGenerated: false,
        },
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          status: "done",
          completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          lazyGenerated: false,
        },
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          status: "skipped",
          lazyGenerated: false,
        },
      ]);

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/tasks/${taskId}`,
        payload: { rrule: null },
      });
      expect(patchResp.statusCode).toBe(200);
      const body = patchResp.json<Task>();
      expect(body.rrule).toBeNull();
      expect(body.recurrence_anchor).toBeNull();
      expect(body.recurrence_timezone).toBeNull();

      const allOccs = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, taskId));

      // ALL scheduled rows deleted (including overdue)
      expect(allOccs.filter((o) => o.status === "scheduled")).toHaveLength(0);

      // Done and skipped preserved
      expect(allOccs.filter((o) => o.status === "done")).toHaveLength(1);
      expect(allOccs.filter((o) => o.status === "skipped")).toHaveLength(1);
    });

    it("edits due-date task preserving overdue scheduled occurrence and completed/skipped occurrences", async () => {
      const now = new Date();
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Due date edit preservation test",
          timezone: "America/Chicago",
          due_at: now.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrence_anchor: "due_date",
        },
      });
      const taskId = created.json<Task>().id;

      const overdueInstant = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await app.db.insert(occurrences).values([
        {
          parentType: "task",
          parentId: taskId,
          occursAt: overdueInstant,
          occursLocal: overdueInstant,
          status: "scheduled",
          lazyGenerated: false,
        },
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          status: "done",
          completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          lazyGenerated: false,
        },
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          status: "skipped",
          lazyGenerated: false,
        },
      ]);

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/tasks/${taskId}`,
        payload: {
          title: "Updated due date title",
          rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
        },
      });
      expect(patchResp.statusCode).toBe(200);

      const allOccs = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, taskId));

      // Overdue scheduled occurrence preserved
      const overdueOcc = allOccs.find(
        (o) => o.occursAt.getTime() === overdueInstant.getTime() && o.status === "scheduled",
      );
      expect(overdueOcc).toBeDefined();

      // Done and skipped preserved
      expect(allOccs.filter((o) => o.status === "done")).toHaveLength(1);
      expect(allOccs.filter((o) => o.status === "skipped")).toHaveLength(1);
    });

    // Checkpoint 9.3, shared contract 4: "Editing the rule regenerates only
    // the single open occurrence" (docs/ARCHITECTURE.md). Before 9.3 a
    // completion_date -> completion_date PATCH touched no occurrence at all.
    describe("completion_date -> completion_date PATCH (branch F)", () => {
      const rule = { rrule: "FREQ=DAILY;INTERVAL=3", tz: "America/Chicago" };

      async function insertCompletionTask(
        overrides: Partial<typeof tasks.$inferInsert> = {},
      ): Promise<typeof tasks.$inferSelect> {
        const [row] = await app.db
          .insert(tasks)
          .values({
            title: "Water the plants",
            status: "active",
            timezone: rule.tz,
            rrule: rule.rrule,
            recurrenceTimezone: rule.tz,
            recurrenceAnchor: "completion_date",
            ...overrides,
          })
          .returning();
        return row!;
      }

      async function scheduledOf(taskId: string) {
        return app.db
          .select()
          .from(occurrences)
          .where(and(eq(occurrences.parentId, taskId), eq(occurrences.status, "scheduled")));
      }

      it("rejects a BY*-bearing rrule with 400 when the body omits the anchor (effective rule validated)", async () => {
        const task = await insertCompletionTask();
        const before = await app.db.select().from(tasks).where(eq(tasks.id, task.id));

        // The schema refine only fires when the body names
        // recurrence_anchor = completion_date; the anchor here comes from the
        // stored row, so only the route-level effective-rule check can catch it.
        const response = await app.inject({
          method: "PATCH",
          url: `/tasks/${task.id}`,
          payload: { rrule: "FREQ=WEEKLY;BYDAY=MO" },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
          error: "validation_failed",
          issues: [{ path: ["rrule"] }],
        });
        const after = await app.db.select().from(tasks).where(eq(tasks.id, task.id));
        expect(after).toEqual(before);
      });

      it("seeds one open lazy occurrence at due_at when none exists (the dead-letter repair path)", async () => {
        const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const task = await insertCompletionTask({ dueAt });
        expect(await scheduledOf(task.id)).toHaveLength(0);

        const response = await app.inject({
          method: "PATCH",
          url: `/tasks/${task.id}`,
          payload: { rrule: rule.rrule, recurrence_anchor: "completion_date" },
        });
        expect(response.statusCode).toBe(200);

        const open = await scheduledOf(task.id);
        expect(open).toHaveLength(1);
        expect(open[0]!.lazyGenerated).toBe(true);
        expect(open[0]!.occursAt.getTime()).toBe(dueAt.getTime());
      });

      it("seeds at effectiveNow when there is no due_at and no history", async () => {
        const task = await insertCompletionTask();
        const before = Date.now();
        const response = await app.inject({
          method: "PATCH",
          url: `/tasks/${task.id}`,
          payload: { title: "Water the plants (renamed)" },
        });
        expect(response.statusCode).toBe(200);
        const open = await scheduledOf(task.id);
        expect(open).toHaveLength(1);
        expect(open[0]!.occursAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(open[0]!.occursAt.getTime()).toBeLessThanOrEqual(Date.now());
      });

      it("seeds from the last completion through the rule when history exists, not from a stale due_at", async () => {
        const staleDue = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const task = await insertCompletionTask({ dueAt: staleDue });
        const lastDone = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        await app.db.insert(occurrences).values({
          parentType: "task",
          parentId: task.id,
          occursAt: staleDue,
          occursLocal: staleDue,
          status: "done",
          completedAt: lastDone,
          lazyGenerated: true,
        });

        const response = await app.inject({
          method: "PATCH",
          url: `/tasks/${task.id}`,
          payload: { rrule: "FREQ=DAILY;INTERVAL=5" },
        });
        expect(response.statusCode).toBe(200);

        const open = await scheduledOf(task.id);
        expect(open).toHaveLength(1);
        // Checkpoint 9.4: the seed keeps the done row's occurs_local time of
        // day and lands strictly after its occurs_at -- the same options
        // every other writer of a lazy successor passes.
        const expected = computeNextLazyOccurrence(
          { rrule: "FREQ=DAILY;INTERVAL=5", recurrenceTimezone: rule.tz },
          lastDone,
          "completed",
          { wallTime: wallTimeOfNaiveTimestamp(staleDue), after: staleDue },
        );
        expect(open[0]!.occursAt.getTime()).toBe(expected.occursAt.getTime());
        // The done row is untouched.
        const all = await app.db
          .select()
          .from(occurrences)
          .where(eq(occurrences.parentId, task.id));
        expect(all.filter((o) => o.status === "done")).toHaveLength(1);
      });

      it("does not seed for a done or dropped task", async () => {
        for (const status of ["done", "dropped"] as const) {
          const task = await insertCompletionTask({ status });
          const response = await app.inject({
            method: "PATCH",
            url: `/tasks/${task.id}`,
            payload: { rrule: rule.rrule },
          });
          expect(response.statusCode).toBe(200);
          expect(await scheduledOf(task.id)).toHaveLength(0);
        }
      });

      it("re-points the open occurrence to a newly supplied due_at", async () => {
        const task = await insertCompletionTask({ dueAt: new Date() });
        const [open] = await app.db
          .insert(occurrences)
          .values({
            parentType: "task",
            parentId: task.id,
            occursAt: new Date(),
            occursLocal: new Date(),
            status: "scheduled",
            lazyGenerated: true,
          })
          .returning();
        const newDue = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

        const response = await app.inject({
          method: "PATCH",
          url: `/tasks/${task.id}`,
          payload: { due_at: newDue.toISOString() },
        });
        expect(response.statusCode).toBe(200);

        const scheduled = await scheduledOf(task.id);
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0]!.id).toBe(open!.id); // re-pointed, not replaced
        expect(scheduled[0]!.occursAt.getTime()).toBe(newDue.getTime());
      });

      it("re-points the open occurrence from the last completion when only the rule changes", async () => {
        const task = await insertCompletionTask();
        const lastDone = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const oldNext = computeNextLazyOccurrence(
          { rrule: rule.rrule, recurrenceTimezone: rule.tz },
          lastDone,
          "completed",
        );
        await app.db.insert(occurrences).values({
          parentType: "task",
          parentId: task.id,
          occursAt: lastDone,
          occursLocal: lastDone,
          status: "done",
          completedAt: lastDone,
          lazyGenerated: true,
        });
        const [open] = await app.db
          .insert(occurrences)
          .values({
            parentType: "task",
            parentId: task.id,
            occursAt: oldNext.occursAt,
            occursLocal: oldNext.occursAt,
            status: "scheduled",
            lazyGenerated: true,
          })
          .returning();

        const response = await app.inject({
          method: "PATCH",
          url: `/tasks/${task.id}`,
          payload: { rrule: "FREQ=WEEKLY;INTERVAL=1" },
        });
        expect(response.statusCode).toBe(200);

        const scheduled = await scheduledOf(task.id);
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0]!.id).toBe(open!.id);
        const expected = computeNextLazyOccurrence(
          { rrule: "FREQ=WEEKLY;INTERVAL=1", recurrenceTimezone: rule.tz },
          lastDone,
          "completed",
          // Checkpoint 9.4: same options as every other lazy-successor writer.
          { wallTime: wallTimeOfNaiveTimestamp(lastDone), after: lastDone },
        );
        expect(scheduled[0]!.occursAt.getTime()).toBe(expected.occursAt.getTime());
        expect(scheduled[0]!.occursAt.getTime()).not.toBe(oldNext.occursAt.getTime());
      });

      it("leaves the open occurrence alone when neither the rule nor due_at changed", async () => {
        const task = await insertCompletionTask({ dueAt: new Date() });
        const occursAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        await app.db.insert(occurrences).values({
          parentType: "task",
          parentId: task.id,
          occursAt,
          occursLocal: occursAt,
          status: "scheduled",
          lazyGenerated: true,
        });

        const response = await app.inject({
          method: "PATCH",
          url: `/tasks/${task.id}`,
          payload: { title: "Renamed", priority: 2, rrule: rule.rrule },
        });
        expect(response.statusCode).toBe(200);

        const scheduled = await scheduledOf(task.id);
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0]!.occursAt.getTime()).toBe(occursAt.getTime());
      });

      it("leaves the open occurrence alone when the target collides with a historical row", async () => {
        const task = await insertCompletionTask();
        const historical = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
        await app.db.insert(occurrences).values({
          parentType: "task",
          parentId: task.id,
          occursAt: historical,
          occursLocal: historical,
          status: "done",
          completedAt: historical,
          lazyGenerated: true,
        });
        const occursAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        await app.db.insert(occurrences).values({
          parentType: "task",
          parentId: task.id,
          occursAt,
          occursLocal: occursAt,
          status: "scheduled",
          lazyGenerated: true,
        });

        // Explicit due_at equal to the done row's instant would violate
        // occurrences_parent_occurs_at_key -- the edit must still succeed.
        const response = await app.inject({
          method: "PATCH",
          url: `/tasks/${task.id}`,
          payload: { due_at: historical.toISOString() },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json<Task>().due_at).toBe(historical.toISOString());

        const scheduled = await scheduledOf(task.id);
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0]!.occursAt.getTime()).toBe(occursAt.getTime());
      });
    });
  });

  it("resolves an offset-less due_at against the supplied timezone", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: {
        title: "Chicago afternoon",
        timezone: "America/Chicago",
        due_at: "2026-08-20T15:00:00",
      },
    });
    expect(response.statusCode).toBe(201);
    // 3pm CDT (UTC-5) -> 20:00 UTC.
    expect(response.json<Task>().due_at).toBe("2026-08-20T20:00:00.000Z");
  });

  it("lists, filters by project_id and status, and paginates", async () => {
    const project = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "QA project" },
    });
    const projectId = project.json<Project>().id;

    await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "In project", timezone: "America/Chicago", project_id: projectId },
    });
    await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "No project", timezone: "America/Chicago" },
    });

    const scoped = await app.inject({ method: "GET", url: `/tasks?project_id=${projectId}` });
    expect(scoped.json<Paginated<Task>>().total).toBe(1);

    const all = await app.inject({ method: "GET", url: "/tasks" });
    expect(all.json<Paginated<Task>>().total).toBe(2);
  });

  it("updates a task, resolving due_at against its own stored timezone", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "Edit me", timezone: "America/Chicago" },
    });
    const id = created.json<Task>().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/tasks/${id}`,
      payload: { priority: 1, due_at: "2026-09-01T09:00:00" },
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json<Task>();
    expect(body.priority).toBe(1);
    expect(body.due_at).toBe("2026-09-01T14:00:00.000Z"); // 9am CDT -> 14:00 UTC
  });

  describe("remind_at on PATCH", () => {
    it("sets remind_at on a task that had none, and GET reflects it", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "No reminder yet", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;
      expect(created.json<Task>().remind_at).toBeNull();

      const patched = await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: "2026-09-01T09:00:00-05:00" },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json<Task>().remind_at).toBe("2026-09-01T14:00:00.000Z");

      const fetched = await app.inject({ method: "GET", url: `/tasks/${id}` });
      expect(fetched.json<Task>().remind_at).toBe("2026-09-01T14:00:00.000Z");
    });

    it("moves remind_at earlier", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Move earlier", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;

      await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: "2026-09-10T10:00:00-05:00" },
      });
      const patched = await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: "2026-09-05T08:00:00-05:00" },
      });
      expect(patched.json<Task>().remind_at).toBe("2026-09-05T13:00:00.000Z");
    });

    it("moves remind_at later", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Move later", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;

      await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: "2026-09-05T08:00:00-05:00" },
      });
      const patched = await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: "2026-09-10T10:00:00-05:00" },
      });
      expect(patched.json<Task>().remind_at).toBe("2026-09-10T15:00:00.000Z");
    });

    it("clears remind_at back to null with an explicit null", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Clear me", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;

      await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: "2026-09-10T10:00:00-05:00" },
      });
      const cleared = await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json<Task>().remind_at).toBeNull();
    });

    it("leaves remind_at byte-identical when patching an unrelated field", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Untouched reminder", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;

      const withReminder = await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: "2026-09-10T10:00:00-05:00" },
      });
      const originalRemindAt = withReminder.json<Task>().remind_at;

      const titleOnly = await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { title: "Renamed, reminder untouched" },
      });
      expect(titleOnly.statusCode).toBe(200);
      const body = titleOnly.json<Task>();
      expect(body.title).toBe("Renamed, reminder untouched");
      // Exact string equality matters: the mobile reminder reconciler diffs
      // remind_at by exact ISO string, so any incidental churn would cancel
      // and reschedule a live alarm for no reason.
      expect(body.remind_at).toBe(originalRemindAt);
    });

    it("resolves an offset-less remind_at against the task's own stored timezone, not UTC", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Chicago reminder", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;

      const patched = await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: "2026-09-01T07:30:00" },
      });
      expect(patched.statusCode).toBe(200);
      // 7:30am CDT (UTC-5) -> 12:30 UTC
      expect(patched.json<Task>().remind_at).toBe("2026-09-01T12:30:00.000Z");
    });

    it("resolves an offset-less remind_at against a non-US task timezone (Pacific/Auckland)", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Auckland reminder", timezone: "Pacific/Auckland" },
      });
      const id = created.json<Task>().id;

      const patched = await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: "2026-09-01T07:30:00" },
      });
      expect(patched.statusCode).toBe(200);
      // Pacific/Auckland is NZST (UTC+12) in early September (before DST starts in late Sept).
      expect(patched.json<Task>().remind_at).toBe("2026-08-31T19:30:00.000Z");
    });

    it("normalizes remind_at to stable ISO-8601-with-offset form across repeated round-trips", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Round trip", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;

      const first = await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: "2026-09-01T09:00:00-05:00" },
      });
      const firstValue = first.json<Task>().remind_at as string;
      expect(firstValue).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Re-send the exact same value the server just returned; it must round-trip unchanged.
      const second = await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: firstValue },
      });
      expect(second.json<Task>().remind_at).toBe(firstValue);

      const fetched = await app.inject({ method: "GET", url: `/tasks/${id}` });
      expect(fetched.json<Task>().remind_at).toBe(firstValue);
    });

    it("keeps a recurring task's reminder at series level, leaving its occurrence schedule equivalent", async () => {
      const now = new Date();
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Recurring with reminder",
          timezone: "America/Chicago",
          due_at: now.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrence_anchor: "due_date",
        },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json<Task>().id;

      const beforeRows = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, id));
      const beforeCount = beforeRows.length;
      // Compare the SCHEDULE (the set of occurs_at instants), not row ids.
      // Any PATCH to a due-date-anchored recurring task replaces its future
      // scheduled occurrences and re-expands the 90-day window -- frozen
      // Checkpoint 4.3 transition semantics that predate remind_at and apply
      // equally to a title-only edit. What must hold here is that a reminder
      // stays task/series-level: the schedule is unchanged and no
      // per-occurrence reminder state is created.
      const beforeInstants = new Set(beforeRows.map((o) => o.occursAt.getTime()));

      const withReminder = await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: "2026-09-01T09:00:00-05:00" },
      });
      expect(withReminder.statusCode).toBe(200);
      expect(withReminder.json<Task>().remind_at).toBe("2026-09-01T14:00:00.000Z");

      const afterSetRows = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, id));
      expect(afterSetRows.length).toBe(beforeCount);
      expect(new Set(afterSetRows.map((o) => o.occursAt.getTime()))).toEqual(beforeInstants);

      const cleared = await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { remind_at: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json<Task>().remind_at).toBeNull();

      const afterClearRows = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, id));
      expect(afterClearRows.length).toBe(beforeCount);
      expect(new Set(afterClearRows.map((o) => o.occursAt.getTime()))).toEqual(beforeInstants);
    });
  });

  it("404s on PATCH/archive/activate/complete/drop for an unknown id", async () => {
    const unknownId = "00000000-0000-0000-0000-000000000000";
    for (const req of [
      { method: "PATCH" as const, url: `/tasks/${unknownId}`, payload: { title: "x" } },
      { method: "POST" as const, url: `/tasks/${unknownId}/archive` },
      { method: "POST" as const, url: `/tasks/${unknownId}/drop` },
    ]) {
      const response = await app.inject(req);
      expect(response.statusCode).toBe(404);
    }
  });

  describe("activate", () => {
    it("promotes inbox -> active", async () => {
      const [row] = await app.db
        .insert(tasks)
        .values({ title: "Captured", status: "inbox", timezone: "America/Chicago" })
        .returning();
      const response = await app.inject({ method: "POST", url: `/tasks/${row!.id}/activate` });
      expect(response.statusCode).toBe(200);
      expect(response.json<Task>().status).toBe("active");
    });

    it("409s from any non-inbox status", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Already active", timezone: "America/Chicago" },
      });
      const response = await app.inject({
        method: "POST",
        url: `/tasks/${created.json<Task>().id}/activate`,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>().error).toBe("invalid_status_transition");
    });
  });

  describe("complete", () => {
    it("completes a non-recurring task directly", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Plain task", timezone: "America/Chicago" },
      });
      const response = await app.inject({
        method: "POST",
        url: `/tasks/${created.json<Task>().id}/complete`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<Task>();
      expect(body.status).toBe("done");
      expect(body.completed_at).not.toBeNull();
    });

    it("409s a recurring task and returns its open occurrence id", async () => {
      const [task] = await app.db
        .insert(tasks)
        .values({
          title: "Recurring",
          status: "active",
          timezone: "America/Chicago",
          dueAt: new Date(),
          rrule: "FREQ=WEEKLY;INTERVAL=1",
          recurrenceTimezone: "America/Chicago",
          recurrenceAnchor: "due_date",
        })
        .returning();
      const [occurrence] = await app.db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: task!.id,
          occursAt: new Date(),
          occursLocal: new Date(),
          status: "scheduled",
        })
        .returning();

      const response = await app.inject({ method: "POST", url: `/tasks/${task!.id}/complete` });
      expect(response.statusCode).toBe(409);
      const body = response.json<ErrorBody>();
      expect(body.error).toBe("recurring_task_use_occurrence");
      expect(body.occurrence_id).toBe(occurrence!.id);
    });
  });

  // Checkpoint 9.3, shared contract 2.
  it("409s recurring_task_no_open_occurrence when a recurring task has nothing open", async () => {
    const [task] = await app.db
      .insert(tasks)
      .values({
        title: "Recurring, successor lost",
        status: "active",
        timezone: "America/Chicago",
        rrule: "FREQ=DAILY;INTERVAL=3",
        recurrenceTimezone: "America/Chicago",
        recurrenceAnchor: "completion_date",
      })
      .returning();
    // A done occurrence is not "open" -- the 409 must not point at it.
    await app.db.insert(occurrences).values({
      parentType: "task",
      parentId: task!.id,
      occursAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      occursLocal: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      status: "done",
      completedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      lazyGenerated: true,
    });

    const response = await app.inject({ method: "POST", url: `/tasks/${task!.id}/complete` });
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>()).toEqual({ error: "recurring_task_no_open_occurrence" });

    const [row] = await app.db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(row!.status).toBe("active");
  });

  // Checkpoint 9.3, shared contract 1.
  describe("reopen", () => {
    async function insertTask(overrides: Partial<typeof tasks.$inferInsert>) {
      const [row] = await app.db
        .insert(tasks)
        .values({ title: "Reopen me", timezone: "America/Chicago", status: "active", ...overrides })
        .returning();
      return row!;
    }

    it("reopens a done task: active, completed_at cleared, updated_at bumped", async () => {
      const completedAt = new Date("2026-09-01T12:00:00Z");
      const task = await insertTask({
        status: "done",
        completedAt,
        updatedAt: completedAt,
      });

      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
      expect(response.statusCode).toBe(200);
      const body = response.json<Task>();
      expect(body.status).toBe("active");
      expect(body.completed_at).toBeNull();
      expect(new Date(body.updated_at).getTime()).toBeGreaterThan(completedAt.getTime());
    });

    it("reopens a dropped task", async () => {
      const task = await insertTask({ status: "dropped" });
      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
      expect(response.statusCode).toBe(200);
      expect(response.json<Task>().status).toBe("active");
    });

    it("leaves occurrences exactly as they were", async () => {
      const task = await insertTask({
        status: "done",
        completedAt: new Date(),
        rrule: "FREQ=DAILY;INTERVAL=3",
        recurrenceTimezone: "America/Chicago",
        recurrenceAnchor: "completion_date",
      });
      const doneAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await app.db.insert(occurrences).values([
        {
          parentType: "task",
          parentId: task.id,
          occursAt: doneAt,
          occursLocal: doneAt,
          status: "done",
          completedAt: doneAt,
          lazyGenerated: true,
        },
        {
          parentType: "task",
          parentId: task.id,
          occursAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
          status: "scheduled",
          lazyGenerated: true,
        },
      ]);
      const before = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, task.id));

      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
      expect(response.statusCode).toBe(200);

      const after = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, task.id));
      expect(after).toEqual(before);
    });

    it.each(["inbox", "active"])("409s task_not_reopenable from %s", async (status) => {
      const task = await insertTask({ status });
      const response = await app.inject({ method: "POST", url: `/tasks/${task.id}/reopen` });
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>()).toEqual({ error: "task_not_reopenable", status });
    });

    it("404s for an unknown id and for an archived task", async () => {
      const unknown = await app.inject({
        method: "POST",
        url: "/tasks/00000000-0000-0000-0000-000000000000/reopen",
      });
      expect(unknown.statusCode).toBe(404);

      const archived = await insertTask({
        status: "done",
        completedAt: new Date(),
        archivedAt: new Date(),
      });
      const response = await app.inject({ method: "POST", url: `/tasks/${archived.id}/reopen` });
      expect(response.statusCode).toBe(404);
      const [row] = await app.db.select().from(tasks).where(eq(tasks.id, archived.id));
      expect(row!.status).toBe("done"); // untouched
    });
  });

  describe("drop", () => {
    it("drops any task regardless of recurrence, idempotently", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Drop me", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;
      const first = await app.inject({ method: "POST", url: `/tasks/${id}/drop` });
      const second = await app.inject({ method: "POST", url: `/tasks/${id}/drop` });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json<Task>().status).toBe("dropped");
    });
  });

  describe("archive", () => {
    it("is independent of task status and hides from default list views without deleting anything", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Archive me", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;
      await app.inject({ method: "POST", url: `/tasks/${id}/complete` });

      const archived = await app.inject({ method: "POST", url: `/tasks/${id}/archive` });
      expect(archived.statusCode).toBe(200);
      const archivedBody = archived.json<Task>();
      expect(archivedBody.status).toBe("done"); // status and archived_at are independent axes
      expect(archivedBody.archived_at).not.toBeNull();

      const defaultList = await app.inject({ method: "GET", url: "/tasks" });
      expect(defaultList.json<Paginated<Task>>().total).toBe(0);

      const includeArchived = await app.inject({
        method: "GET",
        url: "/tasks?include_archived=true",
      });
      expect(includeArchived.json<Paginated<Task>>().total).toBe(1);

      const directGet = await app.inject({ method: "GET", url: `/tasks/${id}` });
      expect(directGet.statusCode).toBe(200);

      const [row] = await app.db.select().from(tasks).where(eq(tasks.id, id));
      expect(row).toBeDefined(); // the row itself was never deleted
    });

    it("re-archiving an already-archived task is a no-op, not an error", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Double archive", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;
      await app.inject({ method: "POST", url: `/tasks/${id}/archive` });
      const second = await app.inject({ method: "POST", url: `/tasks/${id}/archive` });
      expect(second.statusCode).toBe(200);
    });
  });
});

// Checkpoint 8.4 Lane 5. remind_at has been settable via PATCH since 5.4 and
// the column has existed since Phase 1, but creation never accepted it -- the
// only way to set a reminder on a new task was create-then-patch.
describe("POST /tasks remind_at", () => {
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

  it("stores a reminder supplied at creation time", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: {
        title: "Call the insurer",
        remind_at: "2026-09-15T14:00:00-05:00",
        timezone: "America/Chicago",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json<Task>().remind_at).toBe("2026-09-15T19:00:00.000Z");
  });

  it("resolves an offset-less reminder against the REQUEST's timezone, not the server's", () => {
    return app
      .inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Standup",
          remind_at: "2026-09-15T09:00:00",
          timezone: "Pacific/Auckland",
        },
      })
      .then((res) => {
        expect(res.statusCode).toBe(201);
        // 09:00 NZST on 2026-09-15 is 21:00Z on 2026-09-14.
        expect(res.json<Task>().remind_at).toBe("2026-09-14T21:00:00.000Z");
      });
  });

  it("leaves remind_at null when omitted", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "No reminder", timezone: "America/Chicago" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<Task>().remind_at).toBeNull();
  });

  it("rejects a malformed reminder rather than storing garbage", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "Bad", remind_at: "next tuesday-ish", timezone: "America/Chicago" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("round-trips a creation reminder through PATCH and back to null", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: {
        title: "Round trip",
        remind_at: "2026-09-15T14:00:00-05:00",
        timezone: "America/Chicago",
      },
    });
    const id = created.json<Task>().id;

    const cleared = await app.inject({
      method: "PATCH",
      url: `/tasks/${id}`,
      payload: { remind_at: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<Task>().remind_at).toBeNull();
  });

  // Checkpoint 9.6 (ADR-065): user-typed text over a bound is REFUSED with
  // the field path -- never truncated -- and exactly-at-bound is accepted.
  describe("content bounds", () => {
    // The issue shape Zod emits; only the pieces these tests key on.
    type Issue = { path: (string | number)[]; message: string };

    it("refuses a title over ENTITY_TITLE_MAX_CHARS with 400 naming the field", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "t".repeat(ENTITY_TITLE_MAX_CHARS + 1), timezone: "America/Chicago" },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json<ErrorBody>();
      expect(body.error).toBe("validation_failed");
      expect((body.issues as Issue[])[0]?.path).toEqual(["title"]);
      expect((body.issues as Issue[])[0]?.message).toBe(
        tooLongMessage("title", ENTITY_TITLE_MAX_CHARS),
      );
    });

    it("refuses a body over TASK_BODY_MAX_CHARS on PATCH, leaving the row untouched", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Bounded", body: "short", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;
      const response = await app.inject({
        method: "PATCH",
        url: `/tasks/${id}`,
        payload: { body: "b".repeat(TASK_BODY_MAX_CHARS + 1) },
      });
      expect(response.statusCode).toBe(400);
      expect((response.json<ErrorBody>().issues as Issue[])[0]?.path).toEqual(["body"]);
      const after = await app.inject({ method: "GET", url: `/tasks/${id}` });
      expect(after.json<Task>().body).toBe("short");
    });

    it("accepts a title and body exactly at their bounds, byte-identical", async () => {
      const title = "e".repeat(ENTITY_TITLE_MAX_CHARS);
      const body = "b".repeat(TASK_BODY_MAX_CHARS);
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title, body, timezone: "America/Chicago" },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json<Task>().title).toBe(title);
      expect(response.json<Task>().body).toBe(body);
    });
  });
});
