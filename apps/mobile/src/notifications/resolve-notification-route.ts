// Pure, zero expo-router/expo-notifications import on purpose -- same
// reasoning as reconcile.ts: keeping the routing decision free of native
// modules means it is testable with plain vitest, and the hook in
// use-notification-lifecycle.ts stays a thin adapter over it.
//
// Two notification categories carry a destination today:
//   - local reminders schedule with `data.taskId` (see scheduler.ts)
//   - capture confirmations dispatch with `data.inboxId` (see the worker's
//     capture-parse.ts, which publishes `data: { inboxId }`)
//
// There is no inbox/[id] detail route, so a confirmation opens the Inbox
// tab rather than a per-item screen. taskId keeps priority: a payload
// carrying both is reminder-shaped.
// Typed as a literal union rather than `string` so expo-router's typed
// routes accept it directly at the call site without a cast, while this
// module still imports nothing from expo-router.
export type NotificationRoute = "/(tabs)/inbox" | `/tasks/${string}`;

export function resolveNotificationRoute(data: unknown): NotificationRoute | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;

  const taskId = record["taskId"];
  if (typeof taskId === "string" && taskId.length > 0) return `/tasks/${taskId}`;

  const inboxId = record["inboxId"];
  if (typeof inboxId === "string" && inboxId.length > 0) return "/(tabs)/inbox";

  return null;
}
