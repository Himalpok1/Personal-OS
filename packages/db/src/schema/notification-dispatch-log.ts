import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// The real idempotency safety net for apps/worker/src/jobs/notifications-dispatch.ts
// under pg-boss's at-least-once delivery -- a bare row's existence does NOT
// mean the push was accepted; only status = 'accepted' does. This closes
// the crash window where an insert succeeds but the worker dies before the
// Expo Push API call completes: a 'pending' row from a prior crashed
// attempt is retried on redelivery, not silently skipped.
//
// 'accepted', not 'sent' -- a successful Expo push ticket means Expo
// accepted the request for a delivery attempt, not that FCM or the
// physical device received it. This system never claims delivery
// confirmation, only submission acceptance (receipt polling, the only
// mechanism that would prove delivery, is explicitly deferred).
export const notificationDispatchLog = pgTable(
  "notification_dispatch_log",
  {
    dedupeKey: text("dedupe_key").primaryKey(),
    status: text("status").notNull().default("pending"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    lastError: text("last_error"),
    expoTicketId: text("expo_ticket_id"),
  },
  (table) => [
    check(
      "notification_dispatch_log_status",
      sql`${table.status} in ('pending','accepted','failed')`,
    ),
  ],
);
