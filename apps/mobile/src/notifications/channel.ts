import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const REMINDERS_CHANNEL_ID = "reminders";
// Checkpoint 9.1 (ADR-062 follow-up): actionable, user-facing integration/
// monitor alerts (calendar/mail reauth, health sync breakage, monitor
// incidents, occurrence dead-letters) get their own channel rather than
// sharing "reminders" -- see notifications-dispatch.ts for the category ->
// channel mapping this must stay in lockstep with.
export const ALERTS_CHANNEL_ID = "alerts";
// Routine/informational pushes: capture confirmations and the daily mail
// digest. Neither is time-critical the way an alert is, so DEFAULT
// importance (no heads-up) is deliberate, not an oversight.
export const UPDATES_CHANNEL_ID = "updates";
// The persistent "tap to capture" shade affordance (Checkpoint 9.1, Part A).
// This is a LOCAL, ongoing notification managed entirely on-device -- it is
// never sent through notifications-dispatch.ts/notification_dispatch_log,
// so it gets its own channel rather than folding into "updates": muting
// digests/confirmations must not also hide the capture shortcut. LOW
// importance is deliberate -- it should sit quietly in the shade, not
// interrupt with a heads-up banner or sound.
export const CAPTURE_CHANNEL_ID = "capture";

// Must be created before any permission request or push-token call --
// Android 13+ ties the system permission prompt to channel existence, and
// expo-notifications' own docs require setNotificationChannelAsync to run
// before getDevicePushTokenAsync/getExpoPushTokenAsync.
export async function ensureReminderChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(REMINDERS_CHANNEL_ID, {
    name: "Reminders",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
  });
}

export async function ensureAlertsChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ALERTS_CHANNEL_ID, {
    name: "Alerts",
    description: "Integration and monitoring alerts that need your attention.",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
}

export async function ensureUpdatesChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(UPDATES_CHANNEL_ID, {
    name: "Updates",
    description: "Capture confirmations and the daily mail digest.",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function ensureCaptureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CAPTURE_CHANNEL_ID, {
    name: "Quick capture",
    description: "A persistent shortcut to capture a note, task, or reminder.",
    importance: Notifications.AndroidImportance.LOW,
  });
}

// Creates every channel this app uses. Idempotent -- Android no-ops a
// repeat call with the same id and settings, so this is safe to call from
// every cold launch and every one of the pre-existing call sites that used
// to call ensureReminderChannel() alone.
export async function ensureNotificationChannels(): Promise<void> {
  await ensureReminderChannel();
  await ensureAlertsChannel();
  await ensureUpdatesChannel();
  await ensureCaptureChannel();
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}
