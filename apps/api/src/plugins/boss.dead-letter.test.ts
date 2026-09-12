import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../env.js";
import {
  CAPTURE_PARSE_DEAD_QUEUE,
  CAPTURE_PARSE_QUEUE,
  OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE,
  OCCURRENCES_GENERATE_LAZY_QUEUE,
  QUEUE_RETRY_OPTIONS,
} from "../queue-names.js";
import { registerBoss } from "./boss.js";
import { registerDb } from "./db.js";

// The api's dead-letter attach, proven at RUNTIME (Checkpoint 9.0).
//
// apps/worker's queue-parity.test.ts asserts that this file's attach sequence
// is WRITTEN -- that the `updateQueue(...)` text is present. Text can survive
// an edit that moves the call behind a condition, into the wrong branch, or
// after an early return, and the scan would stay green while the api booted
// and attached nothing. That matters because the api and the worker are
// deployed as separate images and whichever boots first after a rollback is
// the one whose attach has to hold: an api image rolled forward alone must
// still attach the primary it sends to.
//
// The worker's copy has occurrences-queues.test.ts for the same proof; this is
// the api half. It puts `pgboss.queue` into production's pre-checkpoint shape
// -- primary present with `dead_letter IS NULL`, dead queue absent -- boots
// registerBoss exactly as server.ts does, and reads the outcome back from the
// queue table. Against that shape createQueue's `deadLetter` option is a
// silent no-op (create_queue ends in ON CONFLICT DO NOTHING), so only a
// registerBoss that actually EXECUTES updateQueue can pass.

interface QueueRow {
  name: string;
  dead_letter: string | null;
}

const PAIRS = [
  [OCCURRENCES_GENERATE_LAZY_QUEUE, OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE],
  // The 8.6A precedent, covered by the same mechanism so a regression in the
  // shared pattern fails twice rather than once.
  [CAPTURE_PARSE_QUEUE, CAPTURE_PARSE_DEAD_QUEUE],
] as const;

async function queueRows(app: FastifyInstance): Promise<Map<string, string | null>> {
  const names = PAIRS.flat();
  const result = (await app.db.execute(
    sql`select name, dead_letter from pgboss.queue where name in ${names}`,
  )) as unknown as { rows: QueueRow[] };
  return new Map(result.rows.map((row) => [row.name, row.dead_letter]));
}

/**
 * Production's pre-checkpoint shape. Jobs first because `job.name` and
 * `job.dead_letter` both reference `queue.name`; the primary is then created
 * through pg-boss itself (so it carries exactly the options production's row
 * carries, partition table included) and left in place with its dead letter
 * cleared -- which is the point.
 */
async function simulateProductionState(app: FastifyInstance): Promise<void> {
  const primaries = PAIRS.map(([primary]) => primary);
  const dead = PAIRS.map(([, deadQueue]) => deadQueue);
  await app.db.execute(sql`delete from pgboss.job where name in ${[...primaries, ...dead]}`);
  await app.db.execute(sql`update pgboss.queue set dead_letter = null where name in ${primaries}`);
  await app.db.execute(sql`delete from pgboss.queue where name in ${dead}`);

  // `supervise`/`schedule` off: this instance exists to run create_queue and
  // nothing else, and must not fire the cron rows the test database carries.
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
  });
  await boss.start();
  try {
    for (const primary of primaries) {
      await boss.createQueue(primary, QUEUE_RETRY_OPTIONS[primary]);
    }
  } finally {
    await boss.stop({ graceful: false, timeout: 5000 });
  }
}

describe("registerBoss dead-letter attach against an already-existing queue", () => {
  let staging: FastifyInstance;
  let app: FastifyInstance;

  beforeAll(async () => {
    // A db-only instance arranges the shape; a second, full instance then
    // boots registerBoss against it. Two instances so the arrangement cannot
    // accidentally run AFTER the attach it is meant to precede.
    staging = Fastify({ logger: false });
    registerDb(staging);
    await simulateProductionState(staging);
    const before = await queueRows(staging);
    for (const [primary, deadQueue] of PAIRS) {
      expect(before.get(primary)).toBeNull();
      expect(before.has(deadQueue)).toBe(false);
    }

    app = Fastify({ logger: false });
    registerDb(app);
    await registerBoss(app);
  });

  afterAll(async () => {
    await app.close();
    await staging.close();
  });

  it("started pg-boss (the precondition for anything below)", () => {
    expect(app.bossReady).toBe(true);
  });

  it("attaches each dead queue to its ALREADY-EXISTING primary", async () => {
    const after = await queueRows(app);
    for (const [primary, deadQueue] of PAIRS) {
      expect(after.has(deadQueue)).toBe(true);
      expect(after.get(primary)).toBe(deadQueue);
    }
  });
});
