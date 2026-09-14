import type { Db } from "@personal-os/db";
import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../env.js";
import {
  CALENDAR_PUSH_EVENT_DEAD_QUEUE,
  CALENDAR_PUSH_EVENT_QUEUE,
  QUEUE_RETRY_OPTIONS,
} from "../queue-names.js";
import { buildTestDb } from "../test/build-test-db.js";
import { attachCalendarPushDeadLetterQueue } from "./calendar-push-queues.js";

// The push-event dead-letter attach, proven at RUNTIME against pg-boss's real
// schema (Checkpoint 9.5) -- the occurrences-queues.test.ts argument applied
// to `calendar.google.push-event`: the primary already exists in production
// with `dead_letter IS NULL` (it has since Phase 4), so createQueue's
// `deadLetter` option is a silent no-op there and only updateQueue attaches
// anything. A fresh-database suite cannot see the difference; this puts the
// queue table into production's shape first.

interface QueueRow {
  name: string;
  dead_letter: string | null;
}

async function queueRows(db: Db): Promise<Map<string, string | null>> {
  const result = (await db.execute(
    sql`select name, dead_letter from pgboss.queue where name in ${[CALENDAR_PUSH_EVENT_QUEUE, CALENDAR_PUSH_EVENT_DEAD_QUEUE]}`,
  )) as unknown as { rows: QueueRow[] };
  return new Map(result.rows.map((row) => [row.name, row.dead_letter]));
}

async function simulateProductionState(db: Db, boss: PgBoss): Promise<void> {
  await db.execute(
    sql`delete from pgboss.job where name in ${[CALENDAR_PUSH_EVENT_QUEUE, CALENDAR_PUSH_EVENT_DEAD_QUEUE]}`,
  );
  await db.execute(
    sql`update pgboss.queue set dead_letter = null where name = ${CALENDAR_PUSH_EVENT_QUEUE}`,
  );
  await db.execute(sql`delete from pgboss.queue where name = ${CALENDAR_PUSH_EVENT_DEAD_QUEUE}`);
  await boss.createQueue(CALENDAR_PUSH_EVENT_QUEUE, QUEUE_RETRY_OPTIONS[CALENDAR_PUSH_EVENT_QUEUE]);
}

describe("calendar.google.push-event dead-letter queue against a real pg-boss", () => {
  let db: Db;
  let boss: PgBoss;

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
  });

  beforeEach(async () => {
    await simulateProductionState(db, boss);
  });

  afterAll(async () => {
    await boss.stop({ graceful: false, timeout: 5000 });
  });

  it("starts from production's shape: primary present, unattached, dead queue absent", async () => {
    const rows = await queueRows(db);
    expect(rows.get(CALENDAR_PUSH_EVENT_QUEUE)).toBeNull();
    expect(rows.has(CALENDAR_PUSH_EVENT_DEAD_QUEUE)).toBe(false);
  });

  it("attaches the dead-letter queue to the ALREADY-EXISTING primary", async () => {
    await attachCalendarPushDeadLetterQueue(boss);
    const rows = await queueRows(db);
    expect(rows.get(CALENDAR_PUSH_EVENT_QUEUE)).toBe(CALENDAR_PUSH_EVENT_DEAD_QUEUE);
    expect(rows.has(CALENDAR_PUSH_EVENT_DEAD_QUEUE)).toBe(true);
  });

  it("is idempotent across a second boot and leaves the retry options untouched", async () => {
    await attachCalendarPushDeadLetterQueue(boss);
    await attachCalendarPushDeadLetterQueue(boss);
    const rows = await queueRows(db);
    expect(rows.get(CALENDAR_PUSH_EVENT_QUEUE)).toBe(CALENDAR_PUSH_EVENT_DEAD_QUEUE);

    const result = (await db.execute(
      sql`select retry_limit, retry_delay, retry_backoff, policy from pgboss.queue where name = ${CALENDAR_PUSH_EVENT_QUEUE}`,
    )) as unknown as {
      rows: { retry_limit: number; retry_delay: number; retry_backoff: boolean; policy: string }[];
    };
    expect(result.rows[0]).toMatchObject({
      retry_limit: 5,
      retry_delay: 15,
      retry_backoff: true,
      policy: "standard",
    });
  });
});
