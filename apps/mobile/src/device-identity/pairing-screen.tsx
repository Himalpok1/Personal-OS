import * as Device from "expo-device";
import { useState } from "react";
import { Platform, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { AppText, Button, Card, GradientCard, Icon, ScreenFrame } from "@/components/ui";
import { useRegisterDevice } from "@/queries/devices";
import { useDeviceIdentity } from "./provider";

// The one text-input style on this screen: an inset well on the card, in
// the design system's surface-container role (the same vocabulary Settings'
// forms use). Layout-only classes plus the token roles.
const INPUT_CLASS =
  "rounded-inner bg-surface-container px-3 py-3 text-body text-on-surface dark:bg-surface-container-dark dark:text-on-surface-dark";

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
  const placeholderColor = usePlaceholderColor();

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
    // own window) would be redundant here. `ScreenCentered` is a plain View,
    // so the centring lives on this ScrollView's content container instead.
    <ScreenFrame>
      <SafeAreaView className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow justify-center px-4 py-6"
          keyboardShouldPersistTaps="handled"
        >
          <GradientCard gradient="soft" className="mb-4">
            <View className="flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-container dark:bg-primary-container-dark">
                <Icon name="cellphone-link" size="lg" tone="on-primary-container" />
              </View>
              <View className="flex-1">
                <AppText variant="headline" accessibilityRole="header">
                  Pair this device
                </AppText>
              </View>
            </View>
          </GradientCard>

          <Card>
            <AppText variant="overline" tone="muted" className="mb-1">
              Device name
            </AppText>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholderTextColor={placeholderColor}
              accessibilityLabel="Device name"
              className={`${INPUT_CLASS} mb-4`}
            />

            <AppText variant="overline" tone="muted" className="mb-1">
              Pairing code
            </AppText>
            <TextInput
              value={pairingCode}
              onChangeText={setPairingCode}
              placeholder="XXXX-XXXX"
              placeholderTextColor={placeholderColor}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Pairing code"
              className={`${INPUT_CLASS} mb-4`}
            />

            {error ? (
              <View className="mb-4 flex-row items-center gap-2" accessibilityRole="alert">
                <Icon name="alert-circle-outline" size="sm" tone="danger" />
                <AppText variant="body" tone="danger" className="flex-1">
                  {error}
                </AppText>
              </View>
            ) : null}

            <Button
              label="Pair this device"
              onPress={() => void onSubmit()}
              busy={register.isPending}
              disabled={!canSubmit}
              block
            />

            <AppText variant="caption" tone="muted" className="mt-4">
              Generate a code on the server with `pnpm --filter api pairing:generate` — it expires
              in 15 minutes and works once.
            </AppText>
          </Card>
        </ScrollView>
      </SafeAreaView>
    </ScreenFrame>
  );
}
