import { occurrences, tasks, type Db } from "@personal-os/db";
import { sql } from "drizzle-orm";
import { PgBoss, type Job } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../env.js";
import { setLogSink } from "../logger.js";
import {
  OCCURRENCES_EXPAND_WINDOW_DEAD_QUEUE,
  OCCURRENCES_EXPAND_WINDOW_QUEUE,
  OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE,
  OCCURRENCES_GENERATE_LAZY_QUEUE,
  QUEUE_RETRY_OPTIONS,
} from "../queue-names.js";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import {
  createGenerateLazyOccurrenceHandler,
  type GenerateLazyOccurrenceJobData,
} from "./generate-lazy-occurrence.js";
import { attachOccurrencesDeadLetterQueues } from "./occurrences-dead-letter.js";

// The dead-letter attach, proven at RUNTIME against pg-boss's real schema.
//
// ===========================================================================
// WHY A SOURCE SCAN IS NOT ENOUGH HERE
// ===========================================================================
//
// queue-parity.test.ts asserts that the attach sequence is WRITTEN. This file
// asserts that it WORKS -- against the exact state production is in: both
// primaries already exist in `pgboss.queue` with `dead_letter IS NULL`, and
// neither dead queue exists. Against that state createQueue's `deadLetter`
// option is a silent no-op (create_queue ends in ON CONFLICT DO NOTHING), so a
// registration that only used createQueue would pass every fresh-database
// suite, deploy, and leave production exactly as it was. The only thing that
// can catch that is running the production sequence against a database that
// already has the queues, which is what `simulateProductionState` arranges.
//
// The second half then sends a real job through the real handler with the
// queue's retries collapsed to zero, and waits for the real dead-letter worker
// to receive it -- proving the routing pg-boss performs on exhaustion (dlq_jobs
// CTE in failJobsBody) delivers the payload to the handler index.ts binds, and
// that what it persisted about the failure is the contained error and nothing
// raw.
//
// `supervise` and `schedule` are off: this instance must neither run
// maintenance against the shared test schema nor fire the cron rows the test
// database carries. Both are irrelevant to dead-lettering, which happens inside
// the fail statement itself, not in a maintenance pass.

const PRIMARIES = [OCCURRENCES_GENERATE_LAZY_QUEUE, OCCURRENCES_EXPAND_WINDOW_QUEUE] as const;
const DEAD = [OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE, OCCURRENCES_EXPAND_WINDOW_DEAD_QUEUE] as const;

interface QueueRow {
  name: string;
  dead_letter: string | null;
}

async function queueRows(db: Db): Promise<Map<string, string | null>> {
  const result = (await db.execute(
    sql`select name, dead_letter from pgboss.queue where name in ${[...PRIMARIES, ...DEAD]}`,
  )) as unknown as { rows: QueueRow[] };
  return new Map(result.rows.map((row) => [row.name, row.dead_letter]));
}

/**
 * Puts the queue table into production's pre-checkpoint shape: primaries
 * present with no dead letter, dead queues absent, no jobs on any of the four.
 *
 * Jobs first because `job.dead_letter` and `job.name` both reference
 * `queue.name` (RESTRICT); primaries are created through pg-boss itself so
 * they carry exactly the options production's rows carry.
 */
