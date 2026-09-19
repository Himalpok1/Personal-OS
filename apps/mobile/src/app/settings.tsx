import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { useBusyPress } from "@/components/use-busy-press";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { calendarSyncErrorCopy } from "@/components/calendar/sync-error-copy";
import { ActionsSettingsCard } from "@/components/actions/actions-settings-card";
import { AgentsSettingsCard } from "@/components/agents/agents-settings-card";
import { CloudAskCard } from "@/components/ask/cloud-ask-card";
import { MemorySettingsCard } from "@/components/memory/memory-settings-card";
import {
  canConnectCanvas,
  canDisconnectCanvas,
  resolveCanvasConnectionState,
  resolveOverallCanvasState,
  type CanvasConnectionDisplayState,
} from "@/components/canvas/connection-state";
import { canvasSyncErrorCopy } from "@/components/canvas/sync-error-copy";
import { confirmDestructive } from "@/components/confirm-destructive";
import { mailCallbackRedirectUri } from "@/components/mail/callback-redirect";
import {
  canConnectMail,
  canDisconnectMail,
  resolveMailConnectionState,
  resolveOverallMailState,
  type MailConnectionDisplayState,
} from "@/components/mail/connection-state";
import { mailSyncErrorCopy } from "@/components/mail/sync-error-copy";
import { describeMonitorSummary } from "@/components/monitor/target-state";
import { usePlaceholderColor } from "@/components/placeholder-color";
import {
  describeFreshness,
  resolveHealthConnectionState,
  type FreshnessDescription,
  type HealthConnectionDisplayState,
} from "@/components/health/connection-state";
import { IntegrationSummaryRow } from "@/components/settings/integration-summary-row";
import {
  calendarConnectionChipLabel,
  calendarConnectionChipTone,
  canvasConnectionChipTone,
  healthConnectionChipTone,
  mailConnectionChipTone,
  monitorSummaryTone,
} from "@/components/settings/status-tone";
import {
  AppText,
  Button,
  Card,
  ListRow,
  ScreenFrame,
  SectionHeader,
  Skeleton,
  SkeletonList,
  StatusChip,
} from "@/components/ui";
import { ApiClientError } from "@personal-os/api-client";
import type { CalendarConnection, CanvasConnection, Device, MailConnection } from "@personal-os/schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import * as Linking from "expo-linking";
import ExactAlarmStatus from "../../modules/exact-alarm-status";
import GoogleCalendarAuth from "../../modules/google-calendar-auth";
import * as Notifications from "expo-notifications";
import { useState } from "react";
import { Platform, SafeAreaView, ScrollView, Switch, TextInput, View } from "react-native";
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
import {
  useCanvasConnections,
  useCanvasSyncRuns,
  useConnectCanvas,
  useDisconnectCanvasConnection,
  useTriggerCanvasSync,
} from "@/queries/canvas";
import { api, API_BASE_URL } from "@/queries/client";
import {
  useDevices,
  useRevokeDevice,
  useSetPrimaryDevice,
  useUpdateDevice,
  useUpdateDevicePushToken,
} from "@/queries/devices";
import { useHealthSummary } from "@/queries/health";
import {
  useDisconnectMailConnection,
  useGmailAuthorizeUrl,
  useMailConnections,
} from "@/queries/mail";
import { useMonitorOverview } from "@/queries/monitor";
import { formatShortDate } from "@/utils/local-date";

// The one text-input style on this screen (Checkpoint 10.3): an inset well
// on the card, in the design system's surface-container role, so every form
// field -- CalDAV, Canvas -- reads the same. Layout-only classes plus the
// token roles; no palette of its own.
const INPUT_CLASS =
  "mb-2 rounded-inner bg-surface-container px-3 py-2.5 text-body text-on-surface dark:bg-surface-container-dark dark:text-on-surface-dark";

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
      case "canvas_auth_failed":
        return "Canvas didn't accept that URL or access token. Check both and try again.";
      case "canvas_already_connected":
        return "A Canvas connection for that address already exists.";
      case "canvas_url_blocked":
        return "That address isn't allowed. Enter your Canvas instance's real web address.";
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

