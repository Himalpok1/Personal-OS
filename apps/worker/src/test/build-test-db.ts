import { createDbClient, occurrences, tasks, type Db } from "@personal-os/db";
import { env } from "../env.js";

// vitest.config.ts points DATABASE_URL at TEST_DATABASE_URL before this
// module is ever imported.
export function buildTestDb(): Db {
  return createDbClient(env.DATABASE_URL);
}

export async function truncateTestTables(db: Db): Promise<void> {
  await db.delete(occurrences);
  await db.delete(tasks);
}
