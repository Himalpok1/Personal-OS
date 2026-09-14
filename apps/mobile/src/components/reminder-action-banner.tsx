import { useEffect, useState } from "react";
import { Text } from "react-native";
import {
  reminderActionBannerText,
  type ReminderActionOutcome,
} from "@/components/reminder-action-banner-state";
import {
  consumeReminderActionOutcome,
  subscribeReminderActionOutcome,
} from "@/notifications/reminder-action-signal";

/**
 * Read-only consumer of Lane L4's reminder-action signal (Checkpoint 9.4).
 *
 * A Done / Snooze tap on a reminder notification is handled in
 * use-notification-lifecycle.ts, which then navigates to /tasks/<id> and
 * publishes the outcome through notifications/reminder-action-signal.ts. The
 * task detail screen mounts this banner so the owner sees what the tap did
 * -- the mutation happened before this screen existed, so nothing here can
 * observe it any other way. The subscription delivers a pending outcome
 * immediately, which covers the cold-start ordering (outcome published before
 * the screen mounted); consuming it afterwards is what stops the banner from
 * reappearing on the next visit to the same task.
 *
 * The component only READS: it never triggers a mutation, and a banner for a
 * different task's outcome is ignored rather than consumed, so the right
 * screen still gets it.
 */
export function ReminderActionBanner({ taskId }: { taskId: string }) {
  const [outcome, setOutcome] = useState<ReminderActionOutcome | null>(null);

  useEffect(() => {
    return subscribeReminderActionOutcome((published: ReminderActionOutcome) => {
      if (published.taskId !== taskId) return;
      setOutcome(published);
      consumeReminderActionOutcome(taskId);
    });
  }, [taskId]);

  if (outcome === null) return null;
  const failed = outcome.status === "failed";
  return (
    <Text
      testID="reminder-action-banner"
      accessibilityRole={failed ? "alert" : "text"}
      className={
        failed
          ? "mb-2 text-sm text-red-600"
          : "mb-2 text-sm text-green-700 dark:text-green-300"
      }
    >
      {reminderActionBannerText(outcome)}
    </Text>
  );
}
