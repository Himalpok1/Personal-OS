import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// A physical client (native app install or web browser) authorized to call
// the device/notification-specific API surface (see
// apps/api/src/plugins/device-auth.ts). This is additive to the Tailscale
// network perimeter, not a replacement for it -- the existing
// tasks/notes/projects/capture/inbox/occurrences routes remain
// Tailscale-only, unchanged. See docs/ARCHITECTURE.md's devices sketch and
// docs/DECISIONS.md for the security-boundary ADR this table backs.
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    pushToken: text("push_token"),
    // sha256(rawToken) hex -- a fast one-way hash, not the AES-256-GCM
    // scheme credential-crypto.ts uses for AI provider keys. A device
    // token is never decrypted, only compared, and 256 bits of entropy
    // has no dictionary to defend against -- see packages/core/device-auth.ts.
    tokenHash: text("token_hash").notNull().unique(),
    isPrimaryReminderDevice: boolean("is_primary_reminder_device").notNull().default(false),
    // Unused in the MVP -- reserved for a real failover chain later, per
    // docs/ARCHITECTURE.md.
    reminderPriority: smallint("reminder_priority"),
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
    // Reserved: reminders are local-scheduled on the primary device, never
    // dispatched through notifications.dispatch (see
    // apps/worker/src/jobs/notifications-dispatch.ts). This flag has no
    // wired behavior in Phase 3.
    notifyReminders: boolean("notify_reminders").notNull().default(false),
    notifyConfirmations: boolean("notify_confirmations").notNull().default(true),
    notifyDigests: boolean("notify_digests").notNull().default(false),
    notifyAlerts: boolean("notify_alerts").notNull().default(true),
    quietHoursStart: time("quiet_hours_start"),
    quietHoursEnd: time("quiet_hours_end"),
    quietHoursTimezone: text("quiet_hours_timezone"),
    // Diagnostic only, bumped on every authenticated request -- explicitly
    // NOT a heartbeat (a phone that hasn't checked in recently is usually
    // just a phone that wasn't opened, per docs/ARCHITECTURE.md).
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    // Soft-invalidation, semantically distinct from the archivedAt columns
    // elsewhere in this codebase: the row stays visible for history, but
    // the token stops authenticating immediately. Revoking does NOT cut
    // off this device's access to the rest of the API -- see the
    // security-boundary note on apps/api/src/plugins/device-auth.ts.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("devices_platform", sql`${table.platform} in ('ios','android','web')`),
    // Enforced by the database, not just application logic. Non-deferrable:
    // the primary-swap endpoint must clear the old primary and set the new
    // one as two separate statements, in that order, or this index rejects
    // the transaction mid-flight.
    uniqueIndex("one_primary_device")
      .on(table.isPrimaryReminderDevice)
      .where(sql`${table.isPrimaryReminderDevice}`),
  ],
);
