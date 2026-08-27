// Pure, React-free derivation of the Health connection banner's state -- same
// split as brief/brief-card-state.ts, and for the same reason: the ordering
// below is the whole design, and it is worth pinning with tests rather than
// re-deriving it inside a component's JSX.
//
// The load-bearing rule is the FIRST one. When the API is unreachable we know
// nothing about the connection, and every other state here is a claim about
// it. Falling through to "not connected" on a failed fetch would tell the user
// their Google Health link is gone when in fact the tunnel is down -- the
// worst available answer, since it invites them to reconnect and mint a new
// grant to fix a network problem.
import type { HealthConnectionSummary, HealthFreshnessDetail } from "@personal-os/schema";

export type HealthConnectionDisplayState =
  | "unavailable" // we cannot see the connection, so we assert nothing about it
  | "not_configured" // the server has no Google Health OAuth client at all
  | "not_connected" // configured, but nobody has completed the consent flow
  | "needs_reconnect" // needs_reauth or revoked
  | "no_streams_enabled" // active, but every stream is off -- nothing will sync
  | "syncing"
  | "partial_scope" // connected, but some approved scopes were not granted
  | "stale" // beyond the staleness threshold (ADR-046's 35-day contract)
  | "error" // a sync failed, but the connection is live and not stale
  | "current";

export interface ResolveHealthConnectionStateInput {
  /** HealthSummaryResponse.configured -- server-side OAuth client present. */
  configured: boolean;
  connection: HealthConnectionSummary | null;
  freshness: HealthFreshnessDetail;
  isOffline?: boolean;
  isLoadError?: boolean;
}

/**
 * Frozen precedence, most-blocking first:
 *
 *   unavailable -> not_configured -> not_connected -> needs_reconnect ->
 *   no_streams_enabled -> syncing -> partial_scope -> stale -> error -> current
 *
 * `no_streams_enabled` sits directly after `needs_reconnect` because it is the
 * post-reconnect trap: disconnecting disables every stream and reconnecting
 * deliberately does not re-enable them, so an active connection with zero
 * enabled streams will never sync anything. Every state below it presumes
 * syncing is at least possible, so reporting any of them ("syncing", "stale",
 * "Connected") would be a false statement about a connection that is
 * structurally idle.
 *
 * `syncing` outranks `partial_scope`, `stale` and `error` because all three of
 * those are about to be re-evaluated by the run currently in flight; showing a
 * staleness warning next to a live progress indicator reads as two
 * contradictory statements about the same fact.
 *
 * `partial_scope` outranks `stale` because a missing scope explains staleness
 * for the affected streams, and naming the cause beats naming the symptom.
 *
 * `error` sits below `stale` because a connection that is both erroring and
 * 40 days behind has a user-visible consequence -- the data is old -- that is
 * more actionable than the fact that a request failed.
 */
export function resolveHealthConnectionState(
  input: ResolveHealthConnectionStateInput,
): HealthConnectionDisplayState {
  const { configured, connection, freshness, isOffline, isLoadError } = input;

  if (isLoadError === true || isOffline === true) return "unavailable";
  if (!configured) return "not_configured";
  if (connection === null) return "not_connected";
  if (connection.needs_reconnect) return "needs_reconnect";
  // `stream_count > 0` keeps a connection whose streams were never seeded at
  // all (a mid-connect crash) out of this state -- that shape is not the
  // reconnect trap and the other states describe it better.
  if (connection.stream_count > 0 && connection.enabled_stream_count === 0) {
    return "no_streams_enabled";
  }
  if (freshness.sync_in_progress) return "syncing";
  if (connection.has_partial_scope) return "partial_scope";
  if (freshness.is_stale) return "stale";
  if (connection.has_sync_error) return "error";
  return "current";
}

/**
 * Whether a manual sync may be requested from this state.
 *
 * This is the SECOND of two independent guards, not the only one: the server
 * enqueues the connection sync job under a pg-boss `singletonKey` on the
 * connection id with `policy: "stately"` (Checkpoint 6.3), so a duplicate
 * request is already collapsed there. Disabling the control is a UI courtesy
 * -- a button that silently does nothing is worse than a disabled one -- and
 * must never be treated as the mechanism that makes sync safe.
 *
 * `stale` and `error` deliberately CAN sync: those are exactly the states a
 * manual retry is for.
 */
export function canRequestSync(state: HealthConnectionDisplayState): boolean {
  switch (state) {
    case "unavailable":
    case "not_configured":
    case "not_connected":
    case "needs_reconnect":
    // A queued sync for a zero-streams connection is accepted by the server
    // and then skipped by the worker (`no_enabled_streams`) -- a button that
    // "works" but can never do anything is exactly the trap this state names.
    case "no_streams_enabled":
    case "syncing":
      return false;
    case "partial_scope":
    case "stale":
    case "error":
    case "current":
      return true;
  }
}

export type HealthFreshnessKey = "never_verified" | "current" | "behind" | "stale";

export interface FreshnessDescription {
  key: HealthFreshnessKey;
  /**
   * Whole civil days between the verified-through date and today, or null when
   * nothing has been verified at all.
   *
   * NEVER 0 in the null case. "0 days behind" and "we have never verified
   * anything" are opposite claims, and collapsing them is the same class of
   * mistake as rendering a missing value as zero.
   */
  daysBehind: number | null;
  /** The last civil date an authoritative pass actually covered. */
  verifiedThroughDate: string | null;
}

export interface DescribeFreshnessInput {
  freshness: HealthFreshnessDetail;
  /** HealthSummaryResponse.local_date -- the requested timezone's local date. */
  todayLocalDate: string;
}

/** Whole days between two YYYY-MM-DD strings, via UTC so no offset is involved. */
function wholeDaysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Turn freshness into a machine key plus a number, so a component can render
 * "data through Aug 23 (1 day behind)" without doing calendar arithmetic of
 * its own -- the failure mode being two screens that disagree by a day.
 *
 * The server's own `days_behind` is preferred when present: it was computed
 * against the same requested timezone's local date, so recomputing here would
 * create a second answer to a question that already has one. The local
 * computation is only a fallback for the shape where a verified date exists
 * but the count did not come with it.
 */
export function describeFreshness(input: DescribeFreshnessInput): FreshnessDescription {
  const { freshness, todayLocalDate } = input;
  const verifiedThroughDate = freshness.verified_through_date;

  if (verifiedThroughDate === null) {
    return { key: "never_verified", daysBehind: null, verifiedThroughDate: null };
  }

  const computed = freshness.days_behind ?? wholeDaysBetween(verifiedThroughDate, todayLocalDate);
  // A negative count would mean we verified a date in the future, which cannot
  // happen -- the sync window is clamped to the last globally complete civil
  // day. Clamping keeps a corrupt row from rendering "-3 days behind".
  const daysBehind = computed === null ? null : Math.max(0, computed);

  if (freshness.is_stale) return { key: "stale", daysBehind, verifiedThroughDate };
  if (daysBehind !== null && daysBehind > 0) {
    return { key: "behind", daysBehind, verifiedThroughDate };
  }
  return { key: "current", daysBehind, verifiedThroughDate };
}
