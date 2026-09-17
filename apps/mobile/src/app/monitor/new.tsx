import type { MonitorTargetCreate, MonitorTargetKind } from "@personal-os/schema";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { ScrollView, Switch, TextInput, View } from "react-native";
import { ChoiceChip } from "@/components/ask/choice-chip";
import { FieldLabel, textFieldClass } from "@/components/ask/text-field";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { AppText, Button, ScreenFrame, useTheme } from "@/components/ui";
import {
  describeMonitorTargetMutationFailure,
  isHttpsUrl,
  monitorTargetFormFieldsToPayload,
  onlyDigits,
} from "@/components/monitor/target-form";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { useCreateMonitorTarget } from "@/queries/monitor";

// Create form for Checkpoint 8.6D's monitor CRUD. Field set and styling
// deliberately mirror apps/mobile/src/app/tasks/new.tsx: labeled TextInputs,
// a chip-style picker for the one closed choice (`kind`), a single generic
// mutation-error line, and a primary submit button that disables while
// pending or while the form is incomplete.
//
// Maintenance windows and `muted_until` are DELIBERATELY OMITTED here --
// they are advanced/rare fields the server defaults to null/unset, which is
// a perfectly valid target, and the brief for this checkpoint explicitly
// allows leaving them out of the create form to keep it from growing past
// "smallest complete CRUD". They can be added later as their own pass if a
// real need for them shows up.

const KIND_OPTIONS: { value: MonitorTargetKind; label: string }[] = [
  { value: "http", label: "HTTP" },
  { value: "worker_heartbeat", label: "Worker heartbeat" },
];

