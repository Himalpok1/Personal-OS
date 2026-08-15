import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

// Lazy: does not connect at import time. apps/api relies on this so it can
// boot and serve /health even when Postgres is unreachable. A short
// connectionTimeoutMillis keeps a down database from hanging /health forever.
export function createDbClient(connectionString: string) {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000 });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDbClient>;
