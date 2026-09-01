import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { monitorTargets } from "./monitor-targets.js";

// Incidents (ADR-055, migration 0015).
//
// ===========================================================================
// AN INCIDENT IS LEGITIMATE DURABLE STATE. A FAILURE COUNTER IS NOT.
// ===========================================================================
//
// ADR-055 draws that line explicitly, and the distinction is not stylistic.
// A counter is derivable from `monitor_checks` and therefore duplicates it. An
// incident is not derivable from anything: it carries ACKNOWLEDGEMENT, which is
// a human act with no other record, and it is the anchor that makes a SECOND
// outage notifiable.
//
// That second point is the whole reason this table exists rather than the engine
// simply alerting on each transition. `notification_dispatch_log.dedupe_key` is a
// PERMANENT primary key with no TTL, and the existing
// `calendar-needs-reauth:${connectionId}` producer carries no time or incident
// discriminator -- so once that key is `accepted`, that connection can never
// alert again, for the life of the database. ADR-055 calls that out as a real
// latent defect and requires monitoring alerts to be INCIDENT-SCOPED:
// `monitor:${incidentId}:opened` and `monitor:${incidentId}:resolved`. A new
// outage means a new incident row, which means a new id, which means a key that
// has never been used.
//
// ---------------------------------------------------------------------------
// ONE ACTIVE INCIDENT PER TARGET, ENFORCED BY THE DATABASE.
//
// A partial unique index on `resolved_at is null`, not on `status <> 'resolved'`.
// Both would work in Postgres, but the `is null` form is the shape this
// repository's other partial indexes already use and the one
// `reconcile-drizzle-tracking.ts` provably handles -- and an index predicate the
// reconcile script cannot parse aborts `db:reconcile` for everyone, forever.
//
// The consistency CHECK below is what keeps `status` and `resolved_at` from
// disagreeing, so the index's predicate and the status vocabulary cannot drift
// apart into a state where two "open" incidents exist because one of them
// happened to have a resolved_at set.
export const monitorIncidents = pgTable(
  "monitor_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => monitorTargets.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("open"),
    /** The sanitized token that opened it. Never a message, never a URL. */
    failureClass: text("failure_class"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when a human acknowledges. Acknowledging does NOT resolve. */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** Advanced by every DOWN check while the incident is open. */
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("monitor_incidents_status", sql`${table.status} in ('open','acknowledged','resolved')`),
    // status and resolved_at must agree. Written with `in (...)` rather than
    // `<>` so it uses only operator shapes the reconcile script's boolean-
    // expression canonicaliser provably handles.
    check(
      "monitor_incidents_resolved_consistency",
      sql`(${table.resolvedAt} is null and ${table.status} in ('open','acknowledged')) or (${table.resolvedAt} is not null and ${table.status} = 'resolved')`,
    ),
    uniqueIndex("monitor_incidents_one_active_per_target")
      .on(table.targetId)
      .where(sql`${table.resolvedAt} is null`),
    index("monitor_incidents_target_opened_at_idx").on(table.targetId, table.openedAt),
  ],
);
