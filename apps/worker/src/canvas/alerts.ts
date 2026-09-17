// Canvas invalid-token alerting (Checkpoint 10.4, ADR-073).
//
// ===========================================================================
// DELIBERATELY ONE ALERT, NOT A CANVAS OBSERVABILITY SUBSYSTEM
// ===========================================================================
//
// Mirrors apps/worker/src/mail/alerts.ts's own restraint, verbatim in spirit.
// Before this checkpoint Canvas had NO alert producer at all -- orchestrate.ts
// said so explicitly: a dead PAT flipped the row to `invalid_token`, and the
// Settings screen's own status rendering was the only surface. This adds
// exactly one alertable condition -- the connection has entered
// `invalid_token` -- because that is the only Canvas sync state the owner can
// DO something about. Every other failure class (`rate_limited`,
// `provider_error`, `blocked_url`, a per-course `auth_failed`) is transient,
// contained by the sync loop itself, or not actionable, and the hourly cron
// tick is already the retry.
//
// It is also gated behind orchestrate.ts's own `isSecondConsecutiveAuthFailure`
// hysteresis, so this producer never fires on a single, possibly-transient
// connection-level permission blip -- only a SECOND CONSECUTIVE one reaches
// `markConnectionInvalidToken` and, immediately after it, this function.
//
// ===========================================================================
// WHAT THE BODY MAY SAY
// ===========================================================================
//
// A push notification renders on a lock screen -- the least private surface in
// the system. ADR-068 never put an institution name, base URL, course or
// assignment identifier in any Canvas-facing surface, and this alert doesn't
// start now: the body is a fixed literal chosen from a closed taxonomy, and
// `data` carries only the connection uuid so the app can deep-link to
// Settings.
//
// It also carries NO provider prose. `canvas_connections.last_sync_error` is
// already a closed, token-shaped classification (the same FAILURE_CLASS regex
// run.ts enforces before ever writing the column), so there is nothing to
// sanitize here -- but the body does not interpolate even that token, because
// a failure code is operator vocabulary and the owner's only question is
// "what do I do".
import { canvasConnections, devices, type Db } from "@personal-os/db";
import { and, eq, isNull } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";

/** The closed, static user-facing taxonomy. One member today, by design. */
const CANVAS_ALERT_COPY = {
  invalid_token: {
    title: "Canvas needs reconnecting",
    body: "Assignment sync has stopped. Reconnect it in Settings.",
  },
} as const;

/**
 * Fans the invalid-token alert out to every eligible device, keyed to THIS
 * failure episode.
 *
 * ===========================================================================
 * WHY `last_sync_error_at` IS A SAFE DISCRIMINATOR HERE -- WITH THE SAME
 * CAVEAT MAIL'S OWN FILE DOCUMENTS
 * ===========================================================================
 *
 * `notification_dispatch_log.dedupe_key` is a permanent PRIMARY KEY with no
 * TTL, claimed with `onConflictDoNothing`, so a key scoped to a connection id
 * alone fires once in the system's lifetime and is then permanently dead
 * (ADR-058). The discriminator here is the instant `markConnectionInvalidToken`
 * stamped when THIS episode began.
 *
 * THE CAVEAT, STATED BECAUSE IT DIFFERS FROM HEALTH AND MATCHES MAIL EXACTLY.
 * `last_sync_error_at` is NOT episode-exact by its writer set alone:
 * `recordConnectionError` (orchestrate.ts) ALSO writes it, on the non-fatal
 * path that leaves status untouched -- including on the first, absorbed
 * failure of a two-in-a-row streak. It is episode-STABLE here for the
 * identical, weaker reason mail's is: once a connection leaves `active`
 * status, `enqueueCanvasSyncForAllActiveConnections` selects `status =
 * 'active'` only, so no further sync pass -- fatal or non-fatal -- ever
 * touches this connection's `last_sync_error_at` again until the owner
 * reconnects (the 10.1C reconnect path, which replaces the credential and
 * clears the error columns in one update, ending the episode). If a future
 * change ever syncs a non-active connection, THIS GUARANTEE BREAKS and the
 * discriminator must move to a column only the `invalid_token` transition
 * itself writes.
 */
export async function enqueueCanvasInvalidTokenAlert(
  db: Db,
  boss: PgBoss | null | undefined,
  connectionId: string,
  now: Date,
): Promise<void> {
  if (!boss) return;

  const [row] = await db
    .select({
      status: canvasConnections.status,
      lastSyncErrorAt: canvasConnections.lastSyncErrorAt,
    })
    .from(canvasConnections)
    .where(eq(canvasConnections.id, connectionId));

  // Reconnected or disconnected in between -- there is no live episode to
  // alert about, and minting a key here would burn one for an episode
  // already over.
  if (!row || row.status !== "invalid_token") return;

  // Nullable column. Null would mean the status was set without the
  // transition that stamps it, which no current path does; the pass instant
  // keeps the alert firing rather than throwing on an unreachable state.
  const discriminator = (row.lastSyncErrorAt ?? now).toISOString();
  const dedupeKey = `canvas-invalid-token:${connectionId}:${discriminator}`;

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
      title: CANVAS_ALERT_COPY.invalid_token.title,
      body: CANVAS_ALERT_COPY.invalid_token.body,
      // The connection uuid only. No base URL, no course/assignment name.
      data: { canvasConnectionId: connectionId },
      dedupeKey,
      deviceId: device.id,
    });
  }
}
