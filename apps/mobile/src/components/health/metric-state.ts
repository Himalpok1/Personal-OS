// Pure, React-free display-state derivation for a single Health metric tile --
// same split as brief/brief-card-state.ts and calendar/week-grid-layout.ts:
// the decision about WHAT a tile is showing lives here as plain data-in/
// data-out and gets real vitest coverage, while the .tsx stays a thin renderer
// with no branching worth testing separately.
//
// This module exists because the Health surface has an unusually high cost of
// getting "missing" wrong. Checkpoint 6.3L established that twelve of the
// eighteen enabled streams have never produced a single value on this account,
// and the API deliberately reports that as `state: "unknown"` with
// `first_data_date: null` rather than inventing a reason (see
// HealthMetricCapabilitySchema's doc comment). Deriving the reason ad hoc in
// each screen is how "no data yet" quietly becomes "unsupported" on one of
// them.
import type { HealthMetricCapability, HealthMetricTile } from "@personal-os/schema";

/**
 * What a metric tile is actually showing.
 *
 * Eight members rather than a boolean, because every one of them wants
 * different words and several want a different affordance: `sync_disabled` has
 * a toggle behind it, `needs_scope` needs a reconnect, and
 * `awaiting_first_data` needs nothing at all -- it is simply the truth.
 */
export type HealthMetricDisplayState =
  | "value" // a real recorded number, possibly a genuine zero
  | "recorded_none" // verified_absent: we fetched an authoritative window, nothing was there
  | "awaiting_first_data" // stream verified, but this account has never produced this metric
  | "not_checked" // no row, and no authoritative pass has covered this date
  | "sync_disabled" // the user turned this stream off
  | "needs_scope" // the OAuth grant does not cover this metric
  | "unsupported" // provider said so, with an evidenced reason
  | "provider_issue"; // the last probe errored ambiguously -- NOT a capability verdict

/**
 * Machine key for the explanatory sentence. Deliberately a separate union from
 * the display state rather than the same one: the state drives layout and
 * affordances, the key drives words, and they are not one-to-one -- `today has
 * not been synced yet` and `this past day was never checked` are the same
 * state with materially different sentences. Splitting a key later is a local
 * change; splitting a state is not.
 *
 * `null` for `state: "value"`: there is nothing to explain about a number we
 * actually have.
 */
export type HealthMetricExplanationKey =
  | "sync_disabled"
  | "needs_scope"
  | "unsupported"
  | "provider_issue"
  | "recorded_none"
  | "awaiting_first_data"
  | "not_checked"
  | "not_checked_today";

/**
 * The actual copy, in one place so it is reviewable and testable as copy
 * rather than scattered through JSX.
 *
 * Three product rules constrain every sentence here, and all three were
 * established by evidence rather than taste:
 *
 * 1. An empty or never-populated metric is NEVER described as unsupported or
 *    unavailable. On this account that is the state of twelve streams, and the
 *    reason is simply that nothing has sent the data to Google Health yet.
 * 2. Nothing claims knowledge of paired devices or of when a wearable last
 *    synced. That needs `googlehealth.settings.readonly`, a fourth scope this
 *    project deliberately never requested (ADR-046), so no copy may name a
 *    device or imply we can see one.
 * 3. No interpretation, no diagnosis, no risk framing, no advice. These state
 *    what happened to the data pipeline and stop.
 */
export const METRIC_EXPLANATIONS: Record<HealthMetricExplanationKey, string> = {
  sync_disabled: "Syncing is turned off for this metric.",
  needs_scope:
    "Personal OS wasn't granted permission to read this. Reconnect Google Health to include it.",
  unsupported: "Google Health reported that it can't provide this metric for this account.",
  provider_issue: "Google Health didn't answer for this metric on the last sync. It'll try again.",
  recorded_none: "Checked — nothing was recorded for this day.",
  awaiting_first_data:
    "No data has reached Google Health for this yet. An app or wearable has to send it to Google Health before Personal OS can read it.",
  not_checked: "This day hasn't been synced yet.",
  not_checked_today: "Today hasn't been synced yet. Numbers appear once Google Health has them.",
};

