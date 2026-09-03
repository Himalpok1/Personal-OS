import { Platform, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import ExactAlarmStatus from "../../modules/exact-alarm-status";
import { useDeviceIdentity } from "@/device-identity/provider";
import { useDevices } from "@/queries/devices";
import { todayReminderNotice } from "@/notifications/today-reminder-notice";

/**
 * Compact Today banner: can reminders actually fire on this device?
 *
 * Renders NOTHING when they can, which is the common case. See
 * notifications/today-reminder-notice.ts for why this is on Today at all and
 * why it never fixes anything itself.
 */
export function ReminderNoticeCard() {
  const router = useRouter();
  const { identity } = useDeviceIdentity();
  const { data } = useDevices();
  const thisDevice = data?.items.find((device) => device.id === identity?.deviceId);

  // Guarded exactly as settings.tsx's banner does: ExactAlarmStatus is an
  // Android concept, and its web module answers `true` for everyone else.
  const exactAlarmCapable =
    Platform.OS !== "android" || ExactAlarmStatus.canScheduleExactAlarms();
  const notice = todayReminderNotice(thisDevice, exactAlarmCapable);
  if (!notice) return null;

  return (
    <View className="mb-4 rounded border border-amber-500 bg-amber-50 p-3 dark:bg-amber-950">
      <Text className="mb-1 text-sm font-bold text-amber-900 dark:text-amber-200">
        {notice.title}
      </Text>
      <Text className="text-xs text-amber-900 dark:text-amber-200">{notice.body}</Text>
      <Pressable
        onPress={() =>
          notice.action === "exact-alarm"
            ? ExactAlarmStatus.openExactAlarmSettings()
            : router.navigate("/settings")
        }
        accessibilityRole="button"
        accessibilityLabel={
          notice.action === "exact-alarm" ? "Open exact-alarm settings" : "Open Settings"
        }
        className="mt-2 min-h-[44px] justify-center rounded bg-amber-200 px-3 py-2 dark:bg-amber-900"
      >
        <Text className="text-center text-sm text-amber-900 dark:text-amber-100">
          {notice.action === "exact-alarm" ? "Open exact-alarm settings" : "Open Settings"}
        </Text>
      </Pressable>
    </View>
  );
}
