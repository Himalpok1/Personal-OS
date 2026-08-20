import { Link, Tabs } from "expo-router";
import { Pressable, Text } from "react-native";
import { UI_TEST_MODE } from "@/config/ui-test-mode";

// A header icon, not a 6th tab -- on the Rabbit R1's 480px-wide screen a
// five/six-item tab bar is cramped (see docs/STATUS.md's Phase 3 plan).
// Shared across every tab via screenOptions rather than repeated per screen.
function SettingsHeaderButton() {
  return (
    <Link href="/settings" asChild>
      <Pressable hitSlop={12} className="px-3">
        <Text className="text-xl">⚙️</Text>
      </Pressable>
    </Link>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerRight: UI_TEST_MODE ? undefined : SettingsHeaderButton }}>
      <Tabs.Screen name="index" options={{ title: "Tasks" }} />
      <Tabs.Screen name="inbox" options={{ title: "Inbox" }} />
      <Tabs.Screen name="notes" options={{ title: "Notes" }} />
      <Tabs.Screen name="projects" options={{ title: "Projects" }} />
      <Tabs.Screen name="calendar" options={{ title: "Calendar" }} />
    </Tabs>
  );
}
