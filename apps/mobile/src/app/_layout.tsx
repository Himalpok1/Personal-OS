import "@/global.css";

import { QuickAddFab } from "@/components/quick-add-fab";
import { queryClient } from "@/queries/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
// NativeWind's own useColorScheme, not react-native's -- under the default
// 'media' dark-mode strategy, react-native-css-interop's patched hook
// throws ("Cannot manually set color scheme...") if the raw RN hook is
// read instead, since only NativeWind's own hook is wired to that
// strategy's read path without triggering a set.
import { useColorScheme } from "nativewind";
import { View } from "react-native";

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <View style={{ flex: 1 }}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="tasks/[id]" options={{ title: "Task" }} />
            <Stack.Screen name="tasks/new" options={{ title: "New Task" }} />
            <Stack.Screen name="notes/[id]" options={{ title: "Note" }} />
            <Stack.Screen name="notes/new" options={{ title: "New Note" }} />
            <Stack.Screen name="projects/[id]" options={{ title: "Project" }} />
            <Stack.Screen name="projects/new" options={{ title: "New Project" }} />
          </Stack>
          {/* Global, reachable from every screen -- see decision 5 in
              docs/STATUS.md's Phase 2 entry. */}
          <QuickAddFab />
        </View>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
