import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { canvasConnections } from "./canvas-connections.js";

// ADR-068 Canvas LMS integration (migration 0020). One row per sync attempt,
// shaped on mail_sync_runs -- the inversion that table established is copied
// deliberately: a row is opened `failed` before any request goes out and
// flipped to its true terminal status only on completion, so a killed process
// leaves evidence rather than silence.
//
// failure_class and error_message carry NO check constraint (ADR-050) and are
// for SANITIZED CLASSIFICATION TOKENS ONLY, never raw provider error prose --
// the mail_sync_runs rule applies verbatim, including the reason it matters:
// Canvas's error prose can echo the offending request back, and pg-boss
// persists whatever a handler throws into pgboss.job.output, a durable table.
// packages/schema enforces the actual token shape
// (/^[a-z][a-z0-9_]{0,63}(:[A-Za-z0-9_.-]{1,64})?$/, the exact regex
// mail-sync-errors.ts/health-metrics.ts/monitor.ts already share) -- this
// column only receives tokens that have already passed it.
//
// courses_synced/assignments_synced/announcements_synced/events_synced are
// per-run counts, one column per entity kind, deliberately not folded into
// the rows_inserted/rows_updated/rows_unchanged shape mail_sync_runs and
// health_sync_runs use: a Canvas sync run walks four distinct entity kinds
// per course rather than one homogeneous row stream, and per-course failure
// containment (ADR-068 §5) means "how many of each kind actually landed"
// is the more useful audit signal here.
//
// This is operational metadata, not Canvas content, so canvas_sync_runs joins
// the existing daily retention.cleanup job on the same 30-day finished_at
// window mail_sync_runs/health_sync_runs already use -- no new cron, no new
// schedule (ADR-068 §5).
export const canvasSyncRuns = pgTable(
  "canvas_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => canvasConnections.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    coursesSynced: integer("courses_synced"),
    assignmentsSynced: integer("assignments_synced"),
    announcementsSynced: integer("announcements_synced"),
    eventsSynced: integer("events_synced"),
    failureClass: text("failure_class"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("canvas_sync_runs_kind", sql`${table.kind} in ('manual','cron')`),
    check("canvas_sync_runs_status", sql`${table.status} in ('succeeded','failed','skipped')`),
    index("canvas_sync_runs_connection_started_at_idx").on(table.connectionId, table.startedAt),
  ],
);
