import { devices, notificationDispatchLog, occurrences, tasks, type Db } from "@personal-os/db";
import { and, eq } from "drizzle-orm";
import type { Job, JobWithMetadata, PgBoss } from "pg-boss";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLogSink } from "../logger.js";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import type { GenerateLazyOccurrenceJobData } from "./generate-lazy-occurrence.js";
import type { NotificationsDispatchJobData } from "./notifications-dispatch.js";
import {
  createExpandDueDateWindowDeadLetterHandler,
  createGenerateLazyOccurrenceDeadLetterHandler,
} from "./occurrences-dead-letter.js";

/**
 * Checkpoint 9.0 -- the two occurrences queues gain dead-letter handlers.
 *
 * Neither table involved can hold a failure state without a migration (see
 * the module header), so the durable evidence is the alert's
 * `notification_dispatch_log` row, and the handler's whole job is to make one
 * further attempt, then raise that alert exactly once per failure identity
 * and stay silent when the current durable state says nothing is wrong.
 */

// A title carrying everything a push body must survive: a newline that would
// weld words together, a control character (BEL -- Postgres itself rejects a
// NUL, so that one can never be stored), and length past the cap.
const RAW_TITLE = "Water the\u0007 plants\nevery three days " + "x".repeat(120);

// A rule the dead handler's own retry cannot compute from: a BY* part on a
// completion-anchored rule is refused at write time, so this is the
// "persistent fault" shape -- a retry fails identically and the alert must
// fire. Fixtures that want the retry to SUCCEED override it with VALID_RULE.
const BROKEN_RULE = "FREQ=DAILY;BYDAY=MO";
const VALID_RULE = "FREQ=DAILY;INTERVAL=3";

function deadJob(data: GenerateLazyOccurrenceJobData): Job<GenerateLazyOccurrenceJobData> {
  return {
    id: "dead-job",
    name: "occurrences.generate-lazy.dead",
    data,
  } as Job<GenerateLazyOccurrenceJobData>;
}

const TASK_A = "11111111-1111-4111-8111-111111111111";
const TASK_B = "22222222-2222-4222-8222-222222222222";
const EVENT_A = "33333333-3333-4333-8333-333333333333";

/** The serialize-error form of the OccurrencesJobError the sweep threw. */
function sweepOutput(refs: { parentType: string; parentId: string }[], total: number): object {
  return {
    name: "OccurrencesJobError",
    message: `occurrences.expand-window failed: ${refs.length} of ${total} parents failed`,
    queue: "occurrences.expand-window",
    sqlState: null,
    failedParents: refs.length,
    totalParents: total,
    failedParentRefs: refs,
  };
}

// The shape pg-boss delivers with `includeMetadata: true` on the FIRST
// delivery of a dead job: its own `createdOn`, plus the source_* columns the
// dlq_jobs CTE copied. A redelivery (the dead handler itself threw once) has
// the same `createdOn` and NULL for every source_* field -- pg-boss's
// retried_jobs re-insert does not carry them -- which is exactly why the key
// is bucketed on `createdOn`.
function deadCronJob(overrides: Partial<JobWithMetadata<object>>): JobWithMetadata<object> {
  return {
    id: "dead-cron-job",
    name: "occurrences.expand-window.dead",
    data: {},
    createdOn: new Date("2026-09-13T03:04:10Z"),
    sourceCreatedOn: new Date("2026-09-13T03:00:00Z"),
    sourceId: "11111111-2222-4333-8444-555555555555",
    sourceRetryCount: 3,
    output: sweepOutput([{ parentType: "task", parentId: TASK_A }], 14),
    ...overrides,
  } as JobWithMetadata<object>;
}

async function insertTask(db: Db, overrides: Partial<typeof tasks.$inferInsert> = {}) {
  const [row] = await db
    .insert(tasks)
    .values({
      title: RAW_TITLE,
      status: "active",
      timezone: "America/Chicago",
      rrule: BROKEN_RULE,
      recurrenceTimezone: "America/Chicago",
      recurrenceAnchor: "completion_date",
      ...overrides,
    })
    .returning({ id: tasks.id });
  return row!.id;
}

