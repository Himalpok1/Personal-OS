// Gmail failure alerting (Checkpoint 8.1, Lane C).
//
// ===========================================================================
// DELIBERATELY ONE ALERT, NOT A MAIL OBSERVABILITY SUBSYSTEM
// ===========================================================================
//
// Discovery found NO Gmail alert producer at all: of the five `category:
// "alert"` producers in the system, three are monitoring and two are the
// calendar/health integrations. Mail's only notification path is the DIGEST
// push, which is `category: "digest"`.
//
// This adds exactly one alertable condition -- the connection has entered
// `needs_reauth` -- because that is the only mail state a user can DO something
// about. Everything else the sync engine classifies is either transient
// (`rate_limited`, `transport`, `provider_unavailable`), self-healing, or not
// actionable:
//
//   - `cursor_expired` is NOT an alert. ADR-053 makes 404-on-`startHistoryId` a
//     first-class RECOVERY path: it flips to `needs_full_resync`, a bounded full
//     sync runs, and a new cursor is minted. Alerting on a designed transition
//     would train the user to ignore the channel.
//   - `rate_limited` / `transport` / `provider_unavailable` are what the
//     limiter and the cron exist to absorb. The next tick is the retry.
//   - `auth_rejected` (`MailRefreshBudgetExhaustedError`) is a pass-local
//     budget decision of ours, not a grant problem, and does not change status.
//
// So the trigger is a STATE TRANSITION, not a failure count, which is also why
// no consecutive-failure derivation is needed here.
//
// ===========================================================================
// WHAT THE BODY MAY SAY
// ===========================================================================
//
// A push notification renders on a lock screen -- the least private surface in
// the system. ADR-054 is explicit that no email subject, address or display
// name may appear in one, and this producer goes further than the rule requires
// by carrying no mailbox identifier at all: the body is a fixed literal chosen
// from a closed taxonomy, and `data` carries only the connection uuid so the
// app can deep-link to Settings.
//
// It also carries NO provider prose. `mail_connections.last_sync_error` is
// already a closed `MailSyncErrorCode` enum rather than free text (ADR-053), so
// there is nothing to sanitize here -- but the body does not interpolate even
// that, because a failure code is operator vocabulary and the user's question is
// only "what do I do".
import { devices, mailConnections, type Db } from "@personal-os/db";
import { and, eq, isNull } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";

/** The closed, static user-facing taxonomy. One member today, by design. */
const MAIL_ALERT_COPY = {
  needs_reauth: {
    title: "Gmail needs reconnecting",
    body: "Mail sync has stopped. Reconnect it in Settings.",
  },
} as const;

/**
 * Fans the needs-reauth alert out to every eligible device, keyed to THIS
 * failure episode.
 *
 * ===========================================================================
 * WHY `last_sync_error_at` IS A SAFE DISCRIMINATOR HERE -- WITH A CAVEAT
 * ===========================================================================
 *
 * `notification_dispatch_log.dedupe_key` is a permanent PRIMARY KEY with no TTL,
 * claimed with `onConflictDoNothing`, so a key scoped to a connection id fires
 * once in the system's lifetime and is then permanently dead (ADR-057 finding
 * #4, which cost a real missed production alert on the calendar connection).
 * The discriminator here is the instant the connection entered its current
 * needs-reauth episode.
 *
 * THE CAVEAT, STATED BECAUSE IT DIFFERS FROM HEALTH. Health's
 * `last_sync_error_at` is written ONLY by needs-reauth transitions, so it is
 * episode-exact by construction. Mail's is ALSO written by
 * `recordMailConnectionError`, a NON-FATAL path that does not change status --
 * so the column is not episode-exact by its writer set alone.
 *
 * It is episode-stable here for a different and weaker reason, which is why it
 * is written down rather than assumed: once a connection is `needs_reauth`, no
 * sync pass runs against it. `enqueueMailSyncForAllActiveConnections` selects
 * `status = 'active'`, and the pass itself re-checks and returns
 * `connection_not_active` before touching anything. So the non-fatal writer
 * cannot fire during an episode.
 *
 * If a future change ever syncs a non-active connection, THIS GUARANTEE BREAKS
 * and the discriminator must move to a column only the transition writes.
 */
export async function enqueueMailNeedsReauthAlert(
  db: Db,
  boss: PgBoss | null | undefined,
  connectionId: string,
  now: Date,
): Promise<void> {
  if (!boss) return;

  const [row] = await db
    .select({
      status: mailConnections.status,
      lastSyncErrorAt: mailConnections.lastSyncErrorAt,
    })
    .from(mailConnections)
    .where(eq(mailConnections.id, connectionId));

  // Reconnected or disconnected in between -- there is no live episode to alert
  // about, and minting a key here would burn one for an episode already over.
  if (!row || row.status !== "needs_reauth") return;

  // Nullable column. Null would mean the status was set without the transition
  // that stamps it, which no current path does; the pass instant keeps the
  // alert firing rather than throwing on an unreachable state.
  const discriminator = (row.lastSyncErrorAt ?? now).toISOString();
  const dedupeKey = `mail-needs-reauth:${connectionId}:${discriminator}`;

  const eligible = await db
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(
        eq(devices.notifyAlerts, true),
        eq(devices.notificationsEnabled, true),
        isNull(devices.revokedAt),
      ),
    );

  for (const device of eligible) {
    await boss.send(NOTIFICATIONS_DISPATCH_QUEUE, {
      category: "alert",
      title: MAIL_ALERT_COPY.needs_reauth.title,
      body: MAIL_ALERT_COPY.needs_reauth.body,
      // The connection uuid only. No address, no mailbox name, no counts.
      data: { mailConnectionId: connectionId },
      dedupeKey,
      deviceId: device.id,
    });
  }
}
