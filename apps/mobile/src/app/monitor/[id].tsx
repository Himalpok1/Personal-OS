import { ApiClientError } from "@personal-os/api-client";
import type { MonitorTargetKind, MonitorTargetUpdate } from "@personal-os/schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Switch, TextInput, View } from "react-native";
import { FieldLabel, textFieldClass } from "@/components/ask/text-field";
import { confirmDestructive } from "@/components/confirm-destructive";
import {
  AppText,
  Button,
  Card,
  ErrorState,
  ScreenCentered,
  ScreenFrame,
  SkeletonCard,
  StatusChip,
  useTheme,
} from "@/components/ui";
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
  const { colors } = useTheme();
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

  if (isLoading || (!isError && !target)) {
    return (
      <ScreenFrame>
        <View className="px-4 pt-4">
          <SkeletonCard lines={6} />
        </View>
      </ScreenFrame>
    );
  }

  if (isError || !target) {
    const status = error instanceof ApiClientError ? error.status : null;
    return (
      <ScreenCentered>
        <ErrorState
          title={status === 404 ? "Not found" : "Something went wrong"}
          message={
            status === 404
              ? "This monitor target couldn't be found."
              : "Couldn't load this monitor target."
          }
          // A 404 is terminal -- refetching the same id repeats the same
          // answer -- so the affordance appears only for a failure that could
          // actually clear, matching tasks/[id].tsx's identical convention.
          onRetry={status === 404 ? undefined : () => void refetch()}
          retryAccessibilityLabel="Retry loading this monitor target"
        />
      </ScreenCentered>
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

  const incidentChip =
    activeIncident === null
      ? target.enabled
        ? { label: "Enabled", tone: "success" as const }
        : { label: "Disabled", tone: "neutral" as const }
      : activeIncident.status === "acknowledged"
        ? { label: "Incident acknowledged", tone: "warning" as const }
        : { label: "Incident open", tone: "danger" as const };

  return (
    <ScreenFrame>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-4 flex-row items-center justify-between gap-2">
          <AppText variant="caption" tone="muted" className="flex-1">
            {KIND_LABEL[target.kind]}
          </AppText>
          <StatusChip label={incidentChip.label} tone={incidentChip.tone} dot />
        </View>

        <FieldLabel>Name</FieldLabel>
        <TextInput
          value={name}
          onChangeText={setName}
          accessibilityLabel="Name"
          className={textFieldClass({ extra: "mb-4" })}
        />

        <FieldLabel>Type</FieldLabel>
        <AppText variant="body" className="mb-4">
          {KIND_LABEL[target.kind]}
        </AppText>

        {isHttp ? (
          <>
            <FieldLabel>URL</FieldLabel>
            <TextInput
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="URL"
              className={textFieldClass({ extra: "mb-4" })}
            />

            <FieldLabel>Expected status</FieldLabel>
            <TextInput
              value={expectedStatus}
              onChangeText={(text) => setExpectedStatus(onlyDigits(text))}
              keyboardType="number-pad"
              accessibilityLabel="Expected status"
              className={textFieldClass({ extra: "mb-4" })}
            />

            <View className="mb-4 flex-row items-center justify-between gap-3">
              <AppText variant="body" className="flex-1">
                Also check the health payload
              </AppText>
              <Switch
                value={expectHealthyPayload}
                onValueChange={setExpectHealthyPayload}
                accessibilityLabel="Also check the health payload"
                trackColor={{ true: colors.primary }}
              />
            </View>

            {isHttpsUrl(url) ? (
              <>
                <FieldLabel>Warn before certificate expiry, in days (optional)</FieldLabel>
                <TextInput
                  value={tlsWarnDays}
                  onChangeText={(text) => setTlsWarnDays(onlyDigits(text))}
                  keyboardType="number-pad"
                  placeholder="Not set"
                  placeholderTextColor={placeholderColor}
                  accessibilityLabel="Warn before certificate expiry, in days"
                  className={textFieldClass({ extra: "mb-4" })}
                />
              </>
            ) : null}
          </>
        ) : (
          <>
            <FieldLabel>Max heartbeat age, in seconds (optional)</FieldLabel>
            <TextInput
              value={heartbeatMaxAgeSeconds}
              onChangeText={(text) => setHeartbeatMaxAgeSeconds(onlyDigits(text))}
              keyboardType="number-pad"
              placeholder="Not set"
              placeholderTextColor={placeholderColor}
              accessibilityLabel="Max heartbeat age, in seconds"
              className={textFieldClass({ extra: "mb-4" })}
            />
          </>
        )}

        <FieldLabel>Timeout, in ms</FieldLabel>
        <TextInput
          value={timeoutMs}
          onChangeText={(text) => setTimeoutMs(onlyDigits(text))}
          keyboardType="number-pad"
          accessibilityLabel="Timeout, in ms"
          className={textFieldClass({ extra: "mb-4" })}
        />

        <FieldLabel>Check interval, in seconds</FieldLabel>
        <TextInput
          value={intervalSeconds}
          onChangeText={(text) => setIntervalSeconds(onlyDigits(text))}
          keyboardType="number-pad"
          accessibilityLabel="Check interval, in seconds"
          className={textFieldClass({ extra: "mb-4" })}
        />

        <FieldLabel>Consecutive failures to open an incident</FieldLabel>
        <TextInput
          value={failureThreshold}
          onChangeText={(text) => setFailureThreshold(onlyDigits(text))}
          keyboardType="number-pad"
          accessibilityLabel="Consecutive failures to open an incident"
          className={textFieldClass({ extra: "mb-4" })}
        />

        <FieldLabel>Consecutive successes to resolve one</FieldLabel>
        <TextInput
          value={recoveryThreshold}
          onChangeText={(text) => setRecoveryThreshold(onlyDigits(text))}
          keyboardType="number-pad"
          accessibilityLabel="Consecutive successes to resolve one"
          className={textFieldClass({ extra: "mb-4" })}
        />

        {saveError ? (
          <AppText variant="caption" tone="danger" className="mb-2" accessibilityRole="alert">
            {saveError}
          </AppText>
        ) : null}

        <Button
          label={updateTarget.isPending ? "Saving..." : "Save changes"}
          onPress={submit}
          disabled={updateTarget.isPending}
          accessibilityLabel="Save changes"
          variant="primary"
          icon="content-save-outline"
          block
          className="mb-4"
        />

        <Card padding="sm" className="mb-2 flex-row items-center justify-between gap-3">
          <AppText variant="body" className="flex-1 pl-1">
            Enabled
          </AppText>
          <Switch
            value={target.enabled}
            onValueChange={toggleEnabled}
            disabled={enableTarget.isPending || disableTarget.isPending}
            accessibilityLabel="Enabled"
            trackColor={{ true: colors.primary }}
          />
        </Card>
        {toggleError ? (
          <AppText variant="caption" tone="danger" className="mb-4" accessibilityRole="alert">
            {toggleError}
          </AppText>
        ) : null}

        <Button
          label={archiveTarget.isPending ? "Archiving..." : "Archive monitor"}
          onPress={confirmArchive}
          disabled={archiveTarget.isPending}
          accessibilityLabel="Archive monitor target"
          variant="danger"
          icon="archive-arrow-down-outline"
          block
          className="mt-2"
        />
      </ScrollView>
    </ScreenFrame>
  );
}
