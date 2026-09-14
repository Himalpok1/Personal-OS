import type { ReminderActionIdentifier } from "./reminder-actions";

/**
 * The wire between "a reminder notification action ran" (in
 * use-notification-lifecycle.ts, which owns every NotificationResponse) and
 * "show the owner what happened" (the task detail screen, which renders
 * this as a banner) -- Checkpoint 9.4. Same shape and same reasoning as
 * capture-shortcut-signal.ts: the two sides are mounted in different
 * components with no shared parent, and the outcome of a COLD-START action
 * (the app was launched by the button) is known before the task screen has
 * mounted even once, so the consumer must be able to PULL a pending outcome
 * on mount rather than rely on having been subscribed when it was published.
 *
 * Exactly one outcome can be pending at a time (the most recent wins): the
 * lifecycle navigates to the task the outcome is for immediately after
 * publishing it, so a second action before the first is consumed is a
 * second navigation to a second task, and the first banner would land on a
 * screen the owner has already left.
 *
 * Nothing here carries task text. `label` is the snooze TARGET formatted in
 * the device's locale and zone (reminder-actions.ts's
 * `formatSnoozeTargetLabel`, e.g. "10:05 AM" or "Tue 9:00 AM"), and the
 * empty string for a completion or a failure -- the consumer composes the
 * sentence ("Snoozed until 10:05 AM from reminder").
 *
 * CONSUMER CONTRACT (the task detail screen):
 *   - On mount, `consumeReminderActionOutcome(taskId)` returns and CLEARS
 *     the pending outcome if it is for this task (else null, untouched).
 *   - `subscribeReminderActionOutcome(listener)` covers an action that runs
 *     while the screen is already mounted (the owner was on the task when
 *     the reminder fired and tapped a button); it also delivers a pending
 *     outcome immediately on subscribe, WITHOUT clearing it -- the listener
 *     decides whether it is for its task and calls `consume` to clear.
 */
/**
 * Why a reminder action failed, in the vocabulary the banner needs and
 * nothing finer. `not_open` (the server answered 409: the occurrence or task
 * has already been completed, skipped, dropped or otherwise moved on) and
 * `not_found` (404) both mean there is nothing left in the shade to act on;
 * `network` is a fetch that never reached the API (no ApiClientError at all)
 * and is the one case a retry from the same button can fix; `unknown` is
 * any other API answer.
 */
export type ReminderActionFailureReason = "not_open" | "not_found" | "network" | "unknown";

export type ReminderActionOutcome =
  | {
      taskId: string;
      action: ReminderActionIdentifier;
      status: "done";
      /** Formatted snooze target for a successful snooze; "" for a completion. */
      label: string;
    }
  | {
      taskId: string;
      action: ReminderActionIdentifier;
      status: "failed";
      label: "";
      reason: ReminderActionFailureReason;
    };

type Listener = (outcome: ReminderActionOutcome) => void;

const listeners = new Set<Listener>();
let pendingOutcome: ReminderActionOutcome | null = null;

export function publishReminderActionOutcome(outcome: ReminderActionOutcome): void {
  pendingOutcome = outcome;
  for (const listener of listeners) listener(outcome);
}

/** Returns an unsubscribe function. See the consumer contract above. */
export function subscribeReminderActionOutcome(listener: Listener): () => void {
  listeners.add(listener);
  if (pendingOutcome !== null) listener(pendingOutcome);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Pull-and-clear for the given task. A pending outcome for a DIFFERENT
 * task is left in place: the screen it belongs to has not consumed it yet.
 */
export function consumeReminderActionOutcome(taskId: string): ReminderActionOutcome | null {
  if (pendingOutcome === null || pendingOutcome.taskId !== taskId) return null;
  const outcome = pendingOutcome;
  pendingOutcome = null;
  return outcome;
}

/** Test seam only. */
export function resetReminderActionSignalForTest(): void {
  listeners.clear();
  pendingOutcome = null;
}
