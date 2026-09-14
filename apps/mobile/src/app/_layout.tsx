import "@/global.css";

import { QuickAddFab } from "@/components/quick-add-fab";
import { DeviceIdentityProvider, useDeviceIdentity } from "@/device-identity/provider";
import { PairingScreen } from "@/device-identity/pairing-screen";
import { useReminderReconciliation } from "@/notifications/use-reminder-reconciliation";
import { useNotificationLifecycle } from "@/notifications/use-notification-lifecycle";
import { useCaptureShortcutNotification } from "@/notifications/use-capture-shortcut-notification";
import { usePushTokenRegistration } from "@/notifications/use-push-token-registration";
import { useOutboxFlushOnReconnect } from "@/outbox/use-outbox-flush-on-reconnect";
import { PttButton } from "@/ptt/ptt-button";
import { UI_TEST_MODE, assertUiTestPackageIsolation } from "@/config/ui-test-mode";
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
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Application from "expo-application";

// Fail fast, at import, if the JS bundle's UI-test flag disagrees with the
// native applicationId. See config/ui-test-mode.ts -- both builds share
// SecureStore key names, so the package boundary is the only thing keeping the
// UI-test identity away from the real device's bearer token.
assertUiTestPackageIsolation(Application.applicationId ?? null);

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  return (
    // SafeAreaProvider is required by react-native-safe-area-context's
    // SafeAreaView, which quick-add-fab.tsx has consumed since Phase 3 -- it
    // was never actually mounted, so those insets silently resolved to zero.
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <DeviceIdentityProvider>
          <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
            <RootContent />
          </ThemeProvider>
        </DeviceIdentityProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
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
  useCaptureShortcutNotification();
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
      <AppStack />
      {/* Global, reachable from every screen -- see decision 5 in
          docs/STATUS.md's Phase 2 entry. */}
      <QuickAddFab />
      <PttButton />
    </View>
  );
}

// One route table, shared by both shells. Previously the UI-test branch
// declared only 3 of these, so every other pushed screen rendered with a
// filename-derived title -- which made the layout build unrepresentative of
// the thing it was supposed to verify.
function AppStack() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="tasks/index" options={{ title: "Tasks" }} />
      <Stack.Screen name="tasks/[id]" options={{ title: "Task" }} />
      <Stack.Screen name="tasks/new" options={{ title: "New Task" }} />
      <Stack.Screen name="notes/[id]" options={{ title: "Note" }} />
      {/* Checkpoint 9.3: one captured item, reached from an Inbox row, a
          confirmation push, or the capture follow-through banner. */}
      <Stack.Screen name="inbox/[id]" options={{ title: "Capture" }} />
      <Stack.Screen name="notes/new" options={{ title: "New Note" }} />
      <Stack.Screen name="projects/[id]" options={{ title: "Project" }} />
      <Stack.Screen name="projects/new" options={{ title: "New Project" }} />
      <Stack.Screen name="events/[id]" options={{ title: "Event" }} />
      <Stack.Screen name="events/new" options={{ title: "New Event" }} />
      {/* Declared here rather than inline per render branch, matching every
          other stack route (Checkpoint 5.6). */}
      <Stack.Screen name="reviews/daily" options={{ title: "Daily review" }} />
      <Stack.Screen name="reviews/weekly" options={{ title: "Weekly review" }} />
      {/* Phase 6 Checkpoint 6.4. Health is reached from a Settings card, not a
          sixth tab: the Rabbit R1's 480px bar already carries five labels, and
          Health is a read-only view of one connection rather than a daily
          driver like Today or Inbox. */}
      <Stack.Screen name="health/index" options={{ title: "Health" }} />
      <Stack.Screen name="health/trends/[metric]" options={{ title: "Trend" }} />
      <Stack.Screen name="health/sleep" options={{ title: "Sleep" }} />
      <Stack.Screen name="health/workouts" options={{ title: "Workouts" }} />
      {/* Phase 7 Checkpoint 7.6. Reached from a Settings card, not a sixth tab
          -- the Rabbit R1's 480px bar already carries five labels, and the same
          reasoning that kept Health off it applies here. */}
      <Stack.Screen name="monitor/index" options={{ title: "Monitoring" }} />
      {/* Checkpoint 8.6D CRUD, reached from the monitor list above -- not a
          new entry point of their own. */}
      <Stack.Screen name="monitor/new" options={{ title: "New monitor" }} />
      <Stack.Screen name="monitor/[id]" options={{ title: "Monitor target" }} />
      {/* Phase 8 Checkpoint 8.3. Reached from a header action on every tab,
          not a sixth tab -- same 480px reasoning as Health and Monitoring. */}
      <Stack.Screen name="search/index" options={{ title: "Search" }} />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
      <Stack.Screen name="hardware-debug" options={{ title: "Hardware spike" }} />
    </Stack>
  );
}

// The side-by-side Rabbit layout build. It must LOOK like production -- that is
// the entire point of a layout-verification identity, and until Checkpoint 5.6
// it did not, which is why FAB/PTT clearance had never been verified on real
// hardware. What it must never do is act like production:
//
//   mounted   -- the full route table, the tab bar, QuickAddFab (its captures
//                go to the local dev API, which assertUiTestApiIsolation
//                already pins to loopback/RFC1918), and PttButton in
//                layoutOnly mode: real geometry and styling, inert on tap.
//   NOT mounted -- device identity and pairing, reminder reconciliation,
//                notification lifecycle, push-token registration, background
//                outbox flushing. The build also ships no expo-audio or
//                expo-notifications config plugin and no EAS projectId, so
//                there is no microphone permission and no push capability to
//                mount even if this shell asked for one.
function UiTestContent() {
  useQueryLifecycle();

  return (
    <View style={{ flex: 1 }}>
      <AppStack />
      <QuickAddFab />
      <PttButton layoutOnly />
    </View>
  );
}
