import { Platform, View } from "react-native";
import { useRouter } from "expo-router";
import ExactAlarmStatus from "../../modules/exact-alarm-status";
import { useDeviceIdentity } from "@/device-identity/provider";
import { useDevices } from "@/queries/devices";
import { todayReminderNotice } from "@/notifications/today-reminder-notice";
import { AppText, Button, Card, Icon } from "@/components/ui";

/**
 * Compact Today banner: can reminders actually fire on this device?
 *
 * Renders NOTHING when they can, which is the common case. See
 * notifications/today-reminder-notice.ts for why this is on Today at all and
 * why it never fixes anything itself.
 *
 * Checkpoint 10.3: composed from the design system (Card, Icon, AppText,
 * Button). The warning reading comes from the tones; the notice text, the
 * two actions and their labels are unchanged.
 */
export function ReminderNoticeCard() {
  const router = useRouter();
  const { identity } = useDeviceIdentity();
  const { data } = useDevices();
  const thisDevice = data?.items.find((device) => device.id === identity?.deviceId);

  // Guarded exactly as settings.tsx's banner does: ExactAlarmStatus is an
  // Android concept, and its web module answers `true` for everyone else.
  const exactAlarmCapable = Platform.OS !== "android" || ExactAlarmStatus.canScheduleExactAlarms();
  const notice = todayReminderNotice(thisDevice, exactAlarmCapable);
  if (!notice) return null;

  const actionLabel =
    notice.action === "exact-alarm" ? "Open exact-alarm settings" : "Open Settings";

  return (
    <Card className="mb-3" elevation="raised" accessibilityRole="alert">
      <View className="flex-row items-start gap-3">
        <Icon name="alarm-off" size="lg" tone="warning" />
        <View className="flex-1">
          <AppText variant="title" tone="warning">
            {notice.title}
          </AppText>
          <AppText variant="body" tone="secondary" className="mt-1">
            {notice.body}
          </AppText>
        </View>
      </View>
      <Button
        label={actionLabel}
        accessibilityLabel={actionLabel}
        onPress={() =>
          notice.action === "exact-alarm"
            ? ExactAlarmStatus.openExactAlarmSettings()
            : router.navigate("/settings")
        }
        variant="tonal"
        size="sm"
        className="mt-3"
      />
    </Card>
  );
}
