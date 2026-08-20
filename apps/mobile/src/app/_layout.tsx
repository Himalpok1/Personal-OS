import "@/global.css";

import { QuickAddFab } from "@/components/quick-add-fab";
import { DeviceIdentityProvider, useDeviceIdentity } from "@/device-identity/provider";
import { PairingScreen } from "@/device-identity/pairing-screen";
import { useReminderReconciliation } from "@/notifications/use-reminder-reconciliation";
import { useNotificationLifecycle } from "@/notifications/use-notification-lifecycle";
import { usePushTokenRegistration } from "@/notifications/use-push-token-registration";
import { useOutboxFlushOnReconnect } from "@/outbox/use-outbox-flush-on-reconnect";
import { PttButton } from "@/ptt/ptt-button";
import { UI_TEST_MODE } from "@/config/ui-test-mode";
import { queryClient } from "@/queries/client";
import { useQueryLifecycle } from "@/queries/use-query-lifecycle";
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
  if (UI_TEST_MODE) return <UiTestContent />;
  return <ProductionContent />;
}

function ProductionContent() {
  const { identity, isLoading } = useDeviceIdentity();
  // Called unconditionally, above the early returns below, per the rules
  // of hooks -- the hook itself is a no-op until identity/tasks are
  // available (see use-reminder-reconciliation.ts).
  useReminderReconciliation();
  useNotificationLifecycle();
  usePushTokenRegistration();
  useOutboxFlushOnReconnect();
  useQueryLifecycle();

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
        <Stack.Screen name="events/[id]" options={{ title: "Event" }} />
        <Stack.Screen name="events/new" options={{ title: "New Event" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="hardware-debug" options={{ title: "Hardware spike" }} />
      </Stack>
      {/* Global, reachable from every screen -- see decision 5 in
          docs/STATUS.md's Phase 2 entry. */}
      <QuickAddFab />
      <PttButton />
    </View>
  );
}

// A deliberately capability-minimal shell for the temporary side-by-side
// Rabbit layout build. It bypasses device identity entirely and never mounts
// pairing, push, reminder, outbox, notification, PTT, or quick-add lifecycles.
function UiTestContent() {
  useQueryLifecycle();

  return (
    <View style={{ flex: 1 }}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="events/[id]" options={{ title: "Event" }} />
        <Stack.Screen name="events/new" options={{ title: "New Event" }} />
      </Stack>
    </View>
  );
}
