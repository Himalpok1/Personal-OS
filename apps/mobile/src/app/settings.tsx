import type { Device } from "@personal-os/schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ExactAlarmStatus from "../../modules/exact-alarm-status";
import * as Notifications from "expo-notifications";
import { useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Switch, Text, View } from "react-native";
import { useDeviceIdentity } from "@/device-identity/provider";
import { REMINDERS_CHANNEL_ID, ensureNotificationPermission, ensureReminderChannel } from "@/notifications/channel";
import { registerForPushNotifications } from "@/notifications/push-token";
import { flushOutbox, getOutboxCount } from "@/outbox/queue";
import {
  useDevices,
  useRevokeDevice,
  useSetPrimaryDevice,
  useUpdateDevice,
  useUpdateDevicePushToken,
} from "@/queries/devices";

function OutboxDiagnostics() {
  const queryClient = useQueryClient();
  const { data: count } = useQuery({
    queryKey: ["outbox", "count"],
    queryFn: getOutboxCount,
    refetchInterval: 5000,
  });
  const [flushResult, setFlushResult] = useState<string | null>(null);

  return (
    <View className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
      <Text className="mb-2 text-base font-bold text-black dark:text-white">Offline outbox</Text>
      <Text className="mb-2 text-sm text-black dark:text-white">
        Pending captures: {count ?? "…"}
      </Text>
      <Pressable
        onPress={async () => {
          const { flushed, remaining } = await flushOutbox();
          setFlushResult(`Flushed ${flushed}, ${remaining} remaining`);
          void queryClient.invalidateQueries({ queryKey: ["outbox", "count"] });
          void queryClient.invalidateQueries({ queryKey: ["inbox"] });
        }}
        className="rounded bg-neutral-200 px-3 py-2 dark:bg-neutral-800"
      >
        <Text className="text-center text-sm text-black dark:text-white">Flush now</Text>
      </Pressable>
      {flushResult ? <Text className="mt-1 text-xs text-neutral-500">{flushResult}</Text> : null}
    </View>
  );
}

