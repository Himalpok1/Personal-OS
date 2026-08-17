import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { ensureNotificationPermission, ensureReminderChannel } from "./channel";

// Remote push (Expo Push) is for capture confirmations / alerts / digests
// only, per docs/ARCHITECTURE.md's routing table -- NOT scheduled reminders
// (those are always local, see reconcile.ts/scheduler.ts). Any device can
// register for this, not just the primary reminder device.
//
// getExpoPushTokenAsync ultimately depends on Google Play Services (FCM) on
// Android. The Rabbit R1 runs CipherOS, a community AOSP ROM with
// unconfirmed GMS support -- this call is the actual empirical test of
// that, not an assumption. See docs/STATUS.md's Checkpoint 4 entry for the
// real result on the physical device.
export async function registerForPushNotifications(): Promise<string> {
  await ensureReminderChannel();
  const granted = await ensureNotificationPermission();
  if (!granted) {
    throw new Error("Notification permission was not granted.");
  }

  const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== "string") {
    throw new Error("No EAS projectId configured in app.json's extra.eas.");
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}
