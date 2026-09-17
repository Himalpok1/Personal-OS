// The one place the Health surface says anything about the connection
// itself. A thin renderer over connection-state.ts: the precedence between
// the nine states, and the question of whether a manual sync may be
// requested, are both already decided there and tested there.
//
// Two rules shape every sentence below.
//
// 1. NEVER RENDER A PROVIDER ERROR. `HealthConnectionSummary` cannot even
//    express one -- `last_sync_error` is deliberately not projected across
//    the API boundary (see health-metrics.ts), only a timestamp and a
//    boolean. So the `error` state describes the CONSEQUENCE ("the last sync
//    didn't finish") rather than the cause, and it does so structurally: a
//    Google phrase or a Postgres `detail` cannot reach this file.
//
// 2. NEVER CLAIM TO KNOW ABOUT DEVICES. `pairedDevices.list` needs
//    `googlehealth.settings.readonly`, a fourth scope this project
//    deliberately never requested (ADR-046). Nothing here may say a wearable
//    is connected, disconnected, or last synced at some time -- we cannot
//    see any of that, and guessing would be the single most misleading thing
//    this card could do.
import { View } from "react-native";
import type { HealthConnectionSummary, HealthFreshnessDetail } from "@personal-os/schema";
import { AppText, Button, Card, ListRow, StatusChip } from "@/components/ui";
import { formatShortDate } from "@/utils/local-date";
import {
  canRequestSync,
  describeFreshness,
  type HealthConnectionDisplayState,
} from "./connection-state";
import { healthConnectionChipTone } from "./connection-tone";

/**
 * The single most useful sentence on this screen.
 *
 * Personal OS is a READER of Google Health, not a collector. Someone looking
 * at a dashboard where most tiles say "no data yet" will otherwise conclude
 * that Personal OS is broken, when the actual state of this account is that
 * no wearable sends to Google Health at all. This says so once, plainly,
 * without asserting anything about what devices exist.
 */
export const HEALTH_SOURCE_NOTE =
  "Personal OS reads what's already in Google Health. An app or device has to send data to Google Health first before it can appear here.";

/**
 * Human names for the three Phase 6A read scopes.
 *
 * Keyed on the URL's last path segment rather than the whole URL so a host
 * change cannot silently drop every name, and the fallback derives a readable
 * phrase from the segment instead of printing a raw URL at the user -- an
 * OAuth scope URL is not something anyone can act on.
 */
const SCOPE_LABELS: Record<string, string> = {
  "googlehealth.activity_and_fitness.readonly": "Activity and fitness",
  "googlehealth.sleep.readonly": "Sleep",
  "googlehealth.health_metrics_and_measurements.readonly": "Health metrics and measurements",
};

