import type { MonitorTargetStatus } from "@personal-os/schema";

// Pure, React-free derivation of what a monitored target's row says.
//
// ===========================================================================
// THE HARD RULE: DO NOT CLAIM MORE THAN THE BACKEND PROVES.
// ===========================================================================
//
// Every state below maps to a fact that exists in a row. There is deliberately
// no "healthy", no "all systems operational", and no aggregate verdict, because
// the backend does not prove any of those. What it proves is: a target is
// configured, a check happened at a time with an outcome, and an incident is or
// is not open.
//
// The three-state discipline `MonitorUptimePointSchema` enforces for a window
// applies here to a target: NEVER CHECKED is not DOWN. A target seeded a minute
// ago, or one disabled since creation, has no check at all -- and since no
// target has ever been seeded in any environment this project can reach, that is
// the state every reader hits first.

export type MonitorTargetDisplayState =
  | "not_checked" // configured, but no check has ever run
  | "disabled" // switched off; nothing is being checked and that is intended
  | "muted" // silenced by an operator -- and NOT probed while muted
  | "skipped" // the last check was a deliberate skip (maintenance window, or a mute that has since expired)
  | "down" // the newest check failed
  | "incident_open" // failing long enough to have opened an incident
  | "incident_acknowledged" // an open incident somebody has seen
  | "up"; // the newest check succeeded

export interface MonitorTargetRowView {
  state: MonitorTargetDisplayState;
  /** The incident id, when there is an active one and the row can act on it. */
  incidentId: string | null;
}

/**
 * Frozen precedence, most-blocking first:
 *
 *   disabled -> incident_acknowledged -> incident_open -> muted -> skipped
 *   -> down -> not_checked -> up
 *
 * AN OPEN INCIDENT OUTRANKS MUTING AND MAINTENANCE, and that ordering is the
 * correction of a real defect rather than a preference. Muting pauses ALERTS; it
 * does not resolve anything, and neither does a maintenance window --
 * `recentDecisiveStatuses` excludes `skipped` rows precisely so a window cannot
 * close an incident. So a suppressed target with an open incident still HAS an
 * unresolved outage, and putting the suppression first rendered that outage in
 * neutral copy on a screen the user deliberately opened to look for it. The
 * first version of this file did exactly that.
 *
 * `disabled` is the one suppression that still outranks an incident, because a
 * disabled target is not being checked and never will be until someone turns it
 * back on: its incident cannot progress in either direction, and the operator
 * switched it off deliberately.
 *
 * `incident_acknowledged` outranks `incident_open` because the acknowledgement
 * is the newer fact and the more useful one -- "someone is on this" is what a
 * second person opening the screen needs to know.
 *
 * An incident outranks a bare `down` because it carries an id, which is what
 * makes the row actionable.
 *
 * `not_checked` sits ABOVE `up` rather than below it: a target with no check has
 * not passed anything, and defaulting to `up` would manufacture a clean bill of
 * health out of an absence of evidence.
 */
export function resolveMonitorTargetState(
  status: MonitorTargetStatus,
  /**
   * INJECTED, never read from `Date.now()` inside.
   *
   * A mute expires at an instant, so this function is time-dependent -- and a
   * pure module that reads the clock itself is not deterministic and cannot be
   * tested for the boundary that matters. `describeLastCheck` below takes `now`
   * for the same reason, and so does every dated helper in packages/core.
   */
  now: number,
): MonitorTargetRowView {
  const { target, latest_check, active_incident } = status;

  if (!target.enabled) return { state: "disabled", incidentId: null };

  if (active_incident !== null) {
    return {
      state: active_incident.status === "acknowledged" ? "incident_acknowledged" : "incident_open",
      incidentId: active_incident.id,
    };
  }

  if (target.muted_until !== null && Date.parse(target.muted_until) > now) {
    return { state: "muted", incidentId: null };
  }
  // `skipped`, NOT "in a maintenance window". The check row records only that we
  // deliberately did not look; whether a window is open RIGHT NOW is a different
  // question this row cannot answer, and the row may also be a leftover from a
  // mute that has since expired. `skippedReasonText` below says which reason the
  // row actually carries, in the past tense the evidence supports.
  if (latest_check?.status === "skipped") {
    return { state: "skipped", incidentId: null };
  }
  if (latest_check === null) return { state: "not_checked", incidentId: null };
  if (latest_check.status === "down") return { state: "down", incidentId: null };
  return { state: "up", incidentId: null };
}

