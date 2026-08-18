import type { Device } from "@personal-os/schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ExactAlarmStatus from "../../modules/exact-alarm-status";
import * as Notifications from "expo-notifications";
import { useState } from "react";
import { Platform, Pressable, SafeAreaView, ScrollView, Switch, Text, View } from "react-native";
import { useDeviceIdentity } from "@/device-identity/provider";
import { REMINDERS_CHANNEL_ID, ensureNotificationPermission, ensureReminderChannel } from "@/notifications/channel";
import { registerForPushNotifications } from "@/notifications/push-token";
import { describeReminderEligibility } from "@/notifications/reminder-eligibility";
import { cancelOwnedReminders } from "@/notifications/scheduler";
import { flushOutbox, getOutboxStats } from "@/outbox/queue";
import { api } from "@/queries/client";
import {
  useDevices,
  useRevokeDevice,
  useSetPrimaryDevice,
  useUpdateDevice,
  useUpdateDevicePushToken,
} from "@/queries/devices";

function OutboxDiagnostics() {
  const queryClient = useQueryClient();
  const { data: stats } = useQuery({
    queryKey: ["outbox", "stats"],
    queryFn: getOutboxStats,
    refetchInterval: 5000,
  });
  const [flushResult, setFlushResult] = useState<string | null>(null);

  return (
    <View className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
      <Text className="mb-2 text-base font-bold text-black dark:text-white">Offline outbox</Text>
      <Text className="mb-2 text-sm text-black dark:text-white">
        Pending captures: {stats?.pending ?? "…"}
        {stats?.failed ? ` · Needs attention: ${stats.failed}` : ""}
      </Text>
      <Pressable
        onPress={async () => {
          const { flushed, remaining, failed } = await flushOutbox();
          setFlushResult(
            `Flushed ${flushed}, ${remaining} pending${failed ? `, ${failed} need attention` : ""}`,
          );
          void queryClient.invalidateQueries({ queryKey: ["outbox"] });
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
  const [remoteTestResult, setRemoteTestResult] = useState<string | null>(null);

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
              await updatePushToken.mutateAsync({
                id: identity.deviceId,
                body: { push_token: expoPushToken },
              });
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
          if (!identity) return;
          setRemoteTestResult("Queueing…");
          try {
            await api.sendTestNotification(identity.token, identity.deviceId);
            setRemoteTestResult("Queued for this device.");
          } catch (error) {
            setRemoteTestResult(
              `Failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }}
        className="mb-1 rounded bg-neutral-200 px-3 py-2 dark:bg-neutral-800"
      >
        <Text className="text-center text-sm text-black dark:text-white">
          Send remote test notification
        </Text>
      </Pressable>
      {remoteTestResult ? (
        <Text className="mb-2 text-xs text-neutral-500">{remoteTestResult}</Text>
      ) : null}

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

      <Pressable
        onPress={async () => {
          await ensureReminderChannel();
          const granted = await ensureNotificationPermission();
          if (!granted) {
            setTestScheduled("Permission not granted.");
            return;
          }
          await Notifications.scheduleNotificationAsync({
            content: {
              title: "Reboot survival test",
              body: "Delivered without reopening Personal OS",
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 120,
              channelId: REMINDERS_CHANNEL_ID,
            },
          });
          setTestScheduled(
            `Reboot test scheduled for ${new Date(Date.now() + 120_000).toLocaleTimeString()}`,
          );
        }}
        className="mt-1 rounded bg-neutral-200 px-3 py-2 dark:bg-neutral-800"
      >
        <Text className="text-center text-sm text-black dark:text-white">
          Schedule reboot test (2m)
        </Text>
      </Pressable>
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

function DeviceCard({
  device,
  isThisDevice,
  onThisDeviceRevoked,
}: {
  device: Device;
  isThisDevice: boolean;
  onThisDeviceRevoked: () => Promise<void>;
}) {
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
        onPress={() =>
          revokeDevice.mutate(device.id, {
            onSuccess: () => {
              if (isThisDevice) void onThisDeviceRevoked();
            },
          })
        }
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

// Local reminders are the MVP's core property, and every condition that
// stops them being scheduled is otherwise silent -- see
// reminder-eligibility.ts for the failure mode this surfaces.
function ReminderEligibilityBanner({ device }: { device: Device | undefined }) {
  const exactAlarmCapable =
    Platform.OS !== "android" || ExactAlarmStatus.canScheduleExactAlarms();
  const { kind, title, warning } = describeReminderEligibility(device, exactAlarmCapable);
  if (warning === null) return null;

  return (
    <View className="mb-4 rounded border border-amber-500 bg-amber-50 p-3 dark:bg-amber-950">
      <Text className="mb-1 text-sm font-bold text-amber-900 dark:text-amber-200">{title}</Text>
      <Text className="text-xs text-amber-900 dark:text-amber-200">{warning}</Text>
      {kind === "degraded" ? (
        <Pressable
          onPress={() => ExactAlarmStatus.openExactAlarmSettings()}
          className="mt-2 rounded bg-amber-200 px-3 py-2 dark:bg-amber-900"
        >
          <Text className="text-center text-sm text-amber-900 dark:text-amber-100">
            Open exact-alarm settings
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function SettingsScreen() {
  const { identity, clearIdentity } = useDeviceIdentity();
  const { data, isLoading, isError } = useDevices();
  const thisDevice = data?.items.find((device) => device.id === identity?.deviceId);

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <ScrollView className="flex-1 px-4 py-4">
        <Text className="mb-4 text-xl font-bold text-black dark:text-white">Devices</Text>

        <ReminderEligibilityBanner device={thisDevice} />
        <NotificationDiagnostics />
        <OutboxDiagnostics />

        {isLoading ? <Text className="text-neutral-500">Loading…</Text> : null}
        {isError ? <Text className="text-red-600">Couldn&apos;t load devices.</Text> : null}

        {data?.items.map((device) => (
          <DeviceCard
            key={device.id}
            device={device}
            isThisDevice={device.id === identity?.deviceId}
            onThisDeviceRevoked={async () => {
              await cancelOwnedReminders();
              await clearIdentity();
            }}
          />
        ))}

        <Pressable
          onPress={async () => {
            await cancelOwnedReminders();
            await clearIdentity();
          }}
          className="mt-4 rounded bg-neutral-200 px-3 py-3 dark:bg-neutral-800"
        >
          <Text className="text-center text-black dark:text-white">Forget this device</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