export interface ResolveMetricDisplayInput {
  tile: HealthMetricTile;
  capability: HealthMetricCapability;
  /** The requested timezone's local date, from HealthSummaryResponse.local_date. */
  todayLocalDate: string;
}

export interface MetricDisplay {
  state: HealthMetricDisplayState;
  /**
   * The exact numeric string the API returned, or null. Non-null exactly when
   * `state === "value"`, mirroring HealthMetricPointSchema's own refine -- so a
   * caller that renders `display.value` cannot accidentally print a placeholder
   * for a missing day.
   */
  value: string | null;
  localDate: string;
  explanation: HealthMetricExplanationKey | null;
}

/**
 * Frozen precedence. Do not reorder without re-reading every rule's reason:
 *
 *  1. sync_enabled === false      -- the user's own choice outweighs everything.
 *  2. missing_scope               -- no grant means no data will ever arrive.
 *  3. not_supported               -- evidenced provider verdict (see
 *                                    HealthCapabilityStatusSchema: an ambiguous
 *                                    400/403/404 is provider_error, never this).
 *  4. point.state === "value"     -- ABOVE provider_error on purpose. A stored
 *                                    number is a fact; the most recent probe
 *                                    erroring does not retract it, and blanking
 *                                    a real value behind an error banner throws
 *                                    away the only data we have.
 *  5. provider_error              -- we could not tell, and we say so.
 *  6. verified_absent             -- we checked; there was nothing.
 *  7. unknown + never any data    -- the honest twelve-stream case.
 *  8. unknown                     -- not checked (refined for today).
 *
 * Note rules 1-3 sit above rule 4 deliberately: a disabled, unscoped, or
 * genuinely unsupported stream's stale stored number is misleading in a way a
 * transient provider error's is not, because in those three cases the number
 * will never be refreshed.
 */
export function resolveMetricDisplay(input: ResolveMetricDisplayInput): MetricDisplay {
  const { tile, capability, todayLocalDate } = input;
  const localDate = tile.point.local_date;

  const missing = (
    state: HealthMetricDisplayState,
    explanation: HealthMetricExplanationKey,
  ): MetricDisplay => ({ state, value: null, localDate, explanation });

  if (!capability.sync_enabled) return missing("sync_disabled", "sync_disabled");
  if (capability.capability_status === "missing_scope")
    return missing("needs_scope", "needs_scope");
  if (capability.capability_status === "not_supported")
    return missing("unsupported", "unsupported");

  // A genuine recorded zero reaches here as state "value" with value "0" and
  // must fall through to the value branch, never to a missing one -- that
  // distinction is the entire reason for migration 0013's has_data CHECK
  // (ADR-047) and it has to survive all the way to the screen.
  if (tile.point.state === "value" && tile.point.value !== null) {
    return { state: "value", value: tile.point.value, localDate, explanation: null };
  }

  if (capability.capability_status === "provider_error") {
    return missing("provider_issue", "provider_issue");
  }

  if (tile.point.state === "verified_absent") return missing("recorded_none", "recorded_none");

  if (capability.first_data_date === null) {
    return missing("awaiting_first_data", "awaiting_first_data");
  }

  return missing("not_checked", localDate === todayLocalDate ? "not_checked_today" : "not_checked");
}

/**
 * True for every state that is NOT a real number.
 *
 * Exists so a renderer branches on one predicate instead of remembering the
 * full list: the failure mode this guards against is a tile that falls through
 * to a `{value ?? 0}` placeholder and silently reports a missing day as zero.
 */
export function isMetricMissing(state: HealthMetricDisplayState): boolean {
  return state !== "value";
}
