import type { MonitorTargetCreate, MonitorTargetKind } from "@personal-os/schema";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
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
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerStyle={{ padding: 16, paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight }}
      keyboardShouldPersistTaps="handled"
    >
      <Text className="mb-1 text-sm text-neutral-500">Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. API health"
        placeholderTextColor={placeholderColor}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Type</Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {KIND_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => setKind(option.value)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === option.value }}
            className={
              kind === option.value
                ? "min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-blue-600 px-3 py-1"
                : "min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800"
            }
          >
            <Text className={kind === option.value ? "text-white" : "text-black dark:text-white"}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {isHttp ? (
        <>
          <Text className="mb-1 text-sm text-neutral-500">URL</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://example.com/health"
            placeholderTextColor={placeholderColor}
            autoCapitalize="none"
            autoCorrect={false}
            className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
          />

          <Text className="mb-1 text-sm text-neutral-500">Expected status (optional)</Text>
          <TextInput
            value={expectedStatus}
            onChangeText={(text) => setExpectedStatus(onlyDigits(text))}
            keyboardType="number-pad"
            placeholder="200"
            placeholderTextColor={placeholderColor}
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
                placeholder="e.g. 14"
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
            placeholder="e.g. 3600"
            placeholderTextColor={placeholderColor}
            className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
          />
        </>
      )}

      <Text className="mb-1 text-sm text-neutral-500">Timeout, in ms (optional)</Text>
      <TextInput
        value={timeoutMs}
        onChangeText={(text) => setTimeoutMs(onlyDigits(text))}
        keyboardType="number-pad"
        placeholder="10000"
        placeholderTextColor={placeholderColor}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Check interval, in seconds (optional)</Text>
      <TextInput
        value={intervalSeconds}
        onChangeText={(text) => setIntervalSeconds(onlyDigits(text))}
        keyboardType="number-pad"
        placeholder="300"
        placeholderTextColor={placeholderColor}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">
        Consecutive failures to open an incident (optional)
      </Text>
      <TextInput
        value={failureThreshold}
        onChangeText={(text) => setFailureThreshold(onlyDigits(text))}
        keyboardType="number-pad"
        placeholder="3"
        placeholderTextColor={placeholderColor}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">
        Consecutive successes to resolve one (optional)
      </Text>
      <TextInput
        value={recoveryThreshold}
        onChangeText={(text) => setRecoveryThreshold(onlyDigits(text))}
        keyboardType="number-pad"
        placeholder="2"
        placeholderTextColor={placeholderColor}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      {submitError ? <Text className="mb-2 text-red-600">{submitError}</Text> : null}

      <Pressable
        onPress={submit}
        disabled={createTarget.isPending || !canSubmit}
        accessibilityRole="button"
        accessibilityLabel="Create monitor target"
        className="items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
      >
        <Text className="font-semibold text-white">
          {createTarget.isPending ? "Creating…" : "Create monitor"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
