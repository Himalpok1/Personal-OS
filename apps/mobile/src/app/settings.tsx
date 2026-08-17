import type { Device } from "@personal-os/schema";
import { useDeviceIdentity } from "@/device-identity/provider";
import { useDevices, useRevokeDevice, useSetPrimaryDevice, useUpdateDevice } from "@/queries/devices";
import { Pressable, SafeAreaView, ScrollView, Switch, Text, View } from "react-native";

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