async function simulateProductionState(db: Db, boss: PgBoss): Promise<void> {
  await db.execute(sql`delete from pgboss.job where name in ${[...PRIMARIES, ...DEAD]}`);
  await db.execute(sql`update pgboss.queue set dead_letter = null where name in ${[...PRIMARIES]}`);
  await db.execute(sql`delete from pgboss.queue where name in ${[...DEAD]}`);
  for (const primary of PRIMARIES) {
    await boss.createQueue(primary, QUEUE_RETRY_OPTIONS[primary]);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms waiting for ${what}`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

describe("occurrences dead-letter queues against a real pg-boss", () => {
  let db: Db;
  let boss: PgBoss;
  let restore: () => void;

  beforeAll(async () => {
    db = buildTestDb();
    boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: "pgboss",
      migrate: false,
      createSchema: false,
      supervise: false,
      schedule: false,
    });
    await boss.start();
    restore = setLogSink({ write: () => {} });
  });

  beforeEach(async () => {
    await truncateTestTables(db);
    await simulateProductionState(db, boss);
  });

  afterAll(async () => {
    restore();
    await truncateTestTables(db);
    await boss.stop({ graceful: false, timeout: 5000 });
  });

  it("starts from production's shape: primaries present, unattached, dead queues absent", async () => {
    const rows = await queueRows(db);
    for (const primary of PRIMARIES) expect(rows.get(primary)).toBeNull();
    for (const dead of DEAD) expect(rows.has(dead)).toBe(false);
  });

  it("attaches both dead-letter queues to ALREADY-EXISTING primaries", async () => {
    await attachOccurrencesDeadLetterQueues(boss);

    const rows = await queueRows(db);
    expect(rows.get(OCCURRENCES_GENERATE_LAZY_QUEUE)).toBe(OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE);
    expect(rows.get(OCCURRENCES_EXPAND_WINDOW_QUEUE)).toBe(OCCURRENCES_EXPAND_WINDOW_DEAD_QUEUE);
    for (const dead of DEAD) expect(rows.has(dead)).toBe(true);
  });

  it("is idempotent across a second boot", async () => {
    await attachOccurrencesDeadLetterQueues(boss);
    await attachOccurrencesDeadLetterQueues(boss);

    const rows = await queueRows(db);
    expect(rows.get(OCCURRENCES_GENERATE_LAZY_QUEUE)).toBe(OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE);
    expect(rows.get(OCCURRENCES_EXPAND_WINDOW_QUEUE)).toBe(OCCURRENCES_EXPAND_WINDOW_DEAD_QUEUE);
  });

  it("leaves the primaries' retry options untouched", async () => {
    // updateQueue is called with `deadLetter` only; a regression that passed the
    // whole option set through would be harmless today but would silently
    // become the place a retry policy changed.
    await attachOccurrencesDeadLetterQueues(boss);
    const result = (await db.execute(
      sql`select name, retry_limit, retry_delay, retry_backoff, policy from pgboss.queue where name in ${[...PRIMARIES]}`,
    )) as unknown as {
      rows: {
        name: string;
        retry_limit: number;
        retry_delay: number;
        retry_backoff: boolean;
        policy: string;
      }[];
    };
    const byName = new Map(result.rows.map((row) => [row.name, row]));
    expect(byName.get(OCCURRENCES_GENERATE_LAZY_QUEUE)).toMatchObject({
      retry_limit: 5,
      retry_delay: 15,
      retry_backoff: true,
      policy: "standard",
    });
    expect(byName.get(OCCURRENCES_EXPAND_WINDOW_QUEUE)).toMatchObject({
      retry_limit: 3,
      retry_delay: 60,
      retry_backoff: false,
      policy: "standard",
    });
  });

  it("routes an exhausted generate-lazy job to the dead queue with its payload, output contained", async () => {
    await attachOccurrencesDeadLetterQueues(boss);

    // A BY* part on a completion-anchored rule: write-time validation should
    // have refused it, so the handler throws on every attempt. The rule text
    // is what must NOT reach the job table.
    const [task] = await db
      .insert(tasks)
      .values({
        title: "Water the plants",
        status: "active",
        timezone: "America/Chicago",
        rrule: "FREQ=DAILY;BYDAY=MO",
        recurrenceTimezone: "America/Chicago",
        recurrenceAnchor: "completion_date",
      })
      .returning({ id: tasks.id });
    const [occurrence] = await db
      .insert(occurrences)
      .values({
        parentType: "task",
        parentId: task!.id,
        occursAt: new Date("2026-09-10T14:00:00Z"),
        occursLocal: new Date("2026-09-10T09:00:00Z"),
        status: "done",
        lazyGenerated: true,
        completedAt: new Date("2026-09-11T02:30:00Z"),
      })
      .returning({ id: occurrences.id });
    const occurrenceId = occurrence!.id;

    let resolveDead: (job: Job<GenerateLazyOccurrenceJobData>) => void = () => {};
    const received = new Promise<Job<GenerateLazyOccurrenceJobData>>((resolve) => {
      resolveDead = resolve;
    });
    const deadWorkerId = await boss.work<GenerateLazyOccurrenceJobData>(
      OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE,
      { pollingIntervalSeconds: 0.5 },
      (jobs) => {
        for (const job of jobs) if (job.data.occurrenceId === occurrenceId) resolveDead(job);
        return Promise.resolve();
      },
    );
    const primaryWorkerId = await boss.work(
      OCCURRENCES_GENERATE_LAZY_QUEUE,
      { pollingIntervalSeconds: 0.5 },
      createGenerateLazyOccurrenceHandler(db),
    );

    try {
      // retryLimit 0 on THIS send collapses the five retries the queue
      // would otherwise spend (15s, 30s, 60s...) so exhaustion is immediate;
      // the routing on exhaustion is identical.
      const jobId = await boss.send(
        OCCURRENCES_GENERATE_LAZY_QUEUE,
        { occurrenceId, fromStatus: "completed" },
        { retryLimit: 0 },
      );
      expect(jobId).not.toBeNull();

      const dead = await withTimeout(received, 20_000, "the dead-letter worker");
      expect(dead.name).toBe(OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE);
      expect(dead.data).toEqual({ occurrenceId, fromStatus: "completed" });

      // The dead job records its provenance, and both rows persist only
      // the contained error.
      const rows = (await db.execute(
        sql`select name, state, output::text as output, source_name, source_id
              from pgboss.job where id = ${jobId} or source_id = ${jobId}`,
      )) as unknown as {
        rows: {
          name: string;
          state: string;
          output: string | null;
          source_name: string | null;
          source_id: string | null;
        }[];
      };
      const source = rows.rows.find((row) => row.name === OCCURRENCES_GENERATE_LAZY_QUEUE);
      const deadRow = rows.rows.find((row) => row.name === OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE);
      expect(source?.state).toBe("failed");
      expect(deadRow?.source_name).toBe(OCCURRENCES_GENERATE_LAZY_QUEUE);
      expect(deadRow?.source_id).toBe(jobId);
      for (const row of [source, deadRow]) {
        expect(row?.output).toContain("OccurrencesJobError");
        expect(row?.output).not.toContain("BYDAY");
        expect(row?.output).not.toContain("FREQ");
        expect(row?.output).not.toContain("Water");
      }
    } finally {
      await boss.offWork(OCCURRENCES_GENERATE_LAZY_QUEUE, { id: primaryWorkerId });
      await boss.offWork(OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE, { id: deadWorkerId });
    }
  }, 30_000);
});
