import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Service monitoring targets (ADR-055, migration 0015).
//
// TARGETS ARE ROWS, NOT CONSTANTS. A hardcoded URL list would mean a deploy to
// change what is watched, and would make "is this endpoint monitored?" a
// question you answer by reading source rather than by querying. It also makes
// the seed set auditable: what is actually watched in production is whatever
// this table says, not what someone believed when the image was built.
//
// `kind` IS CHECK-CONSTRAINED; `failure_class` ELSEWHERE IS NOT. That split is
// ADR-050 applied literally: `kind` is a closed vocabulary this project fully
// controls (there are exactly two ways to observe a service, and adding a third
// is a deliberate design act), whereas a diagnostic class set legitimately grows
// and a CHECK on it would force a `DROP CONSTRAINT` migration that
// `reconcile-drizzle-tracking.ts` cannot process -- the 0009 fallout.
//
// ---------------------------------------------------------------------------
// THERE IS NO consecutive_failures COLUMN, AND THERE MUST NEVER BE ONE.
//
// ADR-055 states the rule and `apps/worker/src/health/breaker.ts` supplies the
// argument verbatim: a counter is a second source of truth that has to be reset
// correctly on every success path, and one missed reset means a target trips
// after five failures spread across a month. Reading the last N rows of
// `monitor_checks` cannot drift, because there is nothing to keep in step.
//
// An INCIDENT, by contrast, is legitimate durable state -- it carries
// acknowledgement, and it is the anchor that makes a SECOND outage notifiable.
export const monitorTargets = pgTable(
  "monitor_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable human label. Also the only thing safe to put in a log line. */
    name: text("name").notNull(),
    /**
     * How this target is observed.
     *
     * `http` probes a URL. `worker_heartbeat` reads `worker_heartbeat.last_beat_at`
     * and is evaluated by the API PROCESS, never the worker -- a worker-hosted
     * monitor cannot alert on its own death (ADR-055).
     */
    kind: text("kind").notNull(),
    /** Null for `worker_heartbeat`, which observes a table rather than a URL. */
    url: text("url"),
    expectedStatus: integer("expected_status").notNull().default(200),
    /**
     * Parse the response body against the Personal OS `/health` contract and
     * fail the check when it reports a degraded database or a stale worker.
     *
     * A 200 whose body says `db: "unreachable"` is not "up" in any sense the
     * user cares about, and recording it as up would make the monitor agree
     * with the outage.
     */
    expectHealthyPayload: boolean("expect_healthy_payload").notNull().default(false),
    timeoutMs: integer("timeout_ms").notNull().default(10000),
    intervalSeconds: integer("interval_seconds").notNull().default(300),
    /** Consecutive DOWN checks required to open an incident. */
    failureThreshold: integer("failure_threshold").notNull().default(3),
    /** Consecutive UP checks required to resolve one. */
    recoveryThreshold: integer("recovery_threshold").notNull().default(2),
    /**
     * Warn this many days before the TLS certificate expires. Null disables the
     * TLS probe entirely, which is correct for `http://` and for the heartbeat.
     */
    tlsWarnDays: integer("tls_warn_days"),
    /** Staleness bound for `worker_heartbeat`; null for every other kind. */
    heartbeatMaxAgeSeconds: integer("heartbeat_max_age_seconds"),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * A RECURRING daily maintenance window, in the same shape as
     * `devices.quiet_hours_*` -- deliberately, so it can reuse
     * `isWithinQuietHours` from packages/core, which already handles the
     * overnight-wraparound case (22:00 to 06:00) and is already tested. A second
     * implementation of "is now inside a local time window" would be a second
     * chance to get DST wrong.
     */
    maintenanceStart: time("maintenance_start"),
    maintenanceEnd: time("maintenance_end"),
    maintenanceTimezone: text("maintenance_timezone"),
    /**
     * AD-HOC suppression, for a deploy. Distinct from the recurring window
     * because the two answer different questions: "we restart nightly" is a
     * property of the service, "we are deploying right now" is an event.
     */
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("monitor_targets_kind", sql`${table.kind} in ('http','worker_heartbeat')`),
    // Positive bounds, so a misconfigured row cannot produce a zero-timeout
    // probe that fails instantly forever, or a zero threshold that opens an
    // incident on the very first blip.
    check("monitor_targets_timeout_positive", sql`${table.timeoutMs} > 0`),
    check("monitor_targets_interval_positive", sql`${table.intervalSeconds} > 0`),
    check("monitor_targets_failure_threshold_positive", sql`${table.failureThreshold} > 0`),
    check("monitor_targets_recovery_threshold_positive", sql`${table.recoveryThreshold} > 0`),
    // All-or-nothing, exactly as the encrypted credential triples are: a window
    // with a start and no timezone is not a window, it is a bug that would
    // silently evaluate in whatever zone the server happens to run in.
    check(
      "monitor_targets_maintenance_window_complete",
      sql`(${table.maintenanceStart} is null and ${table.maintenanceEnd} is null and ${table.maintenanceTimezone} is null) or (${table.maintenanceStart} is not null and ${table.maintenanceEnd} is not null and ${table.maintenanceTimezone} is not null)`,
    ),
    uniqueIndex("monitor_targets_name_unique").on(table.name),
  ],
);
