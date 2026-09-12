import { ApiClientError } from "@personal-os/api-client";
import type { MonitorTargetKind, MonitorTargetUpdate } from "@personal-os/schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { confirmDestructive } from "@/components/confirm-destructive";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import {
  describeMonitorTargetMutationFailure,
  isHttpsUrl,
  monitorTargetFormFieldsToPayload,
  onlyDigits,
} from "@/components/monitor/target-form";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import {
  useArchiveMonitorTarget,
  useDisableMonitorTarget,
  useEnableMonitorTarget,
  useMonitorOverview,
  useMonitorTarget,
  useUpdateMonitorTarget,
} from "@/queries/monitor";

// Detail/edit screen for Checkpoint 8.6D's monitor CRUD. Mirrors
// apps/mobile/src/app/tasks/[id].tsx's shape: load-error-empty states, a
// "Save changes" button wired to a general PATCH, a Switch wired to its OWN
// dedicated endpoint rather than the general save, and an Archive button
// gated by confirmDestructive.
//
// DELIBERATE DEVIATION FROM THE BRIEF'S "YOUR CALL": `kind` IS READ-ONLY HERE.
// The brief allows either choice, since the server enforces correctness
// either way. Kind is shown as plain text rather than the create screen's
// chip picker -- changing what a target measures (an HTTP probe vs. a
// worker's heartbeat row) after the fact is unusual enough that offering it
// as a casual edit invites exactly the kind of accidental change
// `target_has_active_incident`'s 409 already exists to guard against for
// url/kind. If it's ever genuinely needed, archiving and recreating the
// target is the honest path today.

const KIND_LABEL: Record<MonitorTargetKind, string> = {
  http: "HTTP",
  worker_heartbeat: "Worker heartbeat",
};

