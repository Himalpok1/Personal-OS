import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { useBusyPress } from "@/components/use-busy-press";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { calendarSyncErrorCopy } from "@/components/calendar/sync-error-copy";
import { usePlaceholderColor } from "@/components/placeholder-color";
import {
  describeFreshness,
  resolveHealthConnectionState,
  type FreshnessDescription,
  type HealthConnectionDisplayState,
} from "@/components/health/connection-state";
import { ApiClientError } from "@personal-os/api-client";
import type { CalendarConnection, Device } from "@personal-os/schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import ExactAlarmStatus from "../../modules/exact-alarm-status";
import GoogleCalendarAuth from "../../modules/google-calendar-auth";
import * as Notifications from "expo-notifications";
import { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { mergeAvailableCalendars } from "@/calendar-connections/merge-available-calendars";
import { useDeviceIdentity } from "@/device-identity/provider";
import { REMINDERS_CHANNEL_ID, ensureNotificationPermission, ensureReminderChannel } from "@/notifications/channel";
import { registerForPushNotifications } from "@/notifications/push-token";
import { describeReminderEligibility } from "@/notifications/reminder-eligibility";
import { cancelOwnedReminders } from "@/notifications/scheduler";
import { flushOutbox, getOutboxStats } from "@/outbox/queue";
import {
  useAvailableCalendars,
  useAvailableGoogleCalendars,
  useCalendarConnections,
  useConnectCaldavCalendar,
  useConnectGoogleCalendar,
  useDisconnectCalendarConnection,
  usePersistedCalendarConnectionCalendars,
  useSyncCalendarConnectionNow,
  useUpdateCalendarConnectionCalendars,
} from "@/queries/calendar-connections";
import { api } from "@/queries/client";
import {
  useDevices,
  useRevokeDevice,
  useSetPrimaryDevice,
  useUpdateDevice,
  useUpdateDevicePushToken,
} from "@/queries/devices";
import { useHealthSummary } from "@/queries/health";
import { formatShortDate } from "@/utils/local-date";

// The exact scope set the backend's token exchange expects -- see
// Checkpoint 4.5 Stage A / apps/api's calendar-connections route. Kept as a
// single constant so Settings and any future entry point request identical
// scopes.
const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

// Android-only for this checkpoint -- GoogleCalendarAuthModule.web.ts (and
// the (unbuilt) iOS side) throw on authorize(). Guarded the same way
// ReminderEligibilityBanner guards ExactAlarmStatus's Android-only API.
async function runGoogleCalendarAuthorize(): Promise<{
  serverAuthCode: string;
  grantedScopes: string[];
}> {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
  if (!webClientId) {
    throw new Error("EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID is not configured");
  }
  return GoogleCalendarAuth.authorize(webClientId, GOOGLE_CALENDAR_SCOPES);
}

// Several actions in this screen caught `err.message` and rendered it
// verbatim -- for an ApiClientError that's a developer string like "API
// error 422: google_oauth_failed", never words meant for a screen, and for
// anything else it could be arbitrary. This is the one place an unknown
// thrown value becomes safe copy; every call site below routes through it
// instead of reading `.message` directly. `.body` is never echoed.
function describeActionFailure(err: unknown): string {
  if (err instanceof ApiClientError) {
    switch (err.code) {
      case "google_oauth_failed":
        return "Google didn't complete the connection. Try again.";
      case "caldav_discovery_failed":
        return "Couldn't reach that CalDAV server. Check the address and try again.";
      case "device_revoked":
        return "This device is no longer registered.";
      case "invalid_token":
        return "This device's credentials are no longer valid.";
      case "validation_failed":
        return "Some of the details entered weren't valid.";
      case "not_found":
        return "That could not be found.";
      default:
        return "Something went wrong. Try again.";
    }
  }
  return "Something went wrong. Try again.";
}

function OutboxDiagnostics() {
  const queryClient = useQueryClient();
  const { data: stats } = useQuery({
    queryKey: ["outbox", "stats"],
    queryFn: getOutboxStats,
    refetchInterval: 5000,
  });
  const [flushResult, setFlushResult] = useState<string | null>(null);

  // 6.7A AY11: raw async onPress with no mutation object meant nothing bound
  // `disabled` -- repeated taps fired flushOutbox() concurrently.
  const flush = useBusyPress(async () => {
    const { flushed, remaining, failed } = await flushOutbox();
    setFlushResult(
      `Flushed ${flushed}, ${remaining} pending${failed ? `, ${failed} need attention` : ""}`,
    );
    void queryClient.invalidateQueries({ queryKey: ["outbox"] });
    void queryClient.invalidateQueries({ queryKey: ["inbox"] });
  });

  return (
    <View className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
      <Text className="mb-2 text-base font-bold text-black dark:text-white">Offline outbox</Text>
      <Text className="mb-2 text-sm text-black dark:text-white">
        Pending captures: {stats?.pending ?? "…"}
        {stats?.failed ? ` · Needs attention: ${stats.failed}` : ""}
      </Text>
      <Pressable
        onPress={flush.onPress}
        disabled={flush.busy}
        className="min-h-[44px] justify-center rounded bg-neutral-200 px-3 py-2 disabled:opacity-50 dark:bg-neutral-800"
      >
        <Text className="text-center text-sm text-black dark:text-white">
          {flush.busy ? "Flushing…" : "Flush now"}
        </Text>
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

  // 6.7A AY11: same single-flight discipline as every mutation-backed button.
  const registerPush = useBusyPress(async () => {
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
      setPushResult(`Failed: ${describeActionFailure(err)}`);
    }
  });

  const remoteTest = useBusyPress(async () => {
    if (!identity) return;
    setRemoteTestResult("Queueing…");
    try {
      await api.sendTestNotification(identity.token, identity.deviceId);
      setRemoteTestResult("Queued for this device.");
    } catch (error) {
      setRemoteTestResult(`Failed: ${describeActionFailure(error)}`);
    }
  });

  const scheduleTest = useBusyPress(async () => {
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
  });

  const scheduleRebootTest = useBusyPress(async () => {
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
  });

  return (
    <View className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
      <Text className="mb-2 text-base font-bold text-black dark:text-white">
        Notification diagnostics
      </Text>

      <Pressable
        onPress={() => setExactAlarmOk(ExactAlarmStatus.canScheduleExactAlarms())}
        className="mb-1 min-h-[44px] justify-center rounded bg-neutral-200 px-3 py-2 dark:bg-neutral-800"
      >
        <Text className="text-center text-sm text-black dark:text-white">
          Check exact-alarm permission
          {exactAlarmOk === null ? "" : exactAlarmOk ? ": granted" : ": NOT granted"}
        </Text>
      </Pressable>
      {exactAlarmOk === false ? (
        <Pressable
          onPress={() => ExactAlarmStatus.openExactAlarmSettings()}
          className="mb-2 min-h-[44px] justify-center rounded bg-blue-100 px-3 py-2 dark:bg-blue-950"
        >
          <Text className="text-center text-sm text-blue-700 dark:text-blue-300">
            Open exact-alarm settings
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={registerPush.onPress}
        disabled={registerPush.busy}
        className="mb-1 min-h-[44px] justify-center rounded bg-neutral-200 px-3 py-2 disabled:opacity-50 dark:bg-neutral-800"
      >
        <Text className="text-center text-sm text-black dark:text-white">
          Register for push notifications
        </Text>
      </Pressable>
      {pushResult ? <Text className="mb-2 text-xs text-neutral-500">{pushResult}</Text> : null}

      <Pressable
        onPress={remoteTest.onPress}
        disabled={remoteTest.busy}
        className="mb-1 min-h-[44px] justify-center rounded bg-neutral-200 px-3 py-2 disabled:opacity-50 dark:bg-neutral-800"
      >
        <Text className="text-center text-sm text-black dark:text-white">
          Send remote test notification
        </Text>
      </Pressable>
      {remoteTestResult ? (
        <Text className="mb-2 text-xs text-neutral-500">{remoteTestResult}</Text>
      ) : null}

      <Pressable
        onPress={scheduleTest.onPress}
        disabled={scheduleTest.busy}
        className="min-h-[44px] justify-center rounded bg-neutral-200 px-3 py-2 disabled:opacity-50 dark:bg-neutral-800"
      >
        <Text className="text-center text-sm text-black dark:text-white">
          Schedule test reminder (10s)
        </Text>
      </Pressable>
      {testScheduled ? <Text className="mt-1 text-xs text-neutral-500">{testScheduled}</Text> : null}

      <Pressable
        onPress={scheduleRebootTest.onPress}
        disabled={scheduleRebootTest.busy}
        className="mt-1 min-h-[44px] justify-center rounded bg-neutral-200 px-3 py-2 disabled:opacity-50 dark:bg-neutral-800"
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
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
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
          className="mb-2 min-h-[44px] justify-center rounded bg-blue-100 px-3 py-2 dark:bg-blue-950"
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
          Alert.alert(
            "Revoke this device?",
            device.is_primary_reminder_device
              ? `${device.name} is the PRIMARY reminder device -- revoking it stops local reminders from firing on any device until you choose a new primary.`
              : `${device.name} will lose access immediately and will need to be paired again to reconnect.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Revoke",
                style: "destructive",
                onPress: () =>
                  revokeDevice.mutate(device.id, {
                    onSuccess: () => {
                      if (isThisDevice) void onThisDeviceRevoked();
                    },
                  }),
              },
            ],
          )
        }
        disabled={revokeDevice.isPending || Boolean(device.revoked_at)}
        className="mt-2 min-h-[44px] justify-center rounded bg-red-100 px-3 py-2 dark:bg-red-950"
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
          className="mt-2 min-h-[44px] justify-center rounded bg-amber-200 px-3 py-2 dark:bg-amber-900"
        >
          <Text className="text-center text-sm text-amber-900 dark:text-amber-100">
            Open exact-alarm settings
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function GoogleCalendarRow({
  calendar,
  disabled,
  onToggle,
}: {
  calendar: ReturnType<typeof mergeAvailableCalendars>[number];
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <View className="mr-2 flex-1">
        <Text className="text-black dark:text-white">
          {calendar.summary}
          {calendar.primary ? " (primary)" : ""}
        </Text>
        {calendar.last_successful_sync_at ? (
          <Text className="text-xs text-neutral-500">
            Last synced {new Date(calendar.last_successful_sync_at).toLocaleString()}
          </Text>
        ) : null}
      </View>
      <Switch
        value={calendar.sync_enabled}
        onValueChange={onToggle}
        disabled={disabled}
        accessibilityLabel={`Sync ${calendar.summary}${calendar.primary ? " (primary)" : ""}`}
      />
    </View>
  );
}

// One card per active Google connection: the live available-calendars list
// merged against whatever this session has learned about persisted
// sync_enabled state (see usePersistedCalendarConnectionCalendars's comment
// -- there's no GET for that data, so it's only known after a toggle or a
// sync-now response in the current session).
function GoogleCalendarConnectionCard({ connection }: { connection: CalendarConnection }) {
  const { data: available, isLoading, isError, refetch } = useAvailableGoogleCalendars(connection.id);
  const { data: persisted } = usePersistedCalendarConnectionCalendars(connection.id);
  const updateCalendars = useUpdateCalendarConnectionCalendars();
  const syncNow = useSyncCalendarConnectionNow();
  const disconnect = useDisconnectCalendarConnection();
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const merged = mergeAvailableCalendars(available ?? [], persisted ?? []);

  const toggle = (googleCalendarId: string, next: boolean) => {
    // Always PATCH the full desired set, not just the changed item -- the
    // response then doubles as a complete snapshot for the cache-only
    // persisted-calendars query (see queries/calendar-connections.ts).
    updateCalendars.mutate({
      connectionId: connection.id,
      body: merged.map((cal) => ({
        google_calendar_id: cal.google_calendar_id,
        sync_enabled: cal.google_calendar_id === googleCalendarId ? next : cal.sync_enabled,
      })),
    });
  };

  return (
    <View className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
      <Text className="mb-1 text-base font-bold text-black dark:text-white">
        {connection.google_account_email}
      </Text>
      <Text className="mb-2 text-xs text-neutral-500">Google Calendar · connected</Text>

      {isLoading ? <Text className="text-neutral-500">Loading calendars…</Text> : null}
      {isError ? (
        <View className="mb-2 items-start gap-2">
          <Text className="text-red-600">Couldn&apos;t load Google calendars.</Text>
          <Pressable
            onPress={() => void refetch()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading Google calendars"
            className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="text-sm font-medium text-white">Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {merged.map((cal) => (
        <GoogleCalendarRow
          key={cal.key}
          calendar={cal}
          disabled={updateCalendars.isPending}
          onToggle={(next) => {
            if (cal.google_calendar_id) {
              toggle(cal.google_calendar_id, next);
            }
          }}
        />
      ))}

      <Pressable
        onPress={async () => {
          setSyncResult("Syncing…");
          try {
            const result = await syncNow.mutateAsync(connection.id);
            setSyncResult(`Queued ${result.queued} calendar${result.queued === 1 ? "" : "s"}.`);
          } catch (err) {
            setSyncResult(`Failed: ${describeActionFailure(err)}`);
          }
        }}
        disabled={syncNow.isPending}
        className="mt-2 min-h-[44px] justify-center rounded bg-blue-100 px-3 py-2 dark:bg-blue-950"
      >
        <Text className="text-center text-sm text-blue-700 dark:text-blue-300">
          {syncNow.isPending ? "Syncing…" : "Sync now"}
        </Text>
      </Pressable>
      {syncResult ? <Text className="mt-1 text-xs text-neutral-500">{syncResult}</Text> : null}

      <Pressable
        onPress={() =>
          Alert.alert(
            "Disconnect Google Calendar?",
            `Personal OS will stop syncing with ${connection.google_account_email}. Events already synced stay in Personal OS, but new changes on either side won't be shared until you reconnect.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Disconnect",
                style: "destructive",
                onPress: () => disconnect.mutate(connection.id),
              },
            ],
          )
        }
        disabled={disconnect.isPending}
        className="mt-2 min-h-[44px] justify-center rounded bg-red-100 px-3 py-2 dark:bg-red-950"
      >
        <Text className="text-center text-sm text-red-700 dark:text-red-300">
          {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
        </Text>
      </Pressable>
    </View>
  );
}

function CaldavCalendarConnectionCard({ connection }: { connection: CalendarConnection }) {
  const { data: available, isLoading, isError, refetch } = useAvailableCalendars(connection.id);
  const { data: persisted } = usePersistedCalendarConnectionCalendars(connection.id);
  const updateCalendars = useUpdateCalendarConnectionCalendars();
  const syncNow = useSyncCalendarConnectionNow();
  const disconnect = useDisconnectCalendarConnection();
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const merged = mergeAvailableCalendars(available ?? [], persisted ?? []);

  const toggle = (caldavCalendarUrl: string, next: boolean) => {
    updateCalendars.mutate({
      connectionId: connection.id,
      body: merged.map((cal) => ({
        caldav_calendar_url: cal.caldav_calendar_url,
        sync_enabled: cal.caldav_calendar_url === caldavCalendarUrl ? next : cal.sync_enabled,
      })),
    });
  };

  return (
    <View className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
      <Text className="mb-1 text-base font-bold text-black dark:text-white">
        {connection.username} ({connection.server_url})
      </Text>
      <Text className="mb-2 text-xs text-neutral-500">CalDAV · connected</Text>

      {isLoading ? <Text className="text-neutral-500">Loading calendars…</Text> : null}
      {isError ? (
        <View className="mb-2 items-start gap-2">
          <Text className="text-red-600">Couldn&apos;t load CalDAV calendars.</Text>
          <Pressable
            onPress={() => void refetch()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading CalDAV calendars"
            className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="text-sm font-medium text-white">Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {merged.map((cal) => (
        <View key={cal.key} className="flex-row items-center justify-between py-2">
          <View className="mr-2 flex-1">
            <Text className="text-black dark:text-white">{cal.summary}</Text>
            {cal.last_successful_sync_at ? (
              <Text className="text-xs text-neutral-500">
                Last synced {new Date(cal.last_successful_sync_at).toLocaleString()}
              </Text>
            ) : null}
          </View>
          <Switch
            value={cal.sync_enabled}
            onValueChange={(next) => {
              if (cal.caldav_calendar_url) {
                toggle(cal.caldav_calendar_url, next);
              }
            }}
            disabled={updateCalendars.isPending}
            accessibilityLabel={`Sync ${cal.summary}`}
          />
        </View>
      ))}

      <Pressable
        onPress={async () => {
          setSyncResult("Syncing…");
          try {
            const result = await syncNow.mutateAsync(connection.id);
            setSyncResult(`Queued ${result.queued} calendar${result.queued === 1 ? "" : "s"}.`);
          } catch (err) {
            setSyncResult(`Failed: ${describeActionFailure(err)}`);
          }
        }}
        disabled={syncNow.isPending}
        className="mt-2 min-h-[44px] justify-center rounded bg-blue-100 px-3 py-2 dark:bg-blue-950"
      >
        <Text className="text-center text-sm text-blue-700 dark:text-blue-300">
          {syncNow.isPending ? "Syncing…" : "Sync now"}
        </Text>
      </Pressable>
      {syncResult ? <Text className="mt-1 text-xs text-neutral-500">{syncResult}</Text> : null}

      <Pressable
        onPress={() =>
          Alert.alert(
            "Disconnect CalDAV?",
            `Personal OS will stop syncing with ${connection.username} (${connection.server_url}). Events already synced stay in Personal OS, but new changes on either side won't be shared until you reconnect.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Disconnect",
                style: "destructive",
                onPress: () => disconnect.mutate(connection.id),
              },
            ],
          )
        }
        disabled={disconnect.isPending}
        className="mt-2 min-h-[44px] justify-center rounded bg-red-100 px-3 py-2 dark:bg-red-950"
      >
        <Text className="text-center text-sm text-red-700 dark:text-red-300">
          {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
        </Text>
      </Pressable>
    </View>
  );
}

function ConnectedCalendarsCard() {
  const { data, isLoading, isError, refetch } = useCalendarConnections();
  const connectGoogle = useConnectGoogleCalendar();
  const connectCaldav = useConnectCaldavCalendar();
  const placeholderColor = usePlaceholderColor();

  const [googleError, setGoogleError] = useState<string | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState(false);

  // CalDAV form state
  const [showCaldavForm, setShowCaldavForm] = useState(false);
  const [caldavServerUrl, setCaldavServerUrl] = useState("");
  const [caldavUsername, setCaldavUsername] = useState("");
  const [caldavPassword, setCaldavPassword] = useState("");
  const [caldavError, setCaldavError] = useState<string | null>(null);

  const googleConnections = (data?.items ?? []).filter(
    (connection) => connection.provider === "google",
  );
  const caldavConnections = (data?.items ?? []).filter(
    (connection) => connection.provider === "caldav",
  );

  const runGoogleConnect = async () => {
    setGoogleError(null);
    setIsAuthorizing(true);
    try {
      const result = await runGoogleCalendarAuthorize();
      await connectGoogle.mutateAsync({ auth_code: result.serverAuthCode });
    } catch (err) {
      setGoogleError(describeActionFailure(err));
    } finally {
      setIsAuthorizing(false);
    }
  };

  const runCaldavConnect = async () => {
    setCaldavError(null);
    try {
      await connectCaldav.mutateAsync({
        server_url: caldavServerUrl.trim(),
        username: caldavUsername.trim(),
        password: caldavPassword,
      });
      setShowCaldavForm(false);
      setCaldavServerUrl("");
      setCaldavUsername("");
      setCaldavPassword("");
    } catch (err) {
      setCaldavError(describeActionFailure(err));
    }
  };

  const connectingGoogle = isAuthorizing || connectGoogle.isPending;

  return (
    <View className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
      <Text className="mb-2 text-base font-bold text-black dark:text-white">
        Connected Calendars
      </Text>

      {isLoading ? <Text className="text-neutral-500">Loading…</Text> : null}
      {isError ? (
        <View className="mb-2 items-start gap-2">
          <Text className="text-red-600">Couldn&apos;t load calendar connections.</Text>
          <Pressable
            onPress={() => void refetch()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading calendar connections"
            className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="text-sm font-medium text-white">Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Google Connections (Android only) */}
      {Platform.OS === "android" ? (
        <>
          {googleConnections.map((connection) => {
            if (connection.status === "active") {
              return <GoogleCalendarConnectionCard key={connection.id} connection={connection} />;
            }

            if (connection.status === "needs_reauth") {
              return (
                <View
                  key={connection.id}
                  className="mb-4 rounded border border-amber-500 bg-amber-50 p-3 dark:bg-amber-950"
                >
                  <Text className="mb-1 text-sm font-bold text-amber-900 dark:text-amber-200">
                    Reconnect Google Calendar
                  </Text>
                  <Text className="mb-2 text-xs text-amber-900 dark:text-amber-200">
                    {connection.google_account_email} needs to be reconnected before syncing can
                    continue.
                  </Text>
                  {calendarSyncErrorCopy(connection.last_sync_error) ? (
                    <Text className="mb-2 text-xs text-amber-900 dark:text-amber-200">
                      {calendarSyncErrorCopy(connection.last_sync_error)}
                    </Text>
                  ) : null}
                  <Pressable
                    onPress={runGoogleConnect}
                    disabled={connectingGoogle}
                    className="min-h-[44px] justify-center rounded bg-amber-200 px-3 py-2 dark:bg-amber-900"
                  >
                    <Text className="text-center text-sm text-amber-900 dark:text-amber-100">
                      {connectingGoogle ? "Reconnecting…" : "Reconnect"}
                    </Text>
                  </Pressable>
                </View>
              );
            }

            return (
              <View
                key={connection.id}
                className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700"
              >
                <Text className="mb-2 text-sm text-black dark:text-white">
                  {connection.google_account_email} — not connected
                </Text>
                <Pressable
                  onPress={runGoogleConnect}
                  disabled={connectingGoogle}
                  className="min-h-[44px] justify-center rounded bg-blue-100 px-3 py-2 dark:bg-blue-950"
                >
                  <Text className="text-center text-sm text-blue-700 dark:text-blue-300">
                    {connectingGoogle ? "Reconnecting…" : "Reconnect"}
                  </Text>
                </Pressable>
              </View>
            );
          })}

          {googleConnections.length === 0 ? (
            <Pressable
              onPress={runGoogleConnect}
              disabled={connectingGoogle}
              className="mb-3 min-h-[44px] justify-center rounded bg-blue-100 px-3 py-2 dark:bg-blue-950"
            >
              <Text className="text-center text-sm text-blue-700 dark:text-blue-300">
                {connectingGoogle ? "Connecting…" : "Connect Google Calendar"}
              </Text>
            </Pressable>
          ) : null}
          {googleError ? <Text className="mb-3 text-xs text-red-600">{googleError}</Text> : null}
        </>
      ) : null}

      {/* CalDAV Connections (Universal: iOS, Android, Web) */}
      {caldavConnections.map((connection) => {
        if (connection.status === "active") {
          return <CaldavCalendarConnectionCard key={connection.id} connection={connection} />;
        }
        return (
          <View
            key={connection.id}
            className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700"
          >
            <Text className="mb-2 text-sm text-black dark:text-white">
              CalDAV ({connection.username}) — disconnected
            </Text>
            {calendarSyncErrorCopy(connection.last_sync_error) ? (
              <Text className="mb-2 text-xs text-neutral-500">
                {calendarSyncErrorCopy(connection.last_sync_error)}
              </Text>
            ) : null}
            <Pressable
              onPress={() => setShowCaldavForm(true)}
              className="min-h-[44px] justify-center rounded bg-blue-100 px-3 py-2 dark:bg-blue-950"
            >
              <Text className="text-center text-sm text-blue-700 dark:text-blue-300">
                Reconnect CalDAV
              </Text>
            </Pressable>
          </View>
        );
      })}

      {/* CalDAV Connect Button / Form */}
      {caldavConnections.length === 0 || showCaldavForm ? (
        showCaldavForm ? (
          <View className="mt-2 rounded border border-neutral-200 p-3 dark:border-neutral-800">
            <Text className="mb-2 font-bold text-black dark:text-white">Connect CalDAV Server</Text>

            <Text className="mb-1 text-xs text-neutral-500">Server URL</Text>
            <TextInput
              value={caldavServerUrl}
              onChangeText={setCaldavServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://caldav.example.com"
              placeholderTextColor={placeholderColor}
              className="mb-2 rounded border border-neutral-300 px-2 py-1 text-sm text-black dark:border-neutral-700 dark:text-white"
            />

            <Text className="mb-1 text-xs text-neutral-500">Username / Email</Text>
            <TextInput
              value={caldavUsername}
              onChangeText={setCaldavUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="username"
              placeholderTextColor={placeholderColor}
              className="mb-2 rounded border border-neutral-300 px-2 py-1 text-sm text-black dark:border-neutral-700 dark:text-white"
            />

            <Text className="mb-1 text-xs text-neutral-500">App Password / Token</Text>
            <TextInput
              value={caldavPassword}
              onChangeText={setCaldavPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholder="password"
              placeholderTextColor={placeholderColor}
              className="mb-2 rounded border border-neutral-300 px-2 py-1 text-sm text-black dark:border-neutral-700 dark:text-white"
            />

            {caldavError ? <Text className="mb-2 text-xs text-red-600">{caldavError}</Text> : null}

            <View className="flex-row gap-2">
              <Pressable
                onPress={runCaldavConnect}
                disabled={connectCaldav.isPending}
                className="flex-1 min-h-[44px] justify-center rounded bg-blue-600 px-3 py-2"
              >
                <Text className="text-center text-sm font-bold text-white">
                  {connectCaldav.isPending ? "Connecting…" : "Connect"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setShowCaldavForm(false);
                  setCaldavError(null);
                }}
                className="min-h-[44px] justify-center rounded bg-neutral-200 px-3 py-2 dark:bg-neutral-800"
              >
                <Text className="text-center text-sm text-black dark:text-white">Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setShowCaldavForm(true)}
            className="min-h-[44px] justify-center rounded bg-neutral-200 px-3 py-2 dark:bg-neutral-800"
          >
            <Text className="text-center text-sm text-black dark:text-white">
              Connect CalDAV Calendar
            </Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

// Google Health lives next to Connected Calendars rather than among the device
// diagnostics because it is the same kind of thing -- an external source
// Personal OS reads from -- not a property of this handset.
//
// Checkpoint 6.4 is deliberately READ-ONLY over an existing connection. There
// is no connect, disconnect, per-stream toggle or backfill control here. The
// alternative -- shipping a connect button now -- was rejected because the
// consent flow, its exact-match redirect allowlist and partial-consent
// resolution are a checkpoint of their own; a half-built connect path that
// mints a grant the UI cannot then revoke is worse than plainly saying "not
// connected". Connecting stays a server-side operation until that checkpoint.
//
// There is also deliberately NO sync control here. The full /health screen owns
// manual sync, and two independently-mounted sync triggers is exactly the
// duplication this checkpoint is required to avoid.
const HEALTH_STATUS_TEXT: Record<HealthConnectionDisplayState, string> = {
  // We could not read the connection, so we assert nothing about it. Saying
  // "not connected" here would invite the user to mint a new grant to fix what
  // is actually a tunnel being down.
  unavailable: "Can't reach Personal OS, so the Google Health status is unknown.",
  not_configured: "Google Health isn't set up on this server.",
  not_connected: "No Google Health account is connected yet.",
  needs_reconnect: "Google Health needs to be reconnected before syncing can continue.",
  no_streams_enabled:
    "Connected, but every data type is turned off, so nothing will sync until they're turned back on.",
  syncing: "Syncing with Google Health now.",
  partial_scope: "Connected, but some data types weren't granted.",
  stale: "Connected, but the data hasn't caught up recently.",
  // The contract carries no error string on purpose -- last_sync_error has at
  // times held a Postgres detail -- so this says what happens next instead.
  error: "A recent sync didn't finish. Personal OS will try again on its own.",
  current: "Connected to Google Health.",
};

/** Neutral for the healthy and in-flight states; amber for degraded-but-live. */
function healthStatusToneClass(state: HealthConnectionDisplayState): string {
  switch (state) {
    case "unavailable":
      return "text-red-600 dark:text-red-400";
    case "needs_reconnect":
    case "no_streams_enabled":
    case "partial_scope":
    case "stale":
    case "error":
      return "text-amber-700 dark:text-amber-300";
    case "not_configured":
    case "not_connected":
    case "syncing":
    case "current":
      return "text-black dark:text-white";
  }
}

/**
 * "Data through Aug 23 · 2 days behind."
 *
 * Never "0 days behind": a zero count and "nothing has ever been verified" are
 * opposite claims, and describeFreshness keeps them apart by returning null
 * rather than 0 for the second one.
 */
function healthFreshnessLine(description: FreshnessDescription): string {
  if (description.verifiedThroughDate === null) {
    return "No health data has been verified yet.";
  }
  const through = `Data through ${formatShortDate(description.verifiedThroughDate)}`;
  const days = description.daysBehind;
  if (days === null || days === 0) return `${through}.`;
  return `${through} · ${days} day${days === 1 ? "" : "s"} behind.`;
}

function ConnectedHealthCard() {
  const { data, isError } = useHealthSummary();

  // A null state means the first load is still in flight. Every line below
  // reserves its height in that case so the card cannot jump once data lands.
  const state: HealthConnectionDisplayState | null = isError
    ? "unavailable"
    : data
      ? resolveHealthConnectionState({
          configured: data.configured,
          connection: data.connection,
          freshness: data.freshness,
          isLoadError: false,
        })
      : null;

  const freshness =
    data && state !== null && state !== "unavailable" && state !== "not_configured"
      ? describeFreshness({ freshness: data.freshness, todayLocalDate: data.local_date })
      : null;

  return (
    <View className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
      <Text className="mb-2 text-base font-bold text-black dark:text-white">Health</Text>

      <Text
        className={`min-h-[20px] text-sm ${state === null ? "text-neutral-500" : healthStatusToneClass(state)}`}
      >
        {state === null ? "Loading…" : HEALTH_STATUS_TEXT[state]}
      </Text>

      <Text className="min-h-[16px] text-xs text-neutral-500">
        {freshness === null ? "" : healthFreshnessLine(freshness)}
      </Text>

      {state === "partial_scope" ? (
        // Deliberately no scope URLs on screen -- they are implementation
        // detail and read as noise. Which streams are affected is visible on
        // the /health screen, per metric, where it is actionable.
        <Text className="mt-1 text-xs text-neutral-500">
          Some data types weren&apos;t granted permission, so those stay empty here.
        </Text>
      ) : null}

      {/* The single most useful thing a user can know when the dashboard looks
          empty, and Settings is where they will come looking for it. */}
      <Text className="mt-2 text-xs text-neutral-500">
        Personal OS reads what&apos;s already in Google Health, so a watch or app has to send its
        data there first.
      </Text>

      {state === "not_configured" ? (
        // Nothing to navigate to, and nothing to offer: connecting is a
        // server-side step this screen deliberately does not perform.
        <Text className="mt-2 min-h-[44px] py-3 text-sm text-neutral-500">
          There&apos;s nothing to show until Google Health is set up on the server.
        </Text>
      ) : (
        <Link href="/health" asChild>
          <Pressable
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="View health data"
            className="mt-2 min-h-[44px] justify-center rounded bg-neutral-200 px-3 py-2 dark:bg-neutral-800"
          >
            <Text className="text-center text-sm text-blue-700 dark:text-blue-300">
              View health data
            </Text>
          </Pressable>
        </Link>
      )}
    </View>
  );
}

export default function SettingsScreen() {
  const keyboardHeight = useKeyboardHeight();
  const { identity, clearIdentity } = useDeviceIdentity();
  const { data, isLoading, isError, error, refetch } = useDevices();
  const thisDevice = data?.items.find((device) => device.id === identity?.deviceId);

  const forgetThisDevice = async () => {
    await cancelOwnedReminders();
    await clearIdentity();
  };

  const confirmForgetThisDevice = () => {
    Alert.alert(
      "Forget this device?",
      thisDevice?.is_primary_reminder_device
        ? "This wipes this device's stored credentials and stops its scheduled reminders. It is the PRIMARY reminder device, so no device will schedule reminders until you pair again and choose a new primary."
        : "This wipes this device's stored credentials and stops its scheduled reminders. You'll need to pair again to reconnect.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Forget", style: "destructive", onPress: () => void forgetThisDevice() },
      ],
    );
  };

  // A 401 here almost always means this device's own bearer token was
  // revoked server-side -- the exact case DeviceCard's onThisDeviceRevoked
  // exists to handle, except it never runs because the list itself failed
  // to load. Naming the cause and surfacing the escape hatch here closes
  // that dead end.
  const devicesErrorStatus = error instanceof ApiClientError ? error.status : null;
  const isRevokedSession = devicesErrorStatus === 401;

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <ScrollView
        className="flex-1"
        // Extra room so lower controls can be scrolled clear of the IME --
        // see components/use-keyboard-height.ts for why insets alone don't do it.
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="mb-4 text-xl font-bold text-black dark:text-white">Devices</Text>

        <ReminderEligibilityBanner device={thisDevice} />
        <ConnectedCalendarsCard />
        <ConnectedHealthCard />
        <NotificationDiagnostics />
        <OutboxDiagnostics />

        {isLoading ? <Text className="text-neutral-500">Loading…</Text> : null}
        {isError ? (
          isRevokedSession ? (
            <View className="mb-4 rounded border border-amber-500 bg-amber-50 p-3 dark:bg-amber-950">
              <Text className="mb-1 text-sm font-bold text-amber-900 dark:text-amber-200">
                This device is no longer registered
              </Text>
              <Text className="mb-2 text-xs text-amber-900 dark:text-amber-200">
                Pair it again to restore reminders and notifications.
              </Text>
              <Pressable
                onPress={confirmForgetThisDevice}
                className="min-h-[44px] justify-center rounded bg-amber-200 px-3 py-2 dark:bg-amber-900"
              >
                <Text className="text-center text-sm text-amber-900 dark:text-amber-100">
                  Forget this device
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="mb-4 items-start gap-2">
              <Text className="text-red-600">Couldn&apos;t load devices.</Text>
              <Pressable
                onPress={() => void refetch()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Retry loading devices"
                className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
              >
                <Text className="font-semibold text-white">Retry</Text>
              </Pressable>
            </View>
          )
        ) : null}

        {data?.items.map((device) => (
          <DeviceCard
            key={device.id}
            device={device}
            isThisDevice={device.id === identity?.deviceId}
            onThisDeviceRevoked={forgetThisDevice}
          />
        ))}

        <Pressable
          onPress={confirmForgetThisDevice}
          className="mt-4 min-h-[44px] justify-center rounded bg-neutral-200 px-3 py-3 dark:bg-neutral-800"
        >
          <Text className="text-center text-black dark:text-white">Forget this device</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