async function insertOccurrence(
  db: Db,
  taskId: string,
  overrides: Partial<typeof occurrences.$inferInsert> = {},
) {
  const [row] = await db
    .insert(occurrences)
    .values({
      parentType: "task",
      parentId: taskId,
      occursAt: new Date("2026-09-10T14:00:00Z"),
      occursLocal: new Date("2026-09-10T09:00:00Z"),
      status: "done",
      lazyGenerated: true,
      completedAt: new Date("2026-09-11T02:30:00Z"),
      ...overrides,
    })
    .returning({ id: occurrences.id });
  return row!.id;
}

async function insertDevice(
  db: Db,
  suffix: string,
  overrides: Partial<typeof devices.$inferInsert> = {},
) {
  const [row] = await db
    .insert(devices)
    .values({
      name: `Device ${suffix}`,
      platform: "android",
      tokenHash: `hash-${suffix}`,
      // A push token, because notifications.dispatch drops a token-less
      // device BEFORE claiming a dispatch-log row -- an "eligible" device
      // without one would make every assertion below about durable evidence
      // vacuous.
      pushToken: `ExponentPushToken[${suffix}]`,
      notifyAlerts: true,
      notificationsEnabled: true,
      ...overrides,
    })
    .returning({ id: devices.id });
  return row!.id;
}

