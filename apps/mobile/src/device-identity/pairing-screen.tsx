import * as Device from "expo-device";
import { useState } from "react";
import { Platform, ScrollView, Text, TextInput, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRegisterDevice } from "@/queries/devices";
import { useDeviceIdentity } from "./provider";

// Rendered by _layout.tsx in place of the whole app whenever no device
// credentials are stored yet. POST /devices is Tailscale-only and requires
// a one-time pairing code generated on the server (see
// apps/api/scripts/generate-pairing-code.ts) -- this screen cannot
// register a device on its own, it only submits what a human already
// generated out of band. See docs/DECISIONS.md for why: a network endpoint
// alone, even Tailscale-gated, was insufficiently protected against a
// revoked-but-still-on-the-tailnet device re-registering itself.
export function PairingScreen() {
  const [name, setName] = useState(Device.deviceName ?? Device.modelName ?? "My device");
  const [pairingCode, setPairingCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { setIdentity } = useDeviceIdentity();
  const register = useRegisterDevice();

  const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";

  const onSubmit = async () => {
    setError(null);
    try {
      const result = await register.mutateAsync({
        name: name.trim(),
        platform,
        pairing_code: pairingCode.trim(),
      });
      await setIdentity({ token: result.token, deviceId: result.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed");
    }
  };

  const canSubmit = name.trim().length > 0 && pairingCode.trim().length > 0 && !register.isPending;

  return (
    // This is the first screen a brand-new device ever sees, so it has to
    // work with the soft keyboard up on the Rabbit R1's 640px-tall display.
    // Unlike quick-add-fab's modal sheet, this screen is not inside a
    // react-native Modal -- it's rendered directly by the root layout in
    // place of the whole app -- so AndroidManifest.xml's
    // android:windowSoftInputMode="adjustResize" on MainActivity genuinely
    // applies here: the window itself shrinks when the keyboard opens. A
    // plain ScrollView is therefore enough to reach every field and the
    // submit button; the measured-keyboard-height padding trick
    // quick-add-fab needs (because adjustResize can't reach into a modal's
    // own window) would be redundant here.
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <ScrollView
        className="flex-1"
        contentContainerClassName="flex-grow justify-center px-5"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="mb-6 text-2xl font-bold text-black dark:text-white">Pair this device</Text>

        <Text className="mb-1 text-sm text-neutral-500">Device name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          className="mb-4 rounded border border-neutral-300 px-3 py-3 text-base text-black dark:border-neutral-700 dark:text-white"
        />

        <Text className="mb-1 text-sm text-neutral-500">Pairing code</Text>
        <TextInput
          value={pairingCode}
          onChangeText={setPairingCode}
          placeholder="XXXX-XXXX"
          autoCapitalize="characters"
          autoCorrect={false}
          className="mb-4 rounded border border-neutral-300 px-3 py-3 text-base text-black dark:border-neutral-700 dark:text-white"
        />

        {error ? <Text className="mb-4 text-red-600">{error}</Text> : null}

        <Pressable
          onPress={onSubmit}
          disabled={!canSubmit}
          className="rounded bg-blue-600 px-4 py-4 disabled:opacity-50"
        >
          <Text className="text-center text-lg font-bold text-white">
            {register.isPending ? "Pairing…" : "Pair device"}
          </Text>
        </Pressable>

        <Text className="mt-4 text-xs text-neutral-500">
          Generate a code on the server with `pnpm --filter api pairing:generate` — it expires in 15
          minutes and works once.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
