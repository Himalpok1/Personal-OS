import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

// Singleton row: the worker updates this on every heartbeat cycle so a dead
// worker is observable (see docs/ARCHITECTURE.md, "Worker crashes must be loud").
export const workerHeartbeat = pgTable(
  "worker_heartbeat",
  {
    id: smallint("id").primaryKey().default(1),
    lastBeatAt: timestamp("last_beat_at", { withTimezone: true }),
    status: text("status").notNull().default("unknown"),
  },
  (table) => [check("worker_heartbeat_singleton", sql`${table.id} = 1`)],
);