export function scopeLabel(scope: string): string {
  const segment = scope.split("/").filter(Boolean).pop() ?? scope;
  if (Object.prototype.hasOwnProperty.call(SCOPE_LABELS, segment)) return SCOPE_LABELS[segment]!;
  // "googlehealth.body_composition.readonly" -> "Body composition"
  const core = segment.replace(/^googlehealth\./, "").replace(/\.readonly$/, "");
  const words = core.split(/[._-]+/).filter(Boolean).join(" ");
  if (words.length === 0) return scope;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface CopyBlock {
  /** Short status line, e.g. "Connected". */
  status: string;
  /** The explanatory sentence(s) under it. */
  body: string;
  /** Red rather than neutral. Reserved for states the user must act on. */
  tone: "neutral" | "warning";
}

/**
 * All ten states' copy, assembled in one function so it reads as copy and
 * can be reviewed as copy -- the same reason METRIC_EXPLANATIONS lives as a
 * flat record in metric-state.ts.
 */
function copyFor(
  state: HealthConnectionDisplayState,
  freshness: HealthFreshnessDetail,
  todayLocalDate: string,
): CopyBlock {
  const described = describeFreshness({ freshness, todayLocalDate });
  const through =
    described.verifiedThroughDate === null
      ? null
      : formatShortDate(described.verifiedThroughDate);

  switch (state) {
    case "unavailable":
      // Asserts NOTHING about the connection. Falling through to "not
      // connected" on a failed fetch would invite the user to mint a new
      // OAuth grant to fix a network problem.
      return {
        status: "Can't check right now",
        body: "Personal OS can't reach its own API, so it can't tell you anything about Google Health at the moment.",
        tone: "neutral",
      };

    case "not_configured":
      return {
        status: "Not set up",
        body: "Google Health isn't set up on this server yet. There's nothing to connect to until it is.",
        tone: "neutral",
      };

    case "not_connected":
      return {
        status: "Not connected",
        body: "Google Health is available on this server, but no account has been connected yet.",
        tone: "neutral",
      };

    case "needs_reconnect":
      return {
        status: "Reconnect needed",
        body: "Google Health access has ended. Reconnect to start reading new data again. Data already stored stays where it is.",
        tone: "warning",
      };

    case "no_streams_enabled":
      // The post-reconnect trap: disconnecting turns every data type off, and
      // reconnecting deliberately does not turn them back on (a blanket
      // disable is indistinguishable from the user's own choice). Without
      // this state the card would read "Connected" while nothing can ever
      // sync. Honest about the recovery path too: there is no in-app toggle
      // yet (a recorded scope decision), so the copy names the fact, not a
      // control that doesn't exist.
      return {
        status: "Connected, but nothing is set to sync",
        body:
          "Every data type on this connection is currently turned off — disconnecting turns them all off, and reconnecting doesn't turn them back on. " +
          (through ? `Data already stored still goes through ${through}, but no` : "No") +
          " new data will sync until data types are turned back on for this connection.",
        tone: "warning",
      };

    case "syncing":
      return {
        status: "Checking Google Health…",
        body: through
          ? `A sync is running now. Data currently goes through ${through}.`
          : "A sync is running now.",
        tone: "neutral",
      };

    case "partial_scope":
      return {
        status: "Some data types weren't included",
        body: "Some kinds of data weren't included when this account was connected, so Personal OS can't read them. Reconnecting lets you include them.",
        tone: "warning",
      };

    case "stale": {
      // daysBehind can legitimately be 0 here: ADR-048 widens the sync window
      // by a day at each end, so verified_through_date can sit level with (or
      // ahead of) the requested local date while the server still considers
      // the connection stale. "Data is 0 days behind" would be nonsense, so
      // that case states what IS true -- how far the data reaches -- instead.
      const behind =
        described.daysBehind === null
          ? "Data hasn't been verified yet."
          : described.daysBehind === 0
            ? `Data reaches ${through || "the current day"}.`
            : `Data is ${described.daysBehind} ${described.daysBehind === 1 ? "day" : "days"} behind${
                through ? `, through ${through}` : ""
              }.`;
      return {
        status: "Data is behind",
        body:
          `${behind} Personal OS re-reads a trailing window of recent days, so a change made in Google Health ` +
          `more than about ${freshness.staleness_threshold_days} days ago isn't picked up until that period is checked again.`,
        tone: "warning",
      };
    }

    case "error":
      // No cause, because we structurally do not have one. Saying what
      // happens next is more useful than a message we cannot produce.
      return {
        status: "Last sync didn't finish",
        body: through
          ? `A recent sync didn't complete. Personal OS will try again. Data currently goes through ${through}.`
          : "A recent sync didn't complete. Personal OS will try again.",
        tone: "neutral",
      };

    case "current":
      return {
        status: "Connected",
        body: through ? `Data through ${through}.` : "Connected. No days have been verified yet.",
        tone: "neutral",
      };
  }
}

export interface HealthConnectionCardProps {
  state: HealthConnectionDisplayState;
  connection: HealthConnectionSummary | null;
  freshness: HealthFreshnessDetail;
  /** HealthSummaryResponse.local_date. */
  todayLocalDate: string;
  onSync?: () => void;
  /**
   * Take the user to where the connection is managed.
   *
   * Used for BOTH "Connect" and "Reconnect": completing the OAuth flow is out
   * of Checkpoint 6.4's scope, so neither action starts a consent flow here.
   * The screen wires this to navigate to Settings, which is where the
   * connect/reconnect path actually lives.
   */
  onReconnect?: () => void;
  /** True while the sync mutation is in flight. */
  isSyncPending?: boolean;
  /** Transient confirmation, e.g. after a sync is queued. */
  notice?: string | null;
  /**
   * A failed request, e.g. the sync mutation erroring. Rendered in the
   * warning tone. Without this the Sync button silently reverted to "Sync
   * now" on failure -- offline, a 409, a 503 -- and the user had no way to
   * tell a failed request from one that went through (6.7A, finding H3/E2).
   */
  errorNotice?: string | null;
}

export function HealthConnectionCard({
  state,
  connection,
  freshness,
  todayLocalDate,
  onSync,
  onReconnect,
  isSyncPending,
  notice,
  errorNotice,
}: HealthConnectionCardProps) {
  const copy = copyFor(state, freshness, todayLocalDate);

  // Two independent guards, and this is the SECOND of them. The server
  // enqueues the connection sync under a pg-boss `singletonKey` on the
  // connection id with `policy: "stately"` (Checkpoint 6.3), so a duplicate
  // request is already collapsed there. Disabling the control is a courtesy
  // -- a button that silently does nothing is worse than a disabled one --
  // and must never be mistaken for the mechanism that makes sync safe.
  const syncDisabled = !canRequestSync(state) || isSyncPending === true;

  const showSync = onSync !== undefined && state !== "not_configured" && state !== "not_connected";
  const showConnect = onReconnect !== undefined && state === "not_connected";
  const showReconnect =
    onReconnect !== undefined && (state === "needs_reconnect" || state === "partial_scope");

  const missingScopes = state === "partial_scope" ? (connection?.missing_scopes ?? []) : [];

  return (
    <Card>
      <ListRow icon="heart-pulse" iconTone="success" title="Google Health" inset last />

      {/* The status is a WORD about state, so it is a chip (never tappable);
          its tone follows the copy's own neutral/warning split through the
          pure map in connection-tone.ts. */}
      <StatusChip
        label={copy.status}
        tone={healthConnectionChipTone(state)}
        size="md"
        className="mt-1"
      />
      <AppText variant="body" tone="secondary" className="mt-2">
        {copy.body}
      </AppText>

      {missingScopes.length > 0 ? (
        <View className="mt-3">
          <AppText variant="overline" tone="muted">
            Not included
          </AppText>
          {missingScopes.map((scope) => (
            <AppText key={scope} variant="body" tone="secondary">
              · {scopeLabel(scope)}
            </AppText>
          ))}
        </View>
      ) : null}

      {notice ? (
        <AppText variant="label" tone="info" className="mt-3">
          {notice}
        </AppText>
      ) : null}

      {errorNotice ? (
        <AppText variant="label" tone="warning" className="mt-3">
          {errorNotice}
        </AppText>
      ) : null}

      {showSync || showConnect || showReconnect ? (
        <View className="mt-4 flex-row flex-wrap gap-2">
          {showConnect ? <Button label="Connect" onPress={onReconnect!} /> : null}
          {showReconnect ? <Button label="Reconnect" onPress={onReconnect!} /> : null}
          {showSync ? (
            // `disabled`, not `busy`: the label already says "Syncing…" for
            // both the in-flight mutation and a server-side run, and a screen
            // reader must be told the control is unavailable either way -- a
            // visually dimmed but still-pressable button is the exact shape
            // that fires a second sync.
            <Button
              label={state === "syncing" || isSyncPending === true ? "Syncing…" : "Sync now"}
              onPress={onSync!}
              disabled={syncDisabled}
              variant="outline"
            />
          ) : null}
        </View>
      ) : null}

      <AppText variant="caption" tone="muted" className="mt-4">
        {HEALTH_SOURCE_NOTE}
      </AppText>
    </Card>
  );
}
