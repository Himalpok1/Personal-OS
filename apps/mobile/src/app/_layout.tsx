import "@/global.css";

import { QuickAddFab } from "@/components/quick-add-fab";
import { DeviceIdentityProvider, useDeviceIdentity } from "@/device-identity/provider";
import { PairingScreen } from "@/device-identity/pairing-screen";
import { queryClient } from "@/queries/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
// NativeWind's own useColorScheme, not react-native's -- under the default
// 'media' dark-mode strategy, react-native-css-interop's patched hook
// throws ("Cannot manually set color scheme...") if the raw RN hook is
// read instead, since only NativeWind's own hook is wired to that
// strategy's read path without triggering a set.
import { useColorScheme } from "nativewind";
import { SafeAreaView, Text, View } from "react-native";

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  return (
    <QueryClientProvider client={queryClient}>
      <DeviceIdentityProvider>
        <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
          <RootContent />
        </ThemeProvider>
      </DeviceIdentityProvider>
    </QueryClientProvider>
  );
}

// The whole-app gate: no stored device credentials means the pairing
// screen renders in place of everything else, including the tab
// navigator. See device-identity/provider.tsx.
function RootContent() {
  const { identity, isLoading } = useDeviceIdentity();

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Text className="text-neutral-500">Loading…</Text>
      </SafeAreaView>
    );
  }

  if (!identity) {
    return <PairingScreen />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="tasks/[id]" options={{ title: "Task" }} />
        <Stack.Screen name="tasks/new" options={{ title: "New Task" }} />
        <Stack.Screen name="notes/[id]" options={{ title: "Note" }} />
        <Stack.Screen name="notes/new" options={{ title: "New Note" }} />
        <Stack.Screen name="projects/[id]" options={{ title: "Project" }} />
        <Stack.Screen name="projects/new" options={{ title: "New Project" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="hardware-debug" options={{ title: "Hardware spike" }} />
      </Stack>
      {/* Global, reachable from every screen -- see decision 5 in
          docs/STATUS.md's Phase 2 entry. */}
      <QuickAddFab />
    </View>
  );
}
