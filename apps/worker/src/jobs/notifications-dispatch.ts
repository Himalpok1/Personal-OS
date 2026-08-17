import { isWithinQuietHours } from "@personal-os/core";
import { devices, notificationDispatchLog, type Db } from "@personal-os/db";
import { and, eq, isNull, like } from "drizzle-orm";
import {
  Expo,
  type ExpoPushErrorReceipt,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from "expo-server-sdk";
import type { Job } from "pg-boss";

export type NotificationCategory = "confirmation" | "alert" | "digest";

export interface NotificationsDispatchJobData {
  category: NotificationCategory;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // The base dedupe key for this notification event (e.g.
  // `confirmation:${inboxId}`) -- the actual notification_dispatch_log key
  // is this suffixed with `:${deviceId}`, so each target device's delivery
  // attempt is tracked and deduped independently of every other target's.
  dedupeKey: string;
}

// Reminders never appear here -- they're scheduled locally on the primary
// device (see docs/ARCHITECTURE.md's notification routing table) and never
// touch this queue. Only confirmation/alert/digest categories are ever
// enqueued; notify_reminders exists on `devices` but is intentionally
// unwired to anything in Phase 3.
const NOTIFY_COLUMN_BY_CATEGORY = {
  confirmation: devices.notifyConfirmations,
  alert: devices.notifyAlerts,
  digest: devices.notifyDigests,
} as const;

// Expo ticket error codes that are structurally permanent -- retrying them
// changes nothing about the outcome. Everything else (a thrown network
// error, an HTTP-level failure from Expo's own API, or an unrecognized
// error code) is treated as transient and left for the job to retry.
// Check this set against Expo's current documented ticket errors at
// implementation-review time; it reflects what's documented as of this
// pass, not a guaranteed-exhaustive enumeration.
const PERMANENT_TICKET_ERRORS = new Set([
  "DeviceNotRegistered",
  "MessageTooBig",
  "MessageRateExceeded",
  "InvalidCredentials",
]);

function isErrorTicket(ticket: ExpoPushTicket): ticket is ExpoPushErrorReceipt {
  return ticket.status === "error";
}

interface DispatchTarget {
  deviceId: string;
  pushToken: string;
  dedupeKey: string;
}

// Resolves the devices this notification should actually be attempted
// against this run: enabled for the category, not revoked, has a push
// token, and (for confirmation/digest only) not currently in quiet hours.
async function resolveTargets(
  db: Db,
  data: NotificationsDispatchJobData,
): Promise<DispatchTarget[]> {
  const notifyColumn = NOTIFY_COLUMN_BY_CATEGORY[data.category];
  const candidates = await db
    .select()
    .from(devices)
    .where(
      and(
        eq(notifyColumn, true),
        eq(devices.notificationsEnabled, true),
        isNull(devices.revokedAt),
      ),
    );

  const now = new Date();
  const targets: DispatchTarget[] = [];
  for (const device of candidates) {
    if (!device.pushToken) continue;
    if (
      data.category !== "alert" &&
      isWithinQuietHours(
        now,
        device.quietHoursStart,
        device.quietHoursEnd,
        device.quietHoursTimezone,
      )
    ) {
      continue;
    }
    targets.push({
      deviceId: device.id,
      pushToken: device.pushToken,
      dedupeKey: `${data.dedupeKey}:${device.id}`,
    });
  }
  return targets;
}

// Claims a target for this attempt: a fresh insert, or an existing row
// still 'pending'/'failed' (a prior crashed or failed attempt), are both
// claimable. An existing 'accepted' row means this delivery already
// completed -- skip it, this is a genuine duplicate of finished work. This
// is the crash-safety fix: a bare row's existence never implied delivery
// on its own, only status = 'accepted' does.
async function claimTarget(db: Db, dedupeKey: string): Promise<boolean> {
  const [inserted] = await db
    .insert(notificationDispatchLog)
    .values({ dedupeKey, status: "pending" })
    .onConflictDoNothing({ target: notificationDispatchLog.dedupeKey })
    .returning({ dedupeKey: notificationDispatchLog.dedupeKey });
  if (inserted) return true;

  const [existing] = await db
    .select({ status: notificationDispatchLog.status })
    .from(notificationDispatchLog)
    .where(eq(notificationDispatchLog.dedupeKey, dedupeKey));
  return existing?.status === "pending" || existing?.status === "failed";
}

const expo = new Expo();

export function createNotificationsDispatchHandler(db: Db) {
  return async function handleNotificationsDispatch(
    jobs: Job<NotificationsDispatchJobData>[],
  ): Promise<void> {
    for (const job of jobs) {
      const data = job.data;
      const targets = await resolveTargets(db, data);

      const claimed: DispatchTarget[] = [];
      for (const target of targets) {
        if (await claimTarget(db, target.dedupeKey)) claimed.push(target);
      }
      if (claimed.length === 0) continue;

      const messages: ExpoPushMessage[] = claimed.map((target) => ({
        to: target.pushToken,
        title: data.title,
        body: data.body,
        data: data.data,
      }));

      let tickets: ExpoPushTicket[];
      try {
        tickets = await expo.sendPushNotificationsAsync(messages);
      } catch (err) {
        // The whole batch failed at the transport level (network error, or
        // Expo's API itself returned a non-2xx for the request) -- every
        // claimed target stays 'pending' for pg-boss's own retry to pick
        // back up. Rethrow to trigger that retry.
        throw err instanceof Error ? err : new Error(String(err));
      }

      let anyTransient = false;
      for (const [index, ticket] of tickets.entries()) {
        const target = claimed[index];
        if (!target) continue;

        if (!isErrorTicket(ticket)) {
          await db
            .update(notificationDispatchLog)
            .set({ status: "accepted", acceptedAt: new Date(), expoTicketId: ticket.id })
            .where(eq(notificationDispatchLog.dedupeKey, target.dedupeKey));
          continue;
        }

        const errorCode = ticket.details?.error;
        const permanent = errorCode !== undefined && PERMANENT_TICKET_ERRORS.has(errorCode);

        if (permanent) {
          if (errorCode === "DeviceNotRegistered") {
            await db
              .update(devices)
              .set({ pushToken: null })
              .where(eq(devices.id, target.deviceId));
          }
          await db
            .update(notificationDispatchLog)
            .set({ status: "failed", lastError: ticket.message })
            .where(eq(notificationDispatchLog.dedupeKey, target.dedupeKey));
          // Deliberately no rethrow for this target -- retrying a
          // permanent error changes nothing and only delays this row's
          // eventual (already-correct) terminal state.
          continue;
        }

        // Transient: leave the row 'pending' so a redelivered job attempt
        // reuses it rather than creating a duplicate, and mark this batch
        // for retry.
        await db
          .update(notificationDispatchLog)
          .set({ lastError: ticket.message })
          .where(eq(notificationDispatchLog.dedupeKey, target.dedupeKey));
        anyTransient = true;
      }

      if (anyTransient) {
        throw new Error(
          `notifications.dispatch: ${data.dedupeKey} had at least one transient failure, retrying`,
        );
      }
    }
  };
}

// Dead-letter handler: runs only once pg-boss has exhausted every retry for
// a notifications.dispatch job (see queue-names.ts's
// NOTIFICATIONS_DISPATCH_DEAD_QUEUE, registered via createQueue's
// deadLetter option). Ensures a row that was still 'pending' when the
// retry budget ran out doesn't linger there forever with no terminal
// state -- honest at-least-once semantics: the notification was genuinely
// never confirmed accepted, and this records that as a real, visible
// failure rather than silent loss.
//
// Matches by dedupe_key prefix rather than re-deriving the target device
// list (resolveTargets queries *current* device state, which may have
// drifted -- e.g. a device revoked between the original attempt and this
// dead-letter run -- and would then miss rows this handler should still
// finalize).
export function createNotificationsDispatchDeadLetterHandler(db: Db) {
  return async function handleNotificationsDispatchDead(
    jobs: Job<NotificationsDispatchJobData>[],
  ): Promise<void> {
    for (const job of jobs) {
      await db
        .update(notificationDispatchLog)
        .set({ status: "failed", lastError: "retries exhausted" })
        .where(
          and(
            like(notificationDispatchLog.dedupeKey, `${job.data.dedupeKey}:%`),
            eq(notificationDispatchLog.status, "pending"),
          ),
        );
    }
  };
}
