import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { monitorTargets } from "./monitor-targets.js";

// One row per probe execution (ADR-055, migration 0015).
//
// ===========================================================================
// THIS TABLE IS THE ONLY SOURCE OF TRUTH FOR CONSECUTIVE-FAILURE COUNTING.
// ===========================================================================
//
// ADR-055 forbids a counter column, and `health/breaker.ts` supplies the reason:
// a counter must be reset correctly on every success path, and reading the last
// N rows cannot drift because there is nothing to keep in step. Every threshold
// decision in the engine is a query against this table.
//
// ---------------------------------------------------------------------------
// STATUS IS THREE-VALUED, AND `skipped` IS THE LOAD-BEARING ONE.
//
// `up` / `down` / `skipped`. A check suppressed by a maintenance window writes a
// `skipped` row rather than writing nothing, for two reasons:
//
//   1. "We deliberately did not look" is a FACT, and it is what makes ADR-055's
//      third uptime state derivable rather than inferred from a gap. A window in
//      which the monitor was not running must never render as 0% uptime, and it
//      cannot if the absence of a row and a deliberate skip are distinguishable.
//   2. Threshold evaluation EXCLUDES skipped rows entirely. Without that, a
//      nightly maintenance window would silently reset a failure streak that was
//      one check away from opening an incident -- the same lesson the mail
//      breaker learned about counting its own skips.
//
// ---------------------------------------------------------------------------
// `failure_class` CARRIES A SANITIZED TOKEN, NEVER A MESSAGE OR A URL.
//
// A probe error can carry the URL it failed against, and a target URL may
// legitimately contain a token in a query string. `packages/monitoring`'s
// classifier only ever emits lowercase machine tokens, and this column exists to
// receive them. It carries no CHECK (ADR-050): the diagnostic set grows, and
// widening a CHECK later would need a `DROP CONSTRAINT` that
// `reconcile-drizzle-tracking.ts` cannot process.
export const monitorChecks = pgTable(
  "monitor_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => monitorTargets.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    httpStatus: integer("http_status"),
    latencyMs: integer("latency_ms"),
    failureClass: text("failure_class"),
    /** Observed certificate expiry, when a TLS probe ran. */
    tlsExpiresAt: timestamp("tls_expires_at", { withTimezone: true }),
    tlsDaysRemaining: integer("tls_days_remaining"),
    /** Heartbeat age in seconds, for `worker_heartbeat` targets. */
    heartbeatAgeSeconds: integer("heartbeat_age_seconds"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("monitor_checks_status", sql`${table.status} in ('up','down','skipped')`),
    check(
      "monitor_checks_latency_nonnegative",
      sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`,
    ),
    // Ascending, NOT (target_id, checked_at DESC), and this is a repository
    // constraint rather than a preference: `deriveIndexProbe` in
    // packages/db/scripts/reconcile-drizzle-tracking.ts requires every indexed
    // column to match /^[a-z_][a-z0-9_]*$/, so a DESC modifier aborts
    // `db:reconcile` outright. It costs nothing -- a btree is scanned in either
    // direction, so this serves `ORDER BY checked_at DESC` identically, which is
    // the only way threshold evaluation ever reads it.
    index("monitor_checks_target_checked_at_idx").on(table.targetId, table.checkedAt),
  ],
);
