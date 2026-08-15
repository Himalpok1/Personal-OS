import { createDbClient } from "@personal-os/db";
import { PgBoss } from "pg-boss";
import { env } from "./env.js";
import { recordHeartbeat } from "./heartbeat.js";

const HEARTBEAT_QUEUE = "bootstrap.heartbeat";
const RETRY_DELAY_MS = 5000;

// Postgres restarting shouldn't crash-loop the worker.
async function startWithRetry(boss: PgBoss): Promise<void> {
  for (;;) {
    try {
      await boss.start();
      return;
    } catch (err) {
      console.error(`pg-boss failed to start, retrying in ${RETRY_DELAY_MS}ms`, err);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

async function main(): Promise<void> {
  const db = createDbClient(env.DATABASE_URL);

  // pg-boss's own schema is pre-created once by the migrator role (see
  // `pg-boss migrate` in docs/STATUS.md); the worker always runs with
  // migrate/createSchema off and connects with the least-privilege app role.
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    migrate: false,
    createSchema: false,
  });

  boss.on("error", (err: Error) => {
    console.error("pg-boss error", err);
  });

  await startWithRetry(boss);
  console.log("pg-boss started");

  await boss.createQueue(HEARTBEAT_QUEUE);
  await boss.work(HEARTBEAT_QUEUE, async () => {
    await recordHeartbeat(db);
  });
  await boss.schedule(HEARTBEAT_QUEUE, "* * * * *");

  console.log(`worker started, ${HEARTBEAT_QUEUE} scheduled every minute`);
}

main().catch((err: unknown) => {
  console.error("worker fatal error", err);
  process.exit(1);
});