export default function NewMonitorTargetScreen() {
  const keyboardHeight = useKeyboardHeight();
  const placeholderColor = usePlaceholderColor();
  const { colors } = useTheme();
  const router = useRouter();
  const createTarget = useCreateMonitorTarget();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<MonitorTargetKind>("http");
  const [url, setUrl] = useState("");
  const [expectedStatus, setExpectedStatus] = useState("");
  const [expectHealthyPayload, setExpectHealthyPayload] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState("");
  const [failureThreshold, setFailureThreshold] = useState("");
  const [recoveryThreshold, setRecoveryThreshold] = useState("");
  const [tlsWarnDays, setTlsWarnDays] = useState("");
  const [heartbeatMaxAgeSeconds, setHeartbeatMaxAgeSeconds] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isHttp = kind === "http";
  const canSubmit = name.trim().length > 0 && (!isHttp || url.trim().length > 0);

  const submit = () => {
    if (!canSubmit) return;
    setSubmitError(null);
    const body: MonitorTargetCreate = {
      name: name.trim(),
      kind,
      ...monitorTargetFormFieldsToPayload({
        kind,
        url,
        expectedStatus,
        expectHealthyPayload,
        timeoutMs,
        intervalSeconds,
        failureThreshold,
        recoveryThreshold,
        tlsWarnDays,
        heartbeatMaxAgeSeconds,
      }),
    };
    createTarget.mutate(body, {
      // `as Href`: same escape hatch as MONITOR_ROUTE in settings.tsx --
      // expo-router's generated typed-routes declaration lags a newly added
      // screen.
      onSuccess: (created) => router.replace(`/monitor/${created.id}` as Href),
      onError: (err) => setSubmitError(describeMonitorTargetMutationFailure(err)),
    });
  };

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
        <FieldLabel>Name</FieldLabel>
        <TextInput
          accessibilityLabel="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. API health"
          placeholderTextColor={placeholderColor}
          className={textFieldClass({ extra: "mb-4" })}
        />

        <FieldLabel>Type</FieldLabel>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {KIND_OPTIONS.map((option) => (
            <ChoiceChip
              key={option.value}
              label={option.label}
              selected={kind === option.value}
              onPress={() => setKind(option.value)}
              accessibilityLabel={`Type: ${option.label}`}
            />
          ))}
        </View>

        {isHttp ? (
          <>
            <FieldLabel>URL</FieldLabel>
            <TextInput
              accessibilityLabel="URL"
              value={url}
              onChangeText={setUrl}
              placeholder="https://example.com/health"
              placeholderTextColor={placeholderColor}
              autoCapitalize="none"
              autoCorrect={false}
              className={textFieldClass({ extra: "mb-4" })}
            />

            <FieldLabel>Expected status (optional)</FieldLabel>
            <TextInput
              accessibilityLabel="Expected status"
              value={expectedStatus}
              onChangeText={(text) => setExpectedStatus(onlyDigits(text))}
              keyboardType="number-pad"
              placeholder="200"
              placeholderTextColor={placeholderColor}
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
                  accessibilityLabel="Warn before certificate expiry, in days"
                  value={tlsWarnDays}
                  onChangeText={(text) => setTlsWarnDays(onlyDigits(text))}
                  keyboardType="number-pad"
                  placeholder="e.g. 14"
                  placeholderTextColor={placeholderColor}
                  className={textFieldClass({ extra: "mb-4" })}
                />
              </>
            ) : null}
          </>
        ) : (
          <>
            <FieldLabel>Max heartbeat age, in seconds (optional)</FieldLabel>
            <TextInput
              accessibilityLabel="Max heartbeat age, in seconds"
              value={heartbeatMaxAgeSeconds}
              onChangeText={(text) => setHeartbeatMaxAgeSeconds(onlyDigits(text))}
              keyboardType="number-pad"
              placeholder="e.g. 3600"
              placeholderTextColor={placeholderColor}
              className={textFieldClass({ extra: "mb-4" })}
            />
          </>
        )}

        <FieldLabel>Timeout, in ms (optional)</FieldLabel>
        <TextInput
          accessibilityLabel="Timeout, in ms"
          value={timeoutMs}
          onChangeText={(text) => setTimeoutMs(onlyDigits(text))}
          keyboardType="number-pad"
          placeholder="10000"
          placeholderTextColor={placeholderColor}
          className={textFieldClass({ extra: "mb-4" })}
        />

        <FieldLabel>Check interval, in seconds (optional)</FieldLabel>
        <TextInput
          accessibilityLabel="Check interval, in seconds"
          value={intervalSeconds}
          onChangeText={(text) => setIntervalSeconds(onlyDigits(text))}
          keyboardType="number-pad"
          placeholder="300"
          placeholderTextColor={placeholderColor}
          className={textFieldClass({ extra: "mb-4" })}
        />

        <FieldLabel>Consecutive failures to open an incident (optional)</FieldLabel>
        <TextInput
          accessibilityLabel="Consecutive failures to open an incident"
          value={failureThreshold}
          onChangeText={(text) => setFailureThreshold(onlyDigits(text))}
          keyboardType="number-pad"
          placeholder="3"
          placeholderTextColor={placeholderColor}
          className={textFieldClass({ extra: "mb-4" })}
        />

        <FieldLabel>Consecutive successes to resolve one (optional)</FieldLabel>
        <TextInput
          accessibilityLabel="Consecutive successes to resolve one"
          value={recoveryThreshold}
          onChangeText={(text) => setRecoveryThreshold(onlyDigits(text))}
          keyboardType="number-pad"
          placeholder="2"
          placeholderTextColor={placeholderColor}
          className={textFieldClass({ extra: "mb-4" })}
        />

        {submitError ? (
          <AppText variant="caption" tone="danger" className="mb-2" accessibilityRole="alert">
            {submitError}
          </AppText>
        ) : null}

        <Button
          label={createTarget.isPending ? "Creating…" : "Create monitor"}
          onPress={submit}
          disabled={createTarget.isPending || !canSubmit}
          accessibilityLabel="Create monitor target"
          variant="primary"
          icon="plus"
          block
        />
      </ScrollView>
    </ScreenFrame>
  );
}