// A load failure inside a card: the sentence, and a Retry. Kept as a section
// block (not the full-screen ErrorState) because the card around it is still
// live -- its other queries and actions keep working.
function InlineRetry({
  message,
  onRetry,
  accessibilityLabel,
}: {
  message: string;
  onRetry: () => void;
  accessibilityLabel: string;
}) {
  return (
    <View className="mb-2 items-start gap-2" accessibilityRole="alert">
      <AppText variant="body" tone="danger">
        {message}
      </AppText>
      <Button label="Retry" onPress={onRetry} accessibilityLabel={accessibilityLabel} size="sm" />
    </View>
  );
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
    <Card className="mb-4">
      <ListRow icon="tray-arrow-up" title="Offline outbox" inset last />
      <AppText variant="body" className="mb-3">
        Pending captures: {stats?.pending ?? "…"}
        {stats?.failed ? ` · Needs attention: ${stats.failed}` : ""}
      </AppText>
      <Button
        label={flush.busy ? "Flushing" : "Flush now"}
        onPress={flush.onPress}
        busy={flush.busy}
        variant="tonal"
        block
      />
      {flushResult ? (
        <AppText variant="caption" tone="muted" className="mt-2">
          {flushResult}
        </AppText>
      ) : null}
    </Card>
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
    <Card className="mb-4">
      <ListRow icon="bell-cog-outline" title="Notification diagnostics" inset last />

      <View className="gap-2">
        <Button
          label={`Check exact-alarm permission${
            exactAlarmOk === null ? "" : exactAlarmOk ? ": granted" : ": NOT granted"
          }`}
          onPress={() => setExactAlarmOk(ExactAlarmStatus.canScheduleExactAlarms())}
          variant="outline"
          block
        />
        {exactAlarmOk === false ? (
          <Button
            label="Open exact-alarm settings"
            onPress={() => ExactAlarmStatus.openExactAlarmSettings()}
            variant="tonal"
            block
          />
        ) : null}

        <Button
          label="Register for push notifications"
          onPress={registerPush.onPress}
          disabled={registerPush.busy}
          variant="outline"
          block
        />
        {pushResult ? (
          <AppText variant="caption" tone="muted">
            {pushResult}
          </AppText>
        ) : null}

        <Button
          label="Send remote test notification"
          onPress={remoteTest.onPress}
          disabled={remoteTest.busy}
          variant="outline"
          block
        />
        {remoteTestResult ? (
          <AppText variant="caption" tone="muted">
            {remoteTestResult}
          </AppText>
        ) : null}

        <Button
          label="Schedule test reminder (10s)"
          onPress={scheduleTest.onPress}
          disabled={scheduleTest.busy}
          variant="outline"
          block
        />
        {testScheduled ? (
          <AppText variant="caption" tone="muted">
            {testScheduled}
          </AppText>
        ) : null}

        <Button
          label="Schedule reboot test (2m)"
          onPress={scheduleRebootTest.onPress}
          disabled={scheduleRebootTest.busy}
          variant="outline"
          block
        />
      </View>
    </Card>
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
    <ListRow
      title={label}
      trailing={<Switch value={value} onValueChange={onChange} accessibilityLabel={label} />}
      inset
    />
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
    <Card className="mb-4">
      <ListRow
        icon={device.platform === "web" ? "monitor-dashboard" : "cellphone"}
        iconTone={device.is_primary_reminder_device ? "primary" : "neutral"}
        title={`${device.name} ${isThisDevice ? "(this device)" : ""}`}
        subtitle={device.platform}
        trailing={
          device.is_primary_reminder_device ? (
            <StatusChip label="PRIMARY" tone="primary" icon="bell-ring-outline" />
          ) : undefined
        }
        inset
      />

      {!device.is_primary_reminder_device ? (
        <Button
          label={setPrimary.isPending ? "Setting" : "Set as primary reminder device"}
          onPress={() => setPrimary.mutate(device.id)}
          busy={setPrimary.isPending}
          variant="tonal"
          block
          className="mt-3"
        />
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

      <Button
        label={device.revoked_at ? "Revoked" : revokeDevice.isPending ? "Revoking" : "Revoke"}
        onPress={() =>
          confirmDestructive({
            title: "Revoke this device?",
            message: device.is_primary_reminder_device
              ? `${device.name} is the PRIMARY reminder device -- revoking it stops local reminders from firing on any device until you choose a new primary.`
              : `${device.name} will lose access immediately and will need to be paired again to reconnect.`,
            confirmLabel: "Revoke",
            onConfirm: () =>
              revokeDevice.mutate(device.id, {
                onSuccess: () => {
                  if (isThisDevice) void onThisDeviceRevoked();
                },
              }),
          })
        }
        busy={revokeDevice.isPending}
        disabled={Boolean(device.revoked_at)}
        variant="danger"
        block
        className="mt-3"
      />
    </Card>
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
    <Card className="mb-4" accessibilityRole="alert">
      <ListRow icon="alert" iconTone="warning" title={title ?? ""} titleTone="warning" inset last />
      <AppText variant="body" tone="secondary">
        {warning}
      </AppText>
      {kind === "degraded" ? (
        <Button
          label="Open exact-alarm settings"
          onPress={() => ExactAlarmStatus.openExactAlarmSettings()}
          variant="tonal"
          block
          className="mt-3"
        />
      ) : null}
    </Card>
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
    <ListRow
      title={`${calendar.summary}${calendar.primary ? " (primary)" : ""}`}
      meta={
        calendar.last_successful_sync_at
          ? `Last synced ${new Date(calendar.last_successful_sync_at).toLocaleString()}`
          : undefined
      }
      trailing={
        <Switch
          value={calendar.sync_enabled}
          onValueChange={onToggle}
          disabled={disabled}
          accessibilityLabel={`Sync ${calendar.summary}${calendar.primary ? " (primary)" : ""}`}
        />
      }
      inset
    />
  );
}

// One card per active Google connection: the live available-calendars list
// merged against the connection's persisted sync_enabled state (Checkpoint
// 9.1: a real GET, not a hardcoded empty stub -- see
// usePersistedCalendarConnectionCalendars's comment).
function GoogleCalendarConnectionCard({ connection }: { connection: CalendarConnection }) {
  const { data: available, isLoading, isError, refetch } = useAvailableGoogleCalendars(connection.id);
  const {
    data: persisted,
    isLoading: isPersistedLoading,
    isError: isPersistedError,
    refetch: refetchPersisted,
  } = usePersistedCalendarConnectionCalendars(connection.id);
  const updateCalendars = useUpdateCalendarConnectionCalendars();
  const syncNow = useSyncCalendarConnectionNow();
  const disconnect = useDisconnectCalendarConnection();
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const merged = mergeAvailableCalendars(available ?? [], persisted ?? []);
  // Neither query is gated on the other, so `available` can resolve a real
  // calendar list before `persisted` has (or vice versa) -- rendering
  // toggles in that window is the SAME hazard as the error case just below:
  // mergeAvailableCalendars defaults sync_enabled to false for anything with
  // no matching persisted row, and toggling one calendar PATCHes the full
  // merged set, so a toggle made during this window would silently disable
  // every OTHER real calendar too.
  const persistedNotYetReady = isPersistedLoading || isPersistedError;

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
    <Card className="mb-4">
      <ListRow
        icon="google"
        iconTone="success"
        title={connection.google_account_email ?? ""}
        subtitle="Google Calendar"
        trailing={
          <StatusChip
            label={calendarConnectionChipLabel(connection.status)}
            tone={calendarConnectionChipTone(connection.status)}
          />
        }
        inset
      />

      {isLoading || isPersistedLoading ? <SkeletonList rows={2} /> : null}
      {isError ? (
        <InlineRetry
          message="Couldn't load Google calendars."
          onRetry={() => void refetch()}
          accessibilityLabel="Retry loading Google calendars"
        />
      ) : null}

      {/* A failed persisted-state fetch must NOT fall through to rendering
          every toggle as OFF -- mergeAvailableCalendars defaults
          sync_enabled to false for anything with no matching persisted row,
          which is indistinguishable from "really disabled" and is exactly
          the bug this checkpoint fixed, just triggered by a transient
          failure instead of a hardcoded stub. Suppress the (misleading)
          toggle list and show a distinct retry affordance instead. */}
      {isPersistedError ? (
        <InlineRetry
          message="Couldn't load your saved sync settings -- toggles below may not reflect reality."
          onRetry={() => void refetchPersisted()}
          accessibilityLabel="Retry loading saved sync settings"
        />
      ) : null}

      {/* Suppressed for the WHOLE window the persisted query is not yet
          settled with real data, not only on error -- `available` and
          `persisted` are two independent, unsynchronized fetches, and
          `available` resolving first would otherwise render every real
          calendar as OFF (persisted ?? [] is empty) for however long
          `persisted` takes to catch up. */}
      {persistedNotYetReady
        ? null
        : merged.map((cal) => (
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

      <View className="mt-3 flex-row flex-wrap gap-2">
        <Button
          label={syncNow.isPending ? "Syncing" : "Sync now"}
          onPress={async () => {
            setSyncResult("Syncing…");
            try {
              const result = await syncNow.mutateAsync(connection.id);
              setSyncResult(`Queued ${result.queued} calendar${result.queued === 1 ? "" : "s"}.`);
            } catch (err) {
              setSyncResult(`Failed: ${describeActionFailure(err)}`);
            }
          }}
          busy={syncNow.isPending}
          variant="tonal"
        />
        <Button
          label={disconnect.isPending ? "Disconnecting" : "Disconnect"}
          onPress={() =>
            confirmDestructive({
              title: "Disconnect Google Calendar?",
              message: `Personal OS will stop syncing with ${connection.google_account_email}. Events already synced stay in Personal OS, but new changes on either side won't be shared until you reconnect.`,
              confirmLabel: "Disconnect",
              onConfirm: () => disconnect.mutate(connection.id),
            })
          }
          busy={disconnect.isPending}
          variant="danger"
        />
      </View>
      {syncResult ? (
        <AppText variant="caption" tone="muted" className="mt-2">
          {syncResult}
        </AppText>
      ) : null}
    </Card>
  );
}

function CaldavCalendarConnectionCard({ connection }: { connection: CalendarConnection }) {
  const { data: available, isLoading, isError, refetch } = useAvailableCalendars(connection.id);
  const {
    data: persisted,
    isLoading: isPersistedLoading,
    isError: isPersistedError,
    refetch: refetchPersisted,
  } = usePersistedCalendarConnectionCalendars(connection.id);
  const updateCalendars = useUpdateCalendarConnectionCalendars();
  const syncNow = useSyncCalendarConnectionNow();
  const disconnect = useDisconnectCalendarConnection();
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const merged = mergeAvailableCalendars(available ?? [], persisted ?? []);
  // See the identical guard in GoogleCalendarConnectionCard.
  const persistedNotYetReady = isPersistedLoading || isPersistedError;

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
    <Card className="mb-4">
      <ListRow
        icon="calendar-sync"
        iconTone="success"
        title={`${connection.username} (${connection.server_url})`}
        subtitle="CalDAV"
        trailing={
          <StatusChip
            label={calendarConnectionChipLabel(connection.status)}
            tone={calendarConnectionChipTone(connection.status)}
          />
        }
        inset
      />

      {isLoading || isPersistedLoading ? <SkeletonList rows={2} /> : null}
      {isError ? (
        <InlineRetry
          message="Couldn't load CalDAV calendars."
          onRetry={() => void refetch()}
          accessibilityLabel="Retry loading CalDAV calendars"
        />
      ) : null}

      {/* See the identical guard in GoogleCalendarConnectionCard: a failed
          persisted-state fetch must not fall through to rendering every
          toggle as OFF. */}
      {isPersistedError ? (
        <InlineRetry
          message="Couldn't load your saved sync settings -- toggles below may not reflect reality."
          onRetry={() => void refetchPersisted()}
          accessibilityLabel="Retry loading saved sync settings"
        />
      ) : null}

      {persistedNotYetReady
        ? null
        : merged.map((cal) => (
            <ListRow
              key={cal.key}
              title={cal.summary}
              meta={
                cal.last_successful_sync_at
                  ? `Last synced ${new Date(cal.last_successful_sync_at).toLocaleString()}`
                  : undefined
              }
              trailing={
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
              }
              inset
            />
          ))}

      <View className="mt-3 flex-row flex-wrap gap-2">
        <Button
          label={syncNow.isPending ? "Syncing" : "Sync now"}
          onPress={async () => {
            setSyncResult("Syncing…");
            try {
              const result = await syncNow.mutateAsync(connection.id);
              setSyncResult(`Queued ${result.queued} calendar${result.queued === 1 ? "" : "s"}.`);
            } catch (err) {
              setSyncResult(`Failed: ${describeActionFailure(err)}`);
            }
          }}
          busy={syncNow.isPending}
          variant="tonal"
        />
        <Button
          label={disconnect.isPending ? "Disconnecting" : "Disconnect"}
          onPress={() =>
            confirmDestructive({
              title: "Disconnect CalDAV?",
              message: `Personal OS will stop syncing with ${connection.username} (${connection.server_url}). Events already synced stay in Personal OS, but new changes on either side won't be shared until you reconnect.`,
              confirmLabel: "Disconnect",
              onConfirm: () => disconnect.mutate(connection.id),
            })
          }
          busy={disconnect.isPending}
          variant="danger"
        />
      </View>
      {syncResult ? (
        <AppText variant="caption" tone="muted" className="mt-2">
          {syncResult}
        </AppText>
      ) : null}
    </Card>
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
    <Card className="mb-4">
      <ListRow icon="calendar-month" iconTone="info" title="Connected Calendars" inset last />

      {isLoading ? <SkeletonList rows={2} /> : null}
      {isError ? (
        <InlineRetry
          message="Couldn't load calendar connections."
          onRetry={() => void refetch()}
          accessibilityLabel="Retry loading calendar connections"
        />
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
                <Card key={connection.id} elevation="flat" className="mb-4">
                  <ListRow
                    icon="google"
                    iconTone="warning"
                    title="Reconnect Google Calendar"
                    titleTone="warning"
                    trailing={
                      <StatusChip
                        label={calendarConnectionChipLabel(connection.status)}
                        tone={calendarConnectionChipTone(connection.status)}
                      />
                    }
                    inset
                    last
                  />
                  <AppText variant="body" tone="secondary">
                    {connection.google_account_email} needs to be reconnected before syncing can
                    continue.
                  </AppText>
                  {calendarSyncErrorCopy(connection.last_sync_error) ? (
                    <AppText variant="label" tone="warning" className="mt-2 font-normal">
                      {calendarSyncErrorCopy(connection.last_sync_error)}
                    </AppText>
                  ) : null}
                  <Button
                    label={connectingGoogle ? "Reconnecting" : "Reconnect"}
                    onPress={runGoogleConnect}
                    busy={connectingGoogle}
                    block
                    className="mt-3"
                  />
                </Card>
              );
            }

            return (
              <Card key={connection.id} elevation="flat" className="mb-4">
                <ListRow
                  icon="google"
                  title={connection.google_account_email ?? ""}
                  trailing={
                    <StatusChip
                      label="not connected"
                      tone={calendarConnectionChipTone(connection.status)}
                    />
                  }
                  inset
                  last
                />
                <Button
                  label={connectingGoogle ? "Reconnecting" : "Reconnect"}
                  onPress={runGoogleConnect}
                  busy={connectingGoogle}
                  variant="tonal"
                  block
                  className="mt-1"
                />
              </Card>
            );
          })}

          {googleConnections.length === 0 ? (
            <Button
              label={connectingGoogle ? "Connecting" : "Connect Google Calendar"}
              onPress={runGoogleConnect}
              busy={connectingGoogle}
              icon="google"
              block
              className="mb-3"
            />
          ) : null}
          {googleError ? (
            <AppText variant="label" tone="danger" className="mb-3 font-normal">
              {googleError}
            </AppText>
          ) : null}
        </>
      ) : null}

      {/* CalDAV Connections (Universal: iOS, Android, Web) */}
      {caldavConnections.map((connection) => {
        if (connection.status === "active") {
          return <CaldavCalendarConnectionCard key={connection.id} connection={connection} />;
        }
        return (
          <Card key={connection.id} elevation="flat" className="mb-4">
            <ListRow
              icon="calendar-sync"
              title={`CalDAV (${connection.username})`}
              trailing={
                <StatusChip
                  label="disconnected"
                  tone={calendarConnectionChipTone(connection.status)}
                />
              }
              inset
              last
            />
            {calendarSyncErrorCopy(connection.last_sync_error) ? (
              <AppText variant="label" tone="secondary" className="mb-2 font-normal">
                {calendarSyncErrorCopy(connection.last_sync_error)}
              </AppText>
            ) : null}
            <Button
              label="Reconnect CalDAV"
              onPress={() => setShowCaldavForm(true)}
              variant="tonal"
              block
              className="mt-1"
            />
          </Card>
        );
      })}

      {/* CalDAV Connect Button / Form */}
      {caldavConnections.length === 0 || showCaldavForm ? (
        showCaldavForm ? (
          <Card elevation="flat" className="mt-2">
            <AppText variant="title" className="mb-3">
              Connect CalDAV Server
            </AppText>

            <AppText variant="overline" tone="muted" className="mb-1">
              Server URL
            </AppText>
            <TextInput
              value={caldavServerUrl}
              onChangeText={setCaldavServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://caldav.example.com"
              placeholderTextColor={placeholderColor}
              className={INPUT_CLASS}
            />

            <AppText variant="overline" tone="muted" className="mb-1">
              Username / Email
            </AppText>
            <TextInput
              value={caldavUsername}
              onChangeText={setCaldavUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="username"
              placeholderTextColor={placeholderColor}
              className={INPUT_CLASS}
            />

            <AppText variant="overline" tone="muted" className="mb-1">
              App Password / Token
            </AppText>
            <TextInput
              value={caldavPassword}
              onChangeText={setCaldavPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholder="password"
              placeholderTextColor={placeholderColor}
              className={INPUT_CLASS}
            />

            {caldavError ? (
              <AppText variant="label" tone="danger" className="mb-2 font-normal">
                {caldavError}
              </AppText>
            ) : null}

            <View className="flex-row gap-2">
              <Button
                label={connectCaldav.isPending ? "Connecting" : "Connect"}
                onPress={runCaldavConnect}
                busy={connectCaldav.isPending}
                className="flex-1"
              />
              <Button
                label="Cancel"
                onPress={() => {
                  setShowCaldavForm(false);
                  setCaldavError(null);
                }}
                variant="ghost"
              />
            </View>
          </Card>
        ) : (
          <Button
            label="Connect CalDAV Calendar"
            onPress={() => setShowCaldavForm(true)}
            variant="outline"
            block
          />
        )
      ) : null}
    </Card>
  );
}


// Gmail lives beside Connected Calendars and Health for the same reason those
// two do: it is an external source Personal OS reads FROM, not a property of
// this handset.
//
// Unlike Health (Checkpoint 6.4, deliberately status-only), this card DOES offer
// connect and disconnect. The objection recorded there was specifically "a
// half-built connect path that mints a grant the UI cannot then revoke" -- and
// mail can revoke: `POST /mail-connections/:id/disconnect` exists, clears every
// credential column, and is wired below.
//
// Unlike Google Calendar, this is NOT gated on Platform.OS === "android".
// Calendar's connect path goes through a native `AuthorizationClient` module
// that throws on web and iOS. Gmail's is a plain HTTPS consent URL, so the card
// is universal -- CalDAV, not Google Calendar, is the right precedent.
const MAIL_STATUS_TEXT: Record<MailConnectionDisplayState, string> = {
  // We could not read it, so we assert nothing. Saying "not connected" here
  // would invite the user to mint a new grant to fix a tunnel being down.
  unavailable: "Can't reach Personal OS, so the Gmail status is unknown.",
  not_configured: "Gmail isn't set up on this server.",
  not_connected: "No mailbox is connected yet.",
  needs_reconnect: "This mailbox needs to be reconnected before syncing can continue.",
  disconnected: "Disconnected. Its history is kept, and reconnecting restores it.",
  error: "A recent sync didn't finish. Personal OS will try again on its own.",
  connected: "Connected to Gmail.",
};

// The status chip's tone per state lives in components/settings/status-tone.ts
// (Checkpoint 10.3), a pure map with its own test.

function ConnectedMailCard() {
  const connectionsQuery = useMailConnections();
  const authorizeUrl = useGmailAuthorizeUrl();
  const disconnect = useDisconnectMailConnection();
  const [notice, setNotice] = useState<string | null>(null);
  // WHICH mailbox is disconnecting, not merely THAT one is. A single card-level
  // `isPending` made every row's button read "Disconnecting..." at once, so a
  // second mailbox claimed work that was not happening to it.
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  // Mail identity is `(provider, external_account_id)` and several mailboxes are
  // legitimate, so this is a LIST -- not health's single-connection
  // `.limit(1)` picker. Today the card shows each one; the actions apply per
  // mailbox.
  const connections = connectionsQuery.data?.items ?? [];
  const configured = connectionsQuery.data?.configured ?? false;
  const isLoadError = connectionsQuery.isError;

  // Across EVERY mailbox, not `connections[0]`. The list is ordered by
  // created_at, so taking the first would let the OLDEST mailbox speak for a
  // card that may also contain a broken one.
  const overallState = resolveOverallMailState({ configured, connections, isLoadError });

  const beginConnect = async (): Promise<void> => {
    setNotice(null);
    try {
      // A FRESH url per attempt. The OAuth state is single-use and
      // expiry-checked before the code is spent, and Checkpoint 7.2's first live
      // attempt failed `400 invalid_state` because consent outlived it -- a
      // cached URL reproduces that by construction.
      const result = await authorizeUrl.mutateAsync(mailCallbackRedirectUri(API_BASE_URL));
      await Linking.openURL(result.url);
      // Honest about what happens next: the server's callback answers with a
      // plain JSON confirmation rather than redirecting back into the app, so
      // the user has to come back themselves. Saying so beats letting them
      // wonder whether it worked.
      setNotice("Approve access in the browser, then come back and tap Refresh.");
    } catch (err) {
      setNotice(`Couldn't start the connection. ${describeActionFailure(err)}`);
    }
  };

  const connectPress = useBusyPress(beginConnect);

  const confirmDisconnect = (connection: MailConnection): void => {
    confirmDestructive({
      title: "Disconnect this mailbox?",
      message:
        "Personal OS will stop syncing it and clear its saved credentials. The mail it has already summarised is kept, and you can reconnect later.",
      confirmLabel: "Disconnect",
      onConfirm: () => {
        setNotice(null);
        setDisconnectingId(connection.id);
        disconnect.mutate(connection.id, {
          // `revoked: false` still means a fully disconnected connection -- it
          // reports only whether Google accepted the revocation, so it must not
          // be presented as a failure.
          onSuccess: () => setNotice("Mailbox disconnected."),
          onError: (err) => setNotice(`Couldn't disconnect. ${describeActionFailure(err)}`),
          onSettled: () => setDisconnectingId(null),
        });
      },
    });
  };

  return (
    <Card className="mb-4">
      <ListRow
        icon="email-outline"
        iconTone={connectionsQuery.isLoading ? "neutral" : mailConnectionChipTone(overallState)}
        title="Mail"
        trailing={
          connectionsQuery.isLoading ? undefined : (
            <StatusChip
              label={overallState.replace(/_/g, " ")}
              tone={mailConnectionChipTone(overallState)}
            />
          )
        }
        inset
        last
      />

      {/* A skeleton where the status line WILL appear (Checkpoint 10.6); the
          live region below it stays mounted so the arrival is still announced. */}
      {connectionsQuery.isLoading ? <Skeleton width="70%" height={14} className="mt-1" /> : null}
      <AppText
        variant="body"
        tone="secondary"
        className="min-h-[20px]"
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
      >
        {connectionsQuery.isLoading ? "" : MAIL_STATUS_TEXT[overallState]}
      </AppText>

      {connections.map((connection) => {
        const state = resolveMailConnectionState({ configured, connection, isLoadError });
        // The mailbox ADDRESS is shown deliberately: it is the user's own
        // account and the only way to tell two mailboxes apart. ADR-054 forbids
        // an address in a push body, a log line, a commit message or a status
        // document -- none of which this is.
        return (
          <View key={connection.id} className="mt-3">
            {/* One state chip per card -- the header's (Checkpoint 10.6). The
                row says its own state in words on the subtitle. */}
            <ListRow
              title={connection.external_account_id}
              subtitle={MAIL_STATUS_TEXT[state]}
              inset
              last
            />
            {/* A CODE from a closed enum reaches this component, never provider
                prose -- and it is mapped to words here rather than printed, so a
                bare token like `cursor_expired` never faces the user. */}
            {mailSyncErrorCopy(connection.last_sync_error) === null ? null : (
              <AppText variant="label" tone="warning" className="mt-1 font-normal">
                {mailSyncErrorCopy(connection.last_sync_error)}
              </AppText>
            )}
            {canDisconnectMail(state, connection) ? (
              <Button
                label={disconnectingId === connection.id ? "Disconnecting" : "Disconnect"}
                onPress={() => confirmDisconnect(connection)}
                busy={disconnectingId === connection.id}
                disabled={disconnectingId !== null}
                accessibilityLabel={`Disconnect ${connection.external_account_id}`}
                variant="danger"
                className="mt-2"
              />
            ) : null}
          </View>
        );
      })}

      <View className="mt-3 flex-row flex-wrap gap-2">
        {canConnectMail(overallState) ? (
          <Button
            label={
              connectPress.busy
                ? "Opening"
                : connections.length === 0
                  ? "Connect Gmail"
                  : "Reconnect Gmail"
            }
            onPress={connectPress.onPress}
            busy={connectPress.busy}
            disabled={authorizeUrl.isPending}
          />
        ) : null}

        <Button
          label="Refresh"
          onPress={() => void connectionsQuery.refetch()}
          accessibilityLabel="Refresh mail connection status"
          variant="outline"
        />
      </View>

      {/* `useBusyPress` swallows rejections, so the action itself writes this
          line -- without it a failure would be completely silent. */}
      {notice === null ? null : (
        <AppText variant="caption" tone="secondary" className="mt-2">
          {notice}
        </AppText>
      )}
    </Card>
  );
}

// Canvas LMS (Checkpoint 10.1, ADR-068) lives beside Mail/Health/Calendar for
// the same reason those do: it is an external source Personal OS reads FROM.
//
// UNLIKE every OAuth connect flow in this screen (Gmail, Google Calendar),
// there is no authorize URL and no redirect: a Canvas Personal Access Token
// is typed directly into a form and sent in one request (ADR-068 §2), so the
// connect UI is CalDAV's inline-form shape, not Gmail's single-button shape.
// UNLIKE CalDAV, though, the form is never shown automatically just because
// zero accounts are connected -- it always starts behind a "Connect Canvas"
// button, exactly mirroring CalDAV's own `showCaldavForm` gate, so a Settings
// screen with nothing connected yet does not greet the owner with two open
// text fields before they have asked for them.
//
// Typed through `Href` for the reason health-today-card.tsx records: the
// route union is a generated artifact that may predate this route.
const ACADEMIC_ROUTE = "/academic" as Href;

const CANVAS_STATUS_TEXT: Record<CanvasConnectionDisplayState, string> = {
  // We could not read it, so we assert nothing. Saying "not connected" here
  // would invite the owner to paste a fresh token to fix a tunnel being down.
  unavailable: "Can't reach Personal OS, so the Canvas status is unknown.",
  not_configured: "Canvas isn't set up on this server.",
  not_connected: "No Canvas account is connected yet.",
  needs_reconnect: "Canvas rejected the saved access token. Reconnect with a fresh one.",
  disconnected:
    "Disconnected. Synced courses and assignments are kept, and reconnecting resumes syncing.",
  error: "A recent sync didn't finish. Personal OS will try again on its own.",
  connected: "Connected to Canvas.",
};

/**
 * One connected Canvas account: status, sync-error banner, last-sync detail,
 * a manual "Sync now" and Disconnect -- mirroring
 * `GoogleCalendarConnectionCard`'s per-row shape (its own hooks, its own
 * local notice), which is why `useTriggerCanvasSync`/
 * `useDisconnectCanvasConnection`/`useCanvasSyncRuns` are called HERE rather
 * than once in the parent card: each row's mutation `isPending` then scopes
 * itself to that row for free, with no separate "which id is busy" state
 * needed the way `ConnectedMailCard`'s single-card-level hooks require.
 */
function CanvasConnectionRow({ connection }: { connection: CanvasConnection }) {
  const disconnect = useDisconnectCanvasConnection();
  const triggerSync = useTriggerCanvasSync();
  // limit: 1 -- only the most recent run's counts are shown here; the full
  // history has no screen of its own in this checkpoint.
  const syncRunsQuery = useCanvasSyncRuns(connection.id, 1);
  const [notice, setNotice] = useState<string | null>(null);

  const state = resolveCanvasConnectionState({ configured: true, connection });
  const latestRun = syncRunsQuery.data?.items[0] ?? null;
  const syncCounts = latestRun
    ? [
        latestRun.courses_synced !== null ? `${latestRun.courses_synced} courses` : null,
        latestRun.assignments_synced !== null ? `${latestRun.assignments_synced} assignments` : null,
        latestRun.announcements_synced !== null
          ? `${latestRun.announcements_synced} announcements`
          : null,
        latestRun.events_synced !== null ? `${latestRun.events_synced} events` : null,
      ].filter((part): part is string => part !== null)
    : [];

  const onSync = (): void => {
    setNotice(null);
    triggerSync.mutate(connection.id, {
      onSuccess: (result) =>
        setNotice(result.queued ? "Sync requested." : "A sync was already queued."),
      onError: (err) => setNotice(`Couldn't start sync. ${describeActionFailure(err)}`),
    });
  };

  const confirmDisconnect = (): void => {
    confirmDestructive({
      title: "Disconnect this Canvas account?",
      message:
        "Personal OS will stop syncing new courses, assignments, announcements and events from " +
        "it. What's already synced is kept -- nothing is deleted -- and you can reconnect later.",
      confirmLabel: "Disconnect",
      onConfirm: () => {
        setNotice(null);
        disconnect.mutate(connection.id, {
          onSuccess: () => setNotice("Canvas account disconnected."),
          onError: (err) => setNotice(`Couldn't disconnect. ${describeActionFailure(err)}`),
        });
      },
    });
  };

  return (
    <View className="mt-3">
      {/* One state chip per card -- the header's (Checkpoint 10.6). The row
          says its own state in words on the meta line. */}
      <ListRow
        title={connection.canvas_base_url}
        subtitle={connection.canvas_user_name ?? undefined}
        meta={CANVAS_STATUS_TEXT[state]}
        inset
        last
      />

      {/* A CODE from a closed vocabulary reaches this component, never
          provider prose -- mapped to words here so a bare token like
          `auth_failed` never faces the owner. */}
      {canvasSyncErrorCopy(connection.last_sync_error) === null ? null : (
        <AppText variant="label" tone="warning" className="mt-1 font-normal">
          {canvasSyncErrorCopy(connection.last_sync_error)}
        </AppText>
      )}

      <AppText variant="caption" tone="muted" className="mt-1">
        {connection.last_sync_at
          ? `Last synced ${new Date(connection.last_sync_at).toLocaleString()}`
          : "Never synced"}
      </AppText>
      {syncCounts.length > 0 ? (
        <AppText variant="caption" tone="muted">
          {syncCounts.join(" · ")}
        </AppText>
      ) : null}

      <View className="mt-3 flex-row flex-wrap gap-2">
        {state === "connected" || state === "error" ? (
          <Button
            label={triggerSync.isPending ? "Requesting" : "Sync now"}
            onPress={onSync}
            busy={triggerSync.isPending}
            accessibilityLabel={`Sync ${connection.canvas_base_url} now`}
            variant="tonal"
          />
        ) : null}

        {canDisconnectCanvas(state, connection) ? (
          <Button
            label={disconnect.isPending ? "Disconnecting" : "Disconnect"}
            onPress={confirmDisconnect}
            busy={disconnect.isPending}
            accessibilityLabel={`Disconnect ${connection.canvas_base_url}`}
            variant="danger"
          />
        ) : null}
      </View>

      {notice === null ? null : (
        <AppText variant="caption" tone="secondary" className="mt-2">
          {notice}
        </AppText>
      )}
    </View>
  );
}

function ConnectedCanvasCard() {
  const connectionsQuery = useCanvasConnections();
  const connectCanvas = useConnectCanvas();
  const placeholderColor = usePlaceholderColor();

  const [showForm, setShowForm] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState("");
  const [canvasToken, setCanvasToken] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const connections = connectionsQuery.data?.items ?? [];
  const configured = connectionsQuery.data?.configured ?? false;
  const isLoadError = connectionsQuery.isError;
  const overallState = resolveOverallCanvasState({ configured, connections, isLoadError });

  const runConnect = async (): Promise<void> => {
    setFormError(null);
    try {
      await connectCanvas.mutateAsync({
        baseUrl: canvasUrl.trim(),
        personalAccessToken: canvasToken,
      });
      setShowForm(false);
      setCanvasUrl("");
      setCanvasToken("");
    } catch (err) {
      setFormError(describeActionFailure(err));
    }
  };

  return (
    <Card className="mb-4">
      <ListRow
        icon="school"
        iconTone={connectionsQuery.isLoading ? "neutral" : canvasConnectionChipTone(overallState)}
        title="Canvas"
        trailing={
          connectionsQuery.isLoading ? undefined : (
            <StatusChip
              label={overallState.replace(/_/g, " ")}
              tone={canvasConnectionChipTone(overallState)}
            />
          )
        }
        inset
        last
      />

      {connectionsQuery.isLoading ? <Skeleton width="70%" height={14} className="mt-1" /> : null}
      <AppText
        variant="body"
        tone="secondary"
        className="min-h-[20px]"
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
      >
        {connectionsQuery.isLoading ? "" : CANVAS_STATUS_TEXT[overallState]}
      </AppText>

      {connections.map((connection) => (
        <CanvasConnectionRow key={connection.id} connection={connection} />
      ))}

      {showForm ? (
        <Card elevation="flat" className="mt-3">
          <AppText variant="title" className="mb-3">
            Connect Canvas
          </AppText>

          <AppText variant="overline" tone="muted" className="mb-1">
            Canvas instance URL
          </AppText>
          <TextInput
            value={canvasUrl}
            onChangeText={setCanvasUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://yourschool.instructure.com"
            placeholderTextColor={placeholderColor}
            className={INPUT_CLASS}
          />

          {/* A live credential typed in, so it is masked like the one other
              secret field in this screen (CalDAV's App Password / Token). */}
          <AppText variant="overline" tone="muted" className="mb-1">
            Personal access token
          </AppText>
          <TextInput
            value={canvasToken}
            onChangeText={setCanvasToken}
            secureTextEntry
            autoCapitalize="none"
            placeholder="access token"
            placeholderTextColor={placeholderColor}
            className={INPUT_CLASS}
          />

          {formError ? (
            <AppText variant="label" tone="danger" className="mb-2 font-normal">
              {formError}
            </AppText>
          ) : null}

          <View className="flex-row gap-2">
            <Button
              label={connectCanvas.isPending ? "Connecting" : "Connect"}
              onPress={() => void runConnect()}
              busy={connectCanvas.isPending}
              className="flex-1"
            />
            <Button
              label="Cancel"
              onPress={() => {
                setShowForm(false);
                setFormError(null);
              }}
              variant="ghost"
            />
          </View>
        </Card>
      ) : canConnectCanvas(overallState) ? (
        <Button
          label={connections.length === 0 ? "Connect Canvas" : "Connect another Canvas account"}
          onPress={() => setShowForm(true)}
          variant="outline"
          block
          className="mt-3"
        />
      ) : null}
    </Card>
  );
}

// Checkpoint 10.2's way through to the synced courses, now its own section
// (Checkpoint 10.3) rather than a button inside the Canvas card. The gate is
// unchanged: offered only while a Canvas connection is actually syncing --
// the same gate the Health card applies to "View health data". The query is
// the one the Canvas card already holds; TanStack dedupes the subscription.
function AcademicsSection() {
  const router = useRouter();
  const connectionsQuery = useCanvasConnections();
  const connections = connectionsQuery.data?.items ?? [];
  if (!connections.some((connection) => connection.status === "active")) return null;

  return (
    <>
      <SectionHeader title="Academics" icon="school" />
      <Card padding="none" className="mb-4 px-4">
        <ListRow
          icon="book-open-variant"
          iconTone="info"
          title="View courses"
          chevron
          onPress={() => router.push(ACADEMIC_ROUTE)}
          accessibilityRole="link"
          accessibilityLabel="View courses"
          inset
          last
        />
      </Card>
    </>
  );
}

// Monitoring gets a SUMMARY card in Settings and a full screen of its own, the
// same shape Health uses. A target list belongs on a screen with room for it;
// what Settings owes the user is whether anything is on fire and a way through.
//
// The wording is constrained by ADR-055 and is not a style choice. There is no
// "all systems operational" here, because the backend does not prove that: it
// proves a check ran at a time with an outcome. And a target that has never been
// checked is not up -- which is the state every environment is in today, since
// no target has ever been seeded.
const MONITOR_ROUTE = "/monitor" as Href;

function MonitoringCard() {
  const overview = useMonitorOverview();
  const router = useRouter();

  // Null while the first load is in flight: a skeleton line stands in for
  // the summary (Checkpoint 10.6), and the live region announces it on arrival.
  const summary = overview.isError
    ? "Can't reach Personal OS, so the monitoring status is unknown."
    : overview.data
      ? describeMonitorSummary(overview.data.configured, overview.data.active_incident_count)
      : null;

  const tone = monitorSummaryTone(overview.isError, overview.data?.active_incident_count ?? 0);

  return (
    <Card className="mb-4">
      <ListRow
        icon="monitor-dashboard"
        iconTone={tone === "danger" ? "danger" : "neutral"}
        title="Service monitoring"
        inset
        last
      />
      {summary === null ? <Skeleton width="70%" height={14} className="mt-1" /> : null}
      <AppText
        variant="body"
        tone={tone}
        className="min-h-[20px]"
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
      >
        {summary ?? ""}
      </AppText>
      <AppText variant="caption" tone="muted" className="min-h-[16px]">
        {overview.data && overview.data.configured
          ? `${overview.data.items.length} target${overview.data.items.length === 1 ? "" : "s"}`
          : ""}
      </AppText>
      <ListRow
        title="View monitoring"
        chevron
        onPress={() => router.push(MONITOR_ROUTE)}
        accessibilityLabel="View service monitoring"
        inset
        last
        className="mt-1"
      />
    </Card>
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

// Typed through `Href` for the reason health-today-card.tsx records.
const HEALTH_ROUTE = "/health" as Href;

function ConnectedHealthCard() {
  const router = useRouter();
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
    <Card className="mb-4">
      <ListRow
        icon="heart-pulse"
        iconTone={state === null ? "neutral" : healthConnectionChipTone(state)}
        title="Health"
        trailing={
          state === null ? undefined : (
            <StatusChip label={state.replace(/_/g, " ")} tone={healthConnectionChipTone(state)} />
          )
        }
        inset
        last
      />

      {state === null ? <Skeleton width="70%" height={14} className="mt-1" /> : null}
      <AppText
        variant="body"
        tone="secondary"
        className="min-h-[20px]"
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
      >
        {state === null ? "" : HEALTH_STATUS_TEXT[state]}
      </AppText>

      <AppText variant="caption" tone="muted" className="min-h-[16px]">
        {freshness === null ? "" : healthFreshnessLine(freshness)}
      </AppText>

      {state === "partial_scope" ? (
        // Deliberately no scope URLs on screen -- they are implementation
        // detail and read as noise. Which streams are affected is visible on
        // the /health screen, per metric, where it is actionable.
        <AppText variant="caption" tone="muted" className="mt-1">
          Some data types weren&apos;t granted permission, so those stay empty here.
        </AppText>
      ) : null}

      {/* The single most useful thing a user can know when the dashboard looks
          empty, and Settings is where they will come looking for it. */}
      <AppText variant="caption" tone="muted" className="mt-2">
        Personal OS reads what&apos;s already in Google Health, so a watch or app has to send its
        data there first.
      </AppText>

      {state === "not_configured" ? (
        // Nothing to navigate to, and nothing to offer: connecting is a
        // server-side step this screen deliberately does not perform.
        <AppText variant="body" tone="muted" className="mt-2 min-h-[44px] py-3">
          There&apos;s nothing to show until Google Health is set up on the server.
        </AppText>
      ) : (
        <ListRow
          title="View health data"
          chevron
          onPress={() => router.push(HEALTH_ROUTE)}
          accessibilityRole="link"
          accessibilityLabel="View health data"
          inset
          last
          className="mt-1"
        />
      )}
    </Card>
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
    confirmDestructive({
      title: "Forget this device?",
      message: thisDevice?.is_primary_reminder_device
        ? "This wipes this device's stored credentials and stops its scheduled reminders. It is the PRIMARY reminder device, so no device will schedule reminders until you pair again and choose a new primary."
        : "This wipes this device's stored credentials and stops its scheduled reminders. You'll need to pair again to reconnect.",
      confirmLabel: "Forget",
      onConfirm: () => void forgetThisDevice(),
    });
  };

  // A 401 here almost always means this device's own bearer token was
  // revoked server-side -- the exact case DeviceCard's onThisDeviceRevoked
  // exists to handle, except it never runs because the list itself failed
  // to load. Naming the cause and surfacing the escape hatch here closes
  // that dead end.
  const devicesErrorStatus = error instanceof ApiClientError ? error.status : null;
  const isRevokedSession = devicesErrorStatus === 401;

  return (
    // Not the `Screen` primitive: this screen must express its bottom padding
    // through `contentContainerStyle` alone (the keyboard height is added to
    // it), and floating-layout.ts records why a `contentContainerClassName`
    // must never be set alongside it. So the canvas comes from `ScreenFrame`
    // and the ScrollView stays explicit.
    <ScreenFrame>
      <SafeAreaView className="flex-1">
        <ScrollView
          className="flex-1"
          // Extra room so lower controls can be scrolled clear of the IME --
          // see components/use-keyboard-height.ts for why insets alone don't do it.
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* First on the screen, before any section (ADR-036): when reminders
              cannot fire on this device, that outranks every integration. It
              renders nothing when there is nothing to warn about. */}
          <View className="pt-4">
            <ReminderEligibilityBanner device={thisDevice} />
          </View>

          <SectionHeader title="Integrations" icon="link-variant" />
          {/* Every connection state at a glance, before the cards (10.6). */}
          <IntegrationSummaryRow />
          <ConnectedCanvasCard />
          <ConnectedCalendarsCard />
          <ConnectedMailCard />
          <ConnectedHealthCard />

          <AcademicsSection />

          <SectionHeader title="Monitoring" icon="monitor-dashboard" />
          <MonitoringCard />

          <SectionHeader title="Devices" icon="cellphone" />

          {isLoading ? <SkeletonList rows={2} className="mb-4" /> : null}
          {isError ? (
            isRevokedSession ? (
              <Card className="mb-4" accessibilityRole="alert">
                <ListRow
                  icon="alert"
                  iconTone="warning"
                  title="This device is no longer registered"
                  titleTone="warning"
                  inset
                  last
                />
                <AppText variant="body" tone="secondary">
                  Pair it again to restore reminders and notifications.
                </AppText>
                <Button
                  label="Forget this device"
                  onPress={confirmForgetThisDevice}
                  variant="tonal"
                  block
                  className="mt-3"
                />
              </Card>
            ) : (
              <InlineRetry
                message="Couldn't load devices."
                onRetry={() => void refetch()}
                accessibilityLabel="Retry loading devices"
              />
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

          <Button
            label="Forget this device"
            onPress={confirmForgetThisDevice}
            variant="outline"
            block
          />

          <SectionHeader title="Diagnostics" icon="wrench-outline" />
          <NotificationDiagnostics />
          <OutboxDiagnostics />

          <SectionHeader title="Privacy & AI" icon="shield-outline" />
          {/* Checkpoint 10.8 (ADR-078 §8): what is waiting for approval and the
              way into the Action Center -- first, because nothing runs until
              the owner approves it here. */}
          <ActionsSettingsCard />
          {/* Checkpoint 10.9 (ADR-081 §9): the agents are the principals that
              use actions, so their card follows the Actions card; nothing on
              it leaves the machine. */}
          <AgentsSettingsCard />
          {/* Checkpoint 10.7 (ADR-077): the memory switch and the way into the
              Memory Center -- before Cloud Ask, because nothing here leaves. */}
          <MemorySettingsCard />
          <CloudAskCard />
        </ScrollView>
      </SafeAreaView>
    </ScreenFrame>
  );
}
