import { Alert, Platform } from "react-native";
import ExactAlarmStatus from "../../modules/exact-alarm-status";

// Deliberately NOT in channel.ts: scheduler.ts imports channel.ts for the
// reminder channel id, and pulling a requireNativeModule() import into that
// graph drags the Expo runtime into scheduler.test.ts, which then fails with
// "__DEV__ is not defined". Keeping the native module in its own leaf file
// preserves the plain-vitest testability the rest of this directory relies on.
// Android 14+ (this app targets SDK 36) does not auto-grant
// SCHEDULE_EXACT_ALARM, and unlike POST_NOTIFICATIONS there is no in-app
// dialog for it -- the only route is a deep link into system settings.
// ARCHITECTURE.md's gotcha #6 calls for requesting both during onboarding;
// this is the exact-alarm half. Without it Android schedules reminders with
// a one-hour delivery window (verified in Checkpoint 5 via `dumpsys alarm`).
//
// Prompted at most once per app run: reconciliation re-runs on every
// foreground and on a 60s poll, and a settings deep link on each pass would
// be unusable.
let promptedForExactAlarmThisSession = false;

export function resetExactAlarmPromptForTests(): void {
  promptedForExactAlarmThisSession = false;
}

export function ensureExactAlarmPermission(): boolean {
  if (Platform.OS !== "android") return true;
  if (ExactAlarmStatus.canScheduleExactAlarms()) {
    // Re-arm, so a later revocation prompts again on the next pass.
    promptedForExactAlarmThisSession = false;
    return true;
  }
  if (promptedForExactAlarmThisSession) return false;
  promptedForExactAlarmThisSession = true;

  Alert.alert(
    "Allow exact alarms",
    "Personal OS needs the “Alarms & reminders” permission to deliver reminders at the exact time. Without it Android may deliver them up to an hour late.",
    [
      { text: "Not now", style: "cancel" },
      { text: "Open settings", onPress: () => ExactAlarmStatus.openExactAlarmSettings() },
    ],
  );
  return false;
}