// Manual verification tools for the Checkpoint 4 real-device spikes
// (exact-alarm permission, push-token registration/CipherOS FCM support,
// notification lifecycle behavior) -- see docs/STATUS.md's Checkpoint 4
// entry for the recorded results of running these on the physical R1.
function NotificationDiagnostics() {
  const { identity } = useDeviceIdentity();
  const updatePushToken = useUpdateDevicePushToken();
  const [exactAlarmOk, setExactAlarmOk] = useState<boolean | null>(null);
  const [pushResult, setPushResult] = useState<string | null>(null);
  const [testScheduled, setTestScheduled] = useState<string | null>(null);

  return (
    <View className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
      <Text className="mb-2 text-base font-bold text-black dark:text-white">
        Notification diagnostics
      </Text>

      <Pressable
        onPress={() => setExactAlarmOk(ExactAlarmStatus.canScheduleExactAlarms())}
        className="mb-1 rounded bg-neutral-200 px-3 py-2 dark:bg-neutral-800"
      >
        <Text className="text-center text-sm text-black dark:text-white">
          Check exact-alarm permission
          {exactAlarmOk === null ? "" : exactAlarmOk ? ": granted" : ": NOT granted"}
        </Text>
      </Pressable>
      {exactAlarmOk === false ? (
        <Pressable
          onPress={() => ExactAlarmStatus.openExactAlarmSettings()}
          className="mb-2 rounded bg-blue-100 px-3 py-2 dark:bg-blue-950"
        >
          <Text className="text-center text-sm text-blue-700 dark:text-blue-300">
            Open exact-alarm settings
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={async () => {
          setPushResult("Registering…");
          try {
            const expoPushToken = await registerForPushNotifications();
            if (identity) {
              updatePushToken.mutate({ id: identity.deviceId, body: { push_token: expoPushToken } });
            }
            setPushResult(`Got token: ${expoPushToken.slice(0, 24)}...`);
          } catch (err) {
            setPushResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }}
        className="mb-1 rounded bg-neutral-200 px-3 py-2 dark:bg-neutral-800"
      >
        <Text className="text-center text-sm text-black dark:text-white">
          Register for push notifications
        </Text>
      </Pressable>
      {pushResult ? <Text className="mb-2 text-xs text-neutral-500">{pushResult}</Text> : null}

      <Pressable
        onPress={async () => {
          await ensureReminderChannel();
          const granted = await ensureNotificationPermission();
          if (!granted) {
            setTestScheduled("Permission not granted.");
            return;
          }
          await Notifications.scheduleNotificationAsync({
            content: { title: "Test reminder", body: "Checkpoint 4 manual verification" },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 10,
              channelId: REMINDERS_CHANNEL_ID,
            },
          });
          setTestScheduled(`Scheduled for ${new Date(Date.now() + 10_000).toLocaleTimeString()}`);
        }}
        className="rounded bg-neutral-200 px-3 py-2 dark:bg-neutral-800"
      >
        <Text className="text-center text-sm text-black dark:text-white">
          Schedule test reminder (10s)
        </Text>
      </Pressable>
      {testScheduled ? <Text className="mt-1 text-xs text-neutral-500">{testScheduled}</Text> : null}
    </View>
  );
}

function NotifyToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <Text className="text-black dark:text-white">{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

function DeviceCard({ device, isThisDevice }: { device: Device; isThisDevice: boolean }) {
  const setPrimary = useSetPrimaryDevice();
  const updateDevice = useUpdateDevice();
  const revokeDevice = useRevokeDevice();

  return (
    <View className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-bold text-black dark:text-white">
          {device.name} {isThisDevice ? "(this device)" : ""}
        </Text>
        {device.is_primary_reminder_device ? (
          <Text className="text-xs font-bold text-blue-600">PRIMARY</Text>
        ) : null}
      </View>
      <Text className="mb-2 text-xs text-neutral-500">{device.platform}</Text>

      {!device.is_primary_reminder_device ? (
        <Pressable
          onPress={() => setPrimary.mutate(device.id)}
          disabled={setPrimary.isPending}
          className="mb-2 rounded bg-blue-100 px-3 py-2 dark:bg-blue-950"
        >
          <Text className="text-center text-sm text-blue-700 dark:text-blue-300">
            {setPrimary.isPending ? "Setting…" : "Set as primary reminder device"}
          </Text>
        </Pressable>
      ) : null}

      <NotifyToggle
        label="Confirmations"
        value={device.notify_confirmations}
        onChange={(next) =>
          updateDevice.mutate({ id: device.id, body: { notify_confirmations: next } })
        }
      />
      <NotifyToggle
        label="Alerts"
        value={device.notify_alerts}
        onChange={(next) => updateDevice.mutate({ id: device.id, body: { notify_alerts: next } })}
      />
      <NotifyToggle
        label="Digests"
        value={device.notify_digests}
        onChange={(next) => updateDevice.mutate({ id: device.id, body: { notify_digests: next } })}
      />

      <Pressable
        onPress={() => revokeDevice.mutate(device.id)}
        disabled={revokeDevice.isPending || Boolean(device.revoked_at)}
        className="mt-2 rounded bg-red-100 px-3 py-2 dark:bg-red-950"
      >
        <Text className="text-center text-sm text-red-700 dark:text-red-300">
          {device.revoked_at ? "Revoked" : revokeDevice.isPending ? "Revoking…" : "Revoke"}
        </Text>
      </Pressable>
    </View>
  );
}

export default function SettingsScreen() {
  const { identity, clearIdentity } = useDeviceIdentity();
  const { data, isLoading, isError } = useDevices();

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <ScrollView className="flex-1 px-4 py-4">
        <Text className="mb-4 text-xl font-bold text-black dark:text-white">Devices</Text>

        <NotificationDiagnostics />
        <OutboxDiagnostics />

        {isLoading ? <Text className="text-neutral-500">Loading…</Text> : null}
        {isError ? <Text className="text-red-600">Couldn&apos;t load devices.</Text> : null}

        {data?.items.map((device) => (
          <DeviceCard key={device.id} device={device} isThisDevice={device.id === identity?.deviceId} />
        ))}

        <Pressable onPress={() => clearIdentity()} className="mt-4 rounded bg-neutral-200 px-3 py-3 dark:bg-neutral-800">
          <Text className="text-center text-black dark:text-white">Forget this device</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