export default function MonitorTargetDetailScreen() {
  const keyboardHeight = useKeyboardHeight();
  const placeholderColor = usePlaceholderColor();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: target, isLoading, isError, error, refetch } = useMonitorTarget(id);
  // The overview cache is the cheapest way to learn whether THIS target has
  // an open incident right now, without a second dedicated endpoint --
  // useEnableMonitorTarget/useDisableMonitorTarget invalidate the same
  // ["monitor"] prefix this reads from, so it stays in sync with every
  // mutation on this screen.
  const overview = useMonitorOverview();
  const updateTarget = useUpdateMonitorTarget();
  const enableTarget = useEnableMonitorTarget();
  const disableTarget = useDisableMonitorTarget();
  const archiveTarget = useArchiveMonitorTarget();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [expectedStatus, setExpectedStatus] = useState("");
  const [expectHealthyPayload, setExpectHealthyPayload] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState("");
  const [failureThreshold, setFailureThreshold] = useState("");
  const [recoveryThreshold, setRecoveryThreshold] = useState("");
  const [tlsWarnDays, setTlsWarnDays] = useState("");
  const [heartbeatMaxAgeSeconds, setHeartbeatMaxAgeSeconds] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setName(target.name);
    setUrl(target.url ?? "");
    setExpectedStatus(String(target.expected_status));
    setExpectHealthyPayload(target.expect_healthy_payload);
    setTimeoutMs(String(target.timeout_ms));
    setIntervalSeconds(String(target.interval_seconds));
    setFailureThreshold(String(target.failure_threshold));
    setRecoveryThreshold(String(target.recovery_threshold));
    setTlsWarnDays(target.tls_warn_days === null ? "" : String(target.tls_warn_days));
    setHeartbeatMaxAgeSeconds(
      target.heartbeat_max_age_seconds === null ? "" : String(target.heartbeat_max_age_seconds),
    );
  }, [target]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    const status = error instanceof ApiClientError ? error.status : null;
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white px-4 dark:bg-black">
        <Text className="text-red-600">
          {status === 404
            ? "This monitor target couldn't be found."
            : "Couldn't load this monitor target."}
        </Text>
        {/* A 404 is terminal -- refetching the same id repeats the same
            answer -- so the affordance appears only for a failure that could
            actually clear, matching tasks/[id].tsx's identical convention. */}
        {status === 404 ? null : (
          <Pressable
            onPress={() => void refetch()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading this monitor target"
            className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="font-semibold text-white">Retry</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (!target) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  const isHttp = target.kind === "http";
  const activeIncident =
    overview.data?.items.find((item) => item.target.id === target.id)?.active_incident ?? null;

  const submit = () => {
    setSaveError(null);
    const patch: MonitorTargetUpdate = monitorTargetFormFieldsToPayload({
      kind: target.kind,
      url,
      expectedStatus,
      expectHealthyPayload,
      timeoutMs,
      intervalSeconds,
      failureThreshold,
      recoveryThreshold,
      tlsWarnDays,
      heartbeatMaxAgeSeconds,
    });
    if (name.trim().length > 0) patch.name = name.trim();
    updateTarget.mutate(
      { id: target.id, patch },
      { onError: (err) => setSaveError(describeMonitorTargetMutationFailure(err)) },
    );
  };

  // The plain toggle (no open incident) is instant, matching how
  // `sync_enabled` toggles work elsewhere in this app -- see settings.tsx's
  // GoogleCalendarRow/CaldavCalendarConnectionCard Switches. Only the
  // open-incident case gets a confirmDestructive dialog first, because
  // disabling then does NOT resolve the incident and that is easy to assume
  // otherwise.
  const toggleEnabled = (next: boolean) => {
    const run = () => {
      setToggleError(null);
      const mutation = next ? enableTarget : disableTarget;
      mutation.mutate(target.id, {
        onError: (err) => setToggleError(describeMonitorTargetMutationFailure(err)),
      });
    };
    if (!next && activeIncident !== null) {
      confirmDestructive({
        title: "Disable this target?",
        message:
          "This target has an open incident. Disabling stops future checks, but the incident will stay open -- it won't resolve on its own until you re-enable this target and it recovers, or you acknowledge it from the monitor list.",
        confirmLabel: "Disable",
        onConfirm: run,
      });
      return;
    }
    run();
  };

  const confirmArchive = () => {
    confirmDestructive({
      title: "Archive this monitor target?",
      message:
        "This removes it from your monitor list. Its check and incident history is kept, not deleted, but there's currently no way to un-archive it from the app.",
      confirmLabel: "Archive",
      onConfirm: () => archiveTarget.mutate(target.id, { onSuccess: () => router.back() }),
    });
  };

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerStyle={{ padding: 16, paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight }}
      keyboardShouldPersistTaps="handled"
    >
      <Text className="mb-1 text-sm text-neutral-500">Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Type</Text>
      <Text className="mb-4 text-black dark:text-white">{KIND_LABEL[target.kind]}</Text>

      {isHttp ? (
        <>
          <Text className="mb-1 text-sm text-neutral-500">URL</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
          />

          <Text className="mb-1 text-sm text-neutral-500">Expected status</Text>
          <TextInput
            value={expectedStatus}
            onChangeText={(text) => setExpectedStatus(onlyDigits(text))}
            keyboardType="number-pad"
            className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
          />

          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-black dark:text-white">Also check the health payload</Text>
            <Switch
              value={expectHealthyPayload}
              onValueChange={setExpectHealthyPayload}
              accessibilityLabel="Also check the health payload"
            />
          </View>

          {isHttpsUrl(url) ? (
            <>
              <Text className="mb-1 text-sm text-neutral-500">
                Warn before certificate expiry, in days (optional)
              </Text>
              <TextInput
                value={tlsWarnDays}
                onChangeText={(text) => setTlsWarnDays(onlyDigits(text))}
                keyboardType="number-pad"
                placeholder="Not set"
                placeholderTextColor={placeholderColor}
                className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
              />
            </>
          ) : null}
        </>
      ) : (
        <>
          <Text className="mb-1 text-sm text-neutral-500">
            Max heartbeat age, in seconds (optional)
          </Text>
          <TextInput
            value={heartbeatMaxAgeSeconds}
            onChangeText={(text) => setHeartbeatMaxAgeSeconds(onlyDigits(text))}
            keyboardType="number-pad"
            placeholder="Not set"
            placeholderTextColor={placeholderColor}
            className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
          />
        </>
      )}

      <Text className="mb-1 text-sm text-neutral-500">Timeout, in ms</Text>
      <TextInput
        value={timeoutMs}
        onChangeText={(text) => setTimeoutMs(onlyDigits(text))}
        keyboardType="number-pad"
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Check interval, in seconds</Text>
      <TextInput
        value={intervalSeconds}
        onChangeText={(text) => setIntervalSeconds(onlyDigits(text))}
        keyboardType="number-pad"
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">
        Consecutive failures to open an incident
      </Text>
      <TextInput
        value={failureThreshold}
        onChangeText={(text) => setFailureThreshold(onlyDigits(text))}
        keyboardType="number-pad"
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Consecutive successes to resolve one</Text>
      <TextInput
        value={recoveryThreshold}
        onChangeText={(text) => setRecoveryThreshold(onlyDigits(text))}
        keyboardType="number-pad"
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      {saveError ? <Text className="mb-2 text-red-600">{saveError}</Text> : null}

      <Pressable
        onPress={submit}
        disabled={updateTarget.isPending}
        accessibilityRole="button"
        accessibilityLabel="Save changes"
        className="mb-4 items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
      >
        <Text className="font-semibold text-white">
          {updateTarget.isPending ? "Saving..." : "Save changes"}
        </Text>
      </Pressable>

      <View className="mb-2 flex-row items-center justify-between rounded-lg border border-neutral-300 p-3 dark:border-neutral-700">
        <Text className="text-black dark:text-white">Enabled</Text>
        <Switch
          value={target.enabled}
          onValueChange={toggleEnabled}
          disabled={enableTarget.isPending || disableTarget.isPending}
          accessibilityLabel="Enabled"
        />
      </View>
      {toggleError ? <Text className="mb-4 text-red-600">{toggleError}</Text> : null}

      <Pressable
        onPress={confirmArchive}
        disabled={archiveTarget.isPending}
        accessibilityRole="button"
        accessibilityLabel="Archive monitor target"
        className="mt-2 items-center rounded-lg bg-neutral-100 py-3 dark:bg-neutral-800"
      >
        <Text className="font-semibold text-neutral-600 dark:text-neutral-300">
          {archiveTarget.isPending ? "Archiving..." : "Archive monitor"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