describe("occurrences dead-letter handlers", () => {
  let db: Db;
  let boss: { send: ReturnType<typeof vi.fn> };
  let records: Record<string, unknown>[];
  let restore: () => void;

  function sentPayloads(): NotificationsDispatchJobData[] {
    return boss.send.mock.calls.map((call) => call[1] as NotificationsDispatchJobData);
  }

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
    boss = { send: vi.fn().mockResolvedValue("job-id") };
    records = [];
    restore = setLogSink({ write: (_level, record) => records.push(record) });
    return () => restore();
  });

  afterAll(async () => {
    await truncateTestTables(db);
  });

  describe("occurrences.generate-lazy.dead", () => {
    it("alerts every eligible device, keyed to the source occurrence", async () => {
      const taskId = await insertTask(db);
      const occurrenceId = await insertOccurrence(db, taskId);
      const deviceA = await insertDevice(db, "a");
      const deviceB = await insertDevice(db, "b");
      // Ineligible on every axis the dispatch job itself would refuse --
      // including the push token, the one axis the sibling producers omit.
      await insertDevice(db, "revoked", { revokedAt: new Date() });
      await insertDevice(db, "muted", { notifyAlerts: false });
      await insertDevice(db, "off", { notificationsEnabled: false });
      await insertDevice(db, "tokenless", { pushToken: null });

      await createGenerateLazyOccurrenceDeadLetterHandler(
        db,
        boss as unknown as PgBoss,
      )([deadJob({ occurrenceId, fromStatus: "completed" })]);

      const payloads = sentPayloads();
      expect(payloads).toHaveLength(2);
      expect(payloads.map((p) => p.deviceId).sort()).toEqual([deviceA, deviceB].sort());
      for (const payload of payloads) {
        expect(boss.send.mock.calls[0]![0]).toBe("notifications.dispatch");
        expect(payload.category).toBe("alert");
        expect(payload.dedupeKey).toBe(`occurrences.generate-lazy.dead:${occurrenceId}`);
        expect(payload.title).toBe("Recurring task needs attention");
        expect(payload.data).toEqual({ occurrenceId, taskId });
      }
      const done = records.find((r) => r["event"] === "occurrences.generate_lazy.dead_lettered");
      expect(done).toMatchObject({
        level: "warn",
        occurrenceId,
        taskId,
        fromStatus: "completed",
        // The retry's failure, as a token: the rule-validation error class.
        retryError: "Error",
        alert: "sent",
        alertDevices: 2,
      });
    });

    // The realistic exhaustion is a transient outage that has healed by the
    // time the dead job runs, and the previous behaviour -- alert without
    // retrying -- turned that into one misleading push and a task that never
    // recurred again, because re-saving a completion-anchored task's rule does
    // not seed an occurrence. One further attempt closes it.
    it("regenerates the successor itself when the fault was transient, and alerts nobody", async () => {
      const taskId = await insertTask(db, { rrule: VALID_RULE });
      const occurrenceId = await insertOccurrence(db, taskId);
      await insertDevice(db, "a");

      await createGenerateLazyOccurrenceDeadLetterHandler(
        db,
        boss as unknown as PgBoss,
      )([deadJob({ occurrenceId, fromStatus: "completed" })]);

      expect(boss.send).not.toHaveBeenCalled();
      const open = await db
        .select()
        .from(occurrences)
        .where(and(eq(occurrences.parentId, taskId), eq(occurrences.status, "scheduled")));
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ lazyGenerated: true });
      // Three days after the completion's LOCAL DATE (2026-09-10 in Chicago),
      // at the completed occurrence's own wall-clock time -- 09:00 CDT, not the
      // 21:30 the owner tapped Done at (Checkpoint 9.4 wallTime).
      expect(open[0]!.occursAt.toISOString()).toBe("2026-09-13T14:00:00.000Z");
      expect(
        records.find((r) => r["event"] === "occurrences.generate_lazy.dead_letter_recovered"),
      ).toMatchObject({ level: "info", occurrenceId, taskId, outcome: "generated" });
      expect(
        records.find((r) => r["event"] === "occurrences.generate_lazy.dead_lettered"),
      ).toBeUndefined();
    });

    it("renders the title stripped, capped, and free of identifiers in the body", async () => {
      const taskId = await insertTask(db);
      const occurrenceId = await insertOccurrence(db, taskId, { status: "skipped" });
      await insertDevice(db, "a");

      await createGenerateLazyOccurrenceDeadLetterHandler(
        db,
        boss as unknown as PgBoss,
      )([deadJob({ occurrenceId, fromStatus: "skipped" })]);

      const [payload] = sentPayloads();
      const body = payload!.body;
      // Stripped: the NUL is gone and the newline became a space rather than
      // welding "plants" to "every".
      expect(body).toContain('"Water the plants every three days');
      expect(body).not.toContain("\u0007");
      expect(body).not.toContain("\n");
      // Capped: the quoted title is at most 80 chars, ellipsis included.
      const quoted = /"([^"]*)"/.exec(body)![1]!;
      expect(quoted.length).toBeLessThanOrEqual(80);
      expect(quoted.endsWith("…")).toBe(true);
      // Names the transition the owner made, says a retry was made, and never
      // an id, the rule, or an instruction to edit the rule (which would seed
      // nothing -- see the handler's comment).
      expect(body).toContain("was skipped");
      expect(body).toContain("even after a retry");
      expect(body).not.toContain(occurrenceId);
      expect(body).not.toContain(taskId);
      expect(body).not.toContain("FREQ");
      expect(body).not.toContain("BYDAY");
      expect(body).not.toMatch(/fix|check its repeat rule/);
    });

    it("falls back to a generic name when the title is empty after stripping", async () => {
      const taskId = await insertTask(db, { title: "\u0007\u0001 " });
      const occurrenceId = await insertOccurrence(db, taskId);
      await insertDevice(db, "a");

      await createGenerateLazyOccurrenceDeadLetterHandler(
        db,
        boss as unknown as PgBoss,
      )([deadJob({ occurrenceId, fromStatus: "completed" })]);

      expect(sentPayloads()[0]!.body).toContain('"A recurring task" was completed');
    });

    // Idempotency is keyed on durable state, not on the payload.
    it("is a no-op once the dispatch log already records the attempt", async () => {
      const taskId = await insertTask(db);
      const occurrenceId = await insertOccurrence(db, taskId);
      const deviceId = await insertDevice(db, "a");
      const handler = createGenerateLazyOccurrenceDeadLetterHandler(db, boss as unknown as PgBoss);

      await handler([deadJob({ occurrenceId, fromStatus: "completed" })]);
      expect(boss.send).toHaveBeenCalledTimes(1);

      // What notifications.dispatch writes when it claims the target. From
      // here on the attempt is durable and a second delivery adds nothing.
      await db.insert(notificationDispatchLog).values({
        dedupeKey: `occurrences.generate-lazy.dead:${occurrenceId}:${deviceId}`,
        status: "accepted",
      });
      await handler([deadJob({ occurrenceId, fromStatus: "completed" })]);

      expect(boss.send).toHaveBeenCalledTimes(1);
      const second = records
        .filter((r) => r["event"] === "occurrences.generate_lazy.dead_lettered")
        .at(-1);
      expect(second).toMatchObject({ alert: "already_attempted", alertDevices: 0 });
    });

    it("derives the SAME key on a redelivery that lands before dispatch has claimed", async () => {
      // The at-least-once cost every producer pays: two enqueues, one key, and
      // the dispatch job's claim collapses them to one push.
      const taskId = await insertTask(db);
      const occurrenceId = await insertOccurrence(db, taskId);
      await insertDevice(db, "a");
      const handler = createGenerateLazyOccurrenceDeadLetterHandler(db, boss as unknown as PgBoss);

      await handler([deadJob({ occurrenceId, fromStatus: "completed" })]);
      await handler([deadJob({ occurrenceId, fromStatus: "completed" })]);

      const keys = new Set(sentPayloads().map((p) => p.dedupeKey));
      expect(keys.size).toBe(1);
    });

    it("stays silent when an open occurrence now exists (late success or manual repair)", async () => {
      const taskId = await insertTask(db);
      const occurrenceId = await insertOccurrence(db, taskId);
      const openId = await insertOccurrence(db, taskId, {
        status: "scheduled",
        occursAt: new Date("2026-09-14T14:00:00Z"),
        completedAt: null,
      });
      await insertDevice(db, "a");

      await createGenerateLazyOccurrenceDeadLetterHandler(
        db,
        boss as unknown as PgBoss,
      )([deadJob({ occurrenceId, fromStatus: "completed" })]);

      expect(boss.send).not.toHaveBeenCalled();
      expect(
        records.find((r) => r["event"] === "occurrences.generate_lazy.dead_letter_skipped"),
      ).toMatchObject({
        level: "info",
        reason: "open_occurrence_exists",
        openOccurrenceId: openId,
      });
    });

    it.each([
      ["occurrence_missing", () => Promise.resolve(crypto.randomUUID())],
      [
        "not_task_occurrence",
        async () => {
          const taskId = await insertTask(db);
          return insertOccurrence(db, taskId, {
            parentType: "event",
            parentId: crypto.randomUUID(),
          });
        },
      ],
      [
        "task_missing",
        async () => {
          const taskId = await insertTask(db);
          const id = await insertOccurrence(db, taskId);
          await db.delete(tasks).where(eq(tasks.id, taskId));
          return id;
        },
      ],
      [
        "task_closed",
        async () => insertOccurrence(db, await insertTask(db, { status: "dropped" })),
      ],
      [
        "task_closed",
        async () => insertOccurrence(db, await insertTask(db, { archivedAt: new Date() })),
      ],
      [
        "not_completion_anchored",
        async () => insertOccurrence(db, await insertTask(db, { recurrenceAnchor: "due_date" })),
      ],
      [
        "not_completion_anchored",
        async () => insertOccurrence(db, await insertTask(db, { recurrenceTimezone: null })),
      ],
    ])("skips with reason %s and alerts nobody", async (reason, setup) => {
      const occurrenceId = await setup();
      await insertDevice(db, "a");

      await createGenerateLazyOccurrenceDeadLetterHandler(
        db,
        boss as unknown as PgBoss,
      )([deadJob({ occurrenceId, fromStatus: "completed" })]);

      expect(boss.send).not.toHaveBeenCalled();
      expect(
        records.find((r) => r["event"] === "occurrences.generate_lazy.dead_letter_skipped"),
      ).toMatchObject({ level: "warn", reason, occurrenceId });
    });

    it.each([
      ["no device at all", () => Promise.resolve()],
      // Eligible on every flag, but notifications.dispatch would drop it before
      // claiming a dispatch-log row, so "sent" here would be a lie: no push,
      // no durable row, and every redelivery would enqueue again because the
      // prefix check could never find one.
      [
        "only a device without a push token",
        () => insertDevice(db, "tokenless", { pushToken: null }),
      ],
    ])("records the failure honestly as no_targets with %s", async (_label, setup) => {
      // The structural precondition every alert producer shares, stated
      // rather than hidden: with no deliverable device there is no
      // dispatch-log row, and the log line is the only evidence.
      const taskId = await insertTask(db);
      const occurrenceId = await insertOccurrence(db, taskId);
      await setup();

      await createGenerateLazyOccurrenceDeadLetterHandler(
        db,
        boss as unknown as PgBoss,
      )([deadJob({ occurrenceId, fromStatus: "completed" })]);

      expect(boss.send).not.toHaveBeenCalled();
      expect(
        records.find((r) => r["event"] === "occurrences.generate_lazy.dead_lettered"),
      ).toMatchObject({ alert: "no_targets", alertDevices: 0, occurrenceId, taskId });
    });
  });

  describe("occurrences.expand-window.dead", () => {
    it("alerts once per UTC date of the dead job's createdOn, with the sweep's counts", async () => {
      await insertDevice(db, "a");
      const handler = createExpandDueDateWindowDeadLetterHandler(db, boss as unknown as PgBoss);

      await handler([deadCronJob({})]);

      const [payload] = sentPayloads();
      expect(payload).toMatchObject({
        category: "alert",
        title: "Recurring schedules need attention",
        dedupeKey: "occurrences.expand-window.dead:2026-09-13",
        // Exactly one failed parent and it is a task: the existing route
        // resolver opens it from `taskId`.
        data: { queue: "occurrences.expand-window", failureDate: "2026-09-13", taskId: TASK_A },
      });
      // Counts, so a one-parent fault is never narrated as "schedules could
      // not be expanded", and no promise that it will heal on its own.
      expect(payload!.body).toContain(
        "1 of 14 recurring items could not be expanded or repaired overnight",
      );
      expect(payload!.body).not.toContain("until it succeeds");
      expect(payload!.body).not.toContain(TASK_A);
      expect(
        records.find((r) => r["event"] === "occurrences.expand_window.dead_lettered"),
      ).toMatchObject({
        level: "warn",
        failureDate: "2026-09-13",
        sourceJobId: "11111111-2222-4333-8444-555555555555",
        sourceRetryCount: 3,
        failedParents: 1,
        totalParents: 14,
        alert: "sent",
        alertDevices: 1,
      });
    });

    it("re-logs each failed parent by id at dead-letter time", async () => {
      // The sweep's own per-parent warn lines are three retries old and live
      // in a worker log that a container recreation discards (8.6C did);
      // job.output self-deletes on retention. This is the operator's last
      // durable-ish pointer to WHICH parent, so it is written again here.
      await insertDevice(db, "a");
      const refs = [
        { parentType: "task", parentId: TASK_A },
        { parentType: "event", parentId: EVENT_A },
        // Not uuid-shaped: whatever the row holds, only identifiers are re-logged.
        { parentType: "task", parentId: "FREQ=DAILY;BYDAY=MO" },
        { parentType: "note", parentId: TASK_B },
      ];
      await createExpandDueDateWindowDeadLetterHandler(
        db,
        boss as unknown as PgBoss,
      )([deadCronJob({ output: sweepOutput(refs, 20) })]);

      const parents = records.filter(
        (r) => r["event"] === "occurrences.expand_window.dead_letter_parent",
      );
      expect(parents).toEqual([
        expect.objectContaining({
          failureDate: "2026-09-13",
          parentType: "task",
          parentId: TASK_A,
        }),
        expect.objectContaining({
          failureDate: "2026-09-13",
          parentType: "event",
          parentId: EVENT_A,
        }),
      ]);
      // Several parents: nothing one tap could open, so no taskId.
      expect(sentPayloads()[0]!.data).toEqual({
        queue: "occurrences.expand-window",
        failureDate: "2026-09-13",
      });
      expect(sentPayloads()[0]!.body).toContain("4 of 20 recurring items");
    });

    it("routes to nothing when the single failed parent is an event", async () => {
      await insertDevice(db, "a");
      await createExpandDueDateWindowDeadLetterHandler(
        db,
        boss as unknown as PgBoss,
      )([deadCronJob({ output: sweepOutput([{ parentType: "event", parentId: EVENT_A }], 3) })]);
      expect(sentPayloads()[0]!.data).toEqual({
        queue: "occurrences.expand-window",
        failureDate: "2026-09-13",
      });
    });

    it("still alerts, without counts, when the output is missing or foreign", async () => {
      // On a redelivery pg-boss REPLACES the dead job's output with the dead
      // handler's own failure; and a row in a self-pruning table is data, not
      // a contract. Neither may cost the alert.
      await insertDevice(db, "a");
      const handler = createExpandDueDateWindowDeadLetterHandler(db, boss as unknown as PgBoss);
      await handler([deadCronJob({ output: undefined })]);
      await handler([
        deadCronJob({
          createdOn: new Date("2026-09-14T03:04:10Z"),
          output: { name: "TypeError", message: "boom", failedParents: "two", totalParents: -1 },
        }),
      ]);
      for (const payload of sentPayloads()) {
        expect(payload.body).toContain(
          "Some recurring items could not be expanded or repaired overnight",
        );
        expect(payload.data).not.toHaveProperty("taskId");
      }
      expect(
        records.filter((r) => r["event"] === "occurrences.expand_window.dead_letter_parent"),
      ).toHaveLength(0);
    });

    it("derives the SAME key on a redelivery that has lost its source metadata", async () => {
      // pg-boss's retried_jobs re-insert carries `created_on` but none of the
      // source_* columns, so the second delivery of a dead job that threw once
      // looks like this. A key on sourceCreatedOn with a createdOn fallback
      // could bucket a different date here and alert twice for one failure.
      await insertDevice(db, "a");
      const handler = createExpandDueDateWindowDeadLetterHandler(db, boss as unknown as PgBoss);
      await handler([deadCronJob({ createdOn: new Date("2026-09-14T00:30:00Z") })]);
      await handler([
        deadCronJob({
          createdOn: new Date("2026-09-14T00:30:00Z"),
          sourceCreatedOn: null,
          sourceId: null,
          sourceRetryCount: null,
        }),
      ]);
      const keys = new Set(sentPayloads().map((p) => p.dedupeKey));
      expect(keys).toEqual(new Set(["occurrences.expand-window.dead:2026-09-14"]));
    });

    it("is one alert per night, not one per exhausted chain", async () => {
      const deviceId = await insertDevice(db, "a");
      const handler = createExpandDueDateWindowDeadLetterHandler(db, boss as unknown as PgBoss);

      await handler([deadCronJob({})]);
      await db.insert(notificationDispatchLog).values({
        dedupeKey: `occurrences.expand-window.dead:2026-09-13:${deviceId}`,
        status: "accepted",
      });
      // A second dead job from the same night (a manual re-send that also
      // exhausted) shares the bucket and is silent...
      await handler([
        deadCronJob({
          id: "dead-cron-job-2",
          createdOn: new Date("2026-09-13T15:20:00Z"),
          sourceId: crypto.randomUUID(),
        }),
      ]);
      expect(boss.send).toHaveBeenCalledTimes(1);

      // ...and the next night's failure re-arms.
      await handler([deadCronJob({ createdOn: new Date("2026-09-14T03:04:10Z") })]);
      expect(boss.send).toHaveBeenCalledTimes(2);
      expect(sentPayloads()[1]!.dedupeKey).toBe("occurrences.expand-window.dead:2026-09-14");
    });
  });

  it("writes nothing but identifiers, tokens and counts to the log", async () => {
    const taskId = await insertTask(db);
    const occurrenceId = await insertOccurrence(db, taskId);
    await insertDevice(db, "a");
    await createGenerateLazyOccurrenceDeadLetterHandler(
      db,
      boss as unknown as PgBoss,
    )([deadJob({ occurrenceId, fromStatus: "completed" })]);
    await createExpandDueDateWindowDeadLetterHandler(
      db,
      boss as unknown as PgBoss,
    )([deadCronJob({})]);

    const everything = JSON.stringify(records);
    for (const forbidden of ["Water", "plants", "FREQ", "BYDAY", "attention", "[redacted]"]) {
      expect(everything).not.toContain(forbidden);
    }
    expect(records.length).toBeGreaterThanOrEqual(2);
  });
});
