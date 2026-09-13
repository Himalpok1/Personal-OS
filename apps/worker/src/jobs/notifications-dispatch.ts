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
  // Diagnostics can target the requesting device. Production confirmation
  // jobs omit this and use normal category-based fan-out.
  deviceId?: string;
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

/**
 * Android notification channels each category is delivered on.
 *
 * Checkpoint 9.1 (ADR-062 follow-up), replacing what Checkpoint 8.1 shipped
 * here. Before this, "alert" hardcoded the id of the *reminders* channel --
 * justified at the time as THE ONLY CHANNEL THAT EXISTED ON THE DEVICE, with
 * every other category sent with no channelId at all (Android's implicit
 * default channel). That justification is now false, and leaving it standing
 * would be worse than no comment (see ADR-058's discussion of exactly this
 * failure mode in the mail digest's `output.ts`): apps/mobile now creates a
 * dedicated taxonomy in src/notifications/channel.ts --
 *
 *   - "alerts"  (HIGH importance)    -- integration/monitor alerts
 *   - "updates" (DEFAULT importance) -- capture confirmations + mail digest
 *   - "reminders" (MAX importance)   -- locally-scheduled task/event
 *                                        reminders only; never touches this
 *                                        queue, never receives a category
 *                                        push
 *
 * so muting Reminders no longer also mutes "your integration stopped", and a
 * routine digest no longer competes with an urgent alert for the same mute
 * switch.
 *
 * MUST MATCH `ALERTS_CHANNEL_ID` / `UPDATES_CHANNEL_ID` in
 * apps/mobile/src/notifications/channel.ts. Duplicated rather than imported
 * because apps/worker cannot depend on apps/mobile, and a shared package for
 * two string literals would be worse than this comment. A mismatch is not a
 * crash: Android silently ignores an unknown channelId and falls back to the
 * default channel, which is precisely the failure mode these constants exist
 * to avoid -- so both are asserted in notifications-dispatch.test.ts against
 * the mobile source, the same guard Checkpoint 8.1 used for the single
 * "reminders" id this replaces.
 */
const ANDROID_ALERTS_CHANNEL_ID = "alerts";
const ANDROID_UPDATES_CHANNEL_ID = "updates";

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
        data.deviceId ? eq(devices.id, data.deviceId) : undefined,
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
// still 'pending' (a prior crashed or transiently failed attempt), is
// claimable. Existing terminal rows ('accepted' or permanently 'failed')
// are skipped. This
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
  return existing?.status === "pending";
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
        // ANDROID CHANNEL ROUTING (Checkpoint 8.1, replaced Checkpoint 9.1).
        //
        // Every category now gets an explicit channelId -- see the constants
        // above for the taxonomy and why the old single-channel "reminders"
        // hack was replaced. `alert` additionally sets `priority: "high"`,
        // matching what Checkpoint 8.1 shipped: the channel's own HIGH
        // importance already implies a heads-up display on modern Android,
        // but setting it explicitly here keeps delivery behavior unchanged
        // rather than depending solely on channel configuration.
        // `confirmation`/`digest` deliberately carry no explicit priority --
        // the "updates" channel's DEFAULT importance is what keeps them
        // quiet, and forcing `priority: "high"` on the message would fight
        // the channel rather than express the "not urgent" intent.
        channelId:
          data.category === "alert" ? ANDROID_ALERTS_CHANNEL_ID : ANDROID_UPDATES_CHANNEL_ID,
        ...(data.category === "alert" ? { priority: "high" as const } : {}),
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

      // Expo should return one ticket per message. Treat a short response
      // as transient rather than silently completing with rows stranded in
      // pending state.
      if (tickets.length !== claimed.length) {
        anyTransient = true;
        for (const target of claimed.slice(tickets.length)) {
          await db
            .update(notificationDispatchLog)
            .set({ lastError: "Expo returned no ticket for this message" })
            .where(eq(notificationDispatchLog.dedupeKey, target.dedupeKey));
        }
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
