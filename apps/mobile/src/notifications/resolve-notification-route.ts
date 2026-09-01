// Pure, zero expo-router/expo-notifications import on purpose -- same
// reasoning as reconcile.ts: keeping the routing decision free of native
// modules means it is testable with plain vitest, and the hook in
// use-notification-lifecycle.ts stays a thin adapter over it.
//
// Four notification kinds carry a destination today:
//   - local reminders schedule with `data.taskId` (see scheduler.ts)
//   - capture confirmations dispatch with `data.inboxId` (see the worker's
//     capture-parse.ts, which publishes `data: { inboxId }`)
//   - monitoring alerts dispatch with `data.monitorIncidentId` (Checkpoint 7.5,
//     from both the worker's monitor/alerts.ts and the API's heartbeat watchdog)
//   - mail digests dispatch with `data.mailDigestDate` (Checkpoint 7.6)
//
// There is no inbox/[id] detail route, so a confirmation opens the Inbox
// tab rather than a per-item screen. Monitoring has no per-incident screen
// either, so an alert opens the monitoring screen, where the incident is listed
// and can be acknowledged. A digest opens Today, which is where the digest card
// lives -- there is no digest detail screen, and inventing a route the app does
// not have would send the tap nowhere.
//
// ORDER IS DELIBERATE AND IS A DECISION, not an accident of writing. taskId
// keeps priority because a payload carrying both is reminder-shaped. The two new
// keys are appended rather than inserted, so no existing payload changes
// destination -- an alert and a reminder never co-occur, but the rule that an
// existing notification keeps behaving exactly as it did is worth more than the
// tidiness of a "logical" ordering.
// Typed as a literal union rather than `string` so expo-router's typed
// routes accept it directly at the call site without a cast, while this
// module still imports nothing from expo-router.
export type NotificationRoute =
  | "/(tabs)/inbox"
  | "/(tabs)"
  | "/monitor"
  | `/tasks/${string}`;

export function resolveNotificationRoute(data: unknown): NotificationRoute | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;

  const taskId = record["taskId"];
  if (typeof taskId === "string" && taskId.length > 0) return `/tasks/${taskId}`;

  const inboxId = record["inboxId"];
  if (typeof inboxId === "string" && inboxId.length > 0) return "/(tabs)/inbox";

  // Monitoring alerts. Keyed on the INCIDENT id rather than the target id
  // because the incident is the thing that can be acknowledged, and a target
  // with no active incident has nothing to act on.
  const monitorIncidentId = record["monitorIncidentId"];
  if (typeof monitorIncidentId === "string" && monitorIncidentId.length > 0) return "/monitor";

  // Mail digests open Today, where the digest card is. There is no digest
  // detail screen.
  const mailDigestDate = record["mailDigestDate"];
  if (typeof mailDigestDate === "string" && mailDigestDate.length > 0) return "/(tabs)";

  return null;
}
