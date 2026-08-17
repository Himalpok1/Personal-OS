import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const REMINDERS_CHANNEL_ID = "reminders";

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

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}