/**
 * The words for each state.
 *
 * THE HEARTBEAT WORDING IS DELIBERATE AND IS NOT INTERCHANGEABLE.
 *
 * A `worker_heartbeat` target says "heartbeat received", never "worker healthy".
 * The heartbeat proves one thing: a process wrote a row on its beat cron. It
 * does NOT prove the worker is completing jobs -- ADR-055 records the residual
 * blind spot in as many words, that a worker which is hung or crash-looping fast
 * enough to keep beating looks alive to this watchdog. "Worker healthy" would
 * assert exactly the thing the evidence does not support.
 */
export function monitorStateText(
  state: MonitorTargetDisplayState,
  kind: MonitorTargetStatus["target"]["kind"],
): string {
  const heartbeat = kind === "worker_heartbeat";
  switch (state) {
    case "disabled":
      return "Checks are turned off for this target.";
    case "muted":
      // NOT "checks are still running". A muted target is not probed at all:
      // `suppressionReason` returns "muted", the pass writes a `skipped` row and
      // returns before issuing any request. The first version of this sentence
      // said checks continued, which would have told an operator that a service
      // was being watched through a mute window when nothing was looking at it.
      return "Muted, so it isn't being checked and alerts are paused.";
    case "skipped":
      return "The last check was skipped deliberately.";
    case "incident_acknowledged":
      return heartbeat
        ? "No heartbeat received. Someone has acknowledged this."
        : "Not responding. Someone has acknowledged this.";
    case "incident_open":
      return heartbeat ? "No heartbeat received." : "Not responding.";
    case "down":
      return heartbeat ? "The last heartbeat was too old." : "The last check failed.";
    case "not_checked":
      // Not "up", and not "down". Saying either would invent a result.
      return heartbeat ? "No heartbeat has been received yet." : "No check has run yet.";
    case "up":
      // NEVER "worker healthy" -- see the note above.
      return heartbeat ? "Heartbeat received." : "Responding normally.";
  }
}

/**
 * Why the last check was skipped, from the row's own `failure_class`.
 *
 * Past tense on purpose. The row records that a check WAS skipped and why; it
 * cannot say whether a maintenance window is open right now, and it may be a
 * leftover from a mute that has since expired -- the next real check is only due
 * after `interval_seconds`, so a stale skip can be the newest row for minutes.
 * Returning null rather than a guess keeps the caller from inventing a
 * present-tense claim.
 */
export function skippedReasonText(status: MonitorTargetStatus): string | null {
  if (status.latest_check?.status !== "skipped") return null;
  switch (status.latest_check.failure_class) {
    case "maintenance_window":
      return "It was inside a maintenance window.";
    case "muted":
      return "It was muted at the time.";
    default:
      return null;
  }
}

/**
 * The chip tone a state wears on the design system (Checkpoint 10.3): an open
 * incident is danger, a bare failure or an acknowledged incident warning, a
 * passing check success, and every suppressed or unknown state neutral --
 * `not_checked` is deliberately NOT success, for the reason the file header
 * gives.
 */
export function monitorStateTone(
  state: MonitorTargetDisplayState,
): "neutral" | "success" | "warning" | "danger" {
  switch (state) {
    case "incident_open":
      return "danger";
    case "incident_acknowledged":
    case "down":
      return "warning";
    case "up":
      return "success";
    case "disabled":
    case "muted":
    case "skipped":
    case "not_checked":
      return "neutral";
  }
}

/**
 * "Checked 2 minutes ago", or null when nothing has been checked.
 *
 * Returns null rather than a placeholder so a caller cannot accidentally render
 * "Checked never ago". The absence is the caller's to phrase.
 */
export function describeLastCheck(status: MonitorTargetStatus, now: number): string | null {
  if (status.latest_check === null) return null;
  const elapsedSeconds = Math.max(
    0,
    Math.round((now - Date.parse(status.latest_check.checked_at)) / 1000),
  );
  if (elapsedSeconds < 60) return "Checked just now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `Checked ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Checked ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `Checked ${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * A one-line summary of the whole overview.
 *
 * `configured: false` gets its own sentence rather than "0 targets down",
 * because a deployment that has never been given targets is not being monitored
 * and must not read as a clean bill of health.
 */
export function describeMonitorSummary(configured: boolean, activeIncidents: number): string {
  if (!configured) return "No services are being monitored yet.";
  if (activeIncidents === 0) return "No open incidents.";
  return `${activeIncidents} open incident${activeIncidents === 1 ? "" : "s"}.`;
}
