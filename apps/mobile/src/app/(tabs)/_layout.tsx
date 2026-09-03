import { Link, Tabs, type Href } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { UI_TEST_MODE } from "@/config/ui-test-mode";

// A header icon, not a 6th tab -- on the Rabbit R1's 480px-wide screen a
// five/six-item tab bar is cramped (see docs/STATUS.md's Phase 3 plan).
// Shared across every tab via screenOptions rather than repeated per screen.
function SettingsHeaderButton() {
  return (
    <Link href="/settings" asChild>
      <Pressable
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        className="min-h-[44px] justify-center px-3"
      >
        <Text className="text-xl">⚙️</Text>
      </Pressable>
    </Link>
  );
}

// Search is a header action for the same reason Settings is, and the same
// reason Health and Monitoring are Settings cards: the Rabbit R1's 480px tab
// bar already carries five labels, and a sixth would cramp all of them. A
// header action additionally makes search reachable from every tab, which is
// what a global lookup should be.
// `as Href` because expo-router's typed routes are generated from the route
// tree and the generated declaration lags a newly added screen. Same escape
// hatch, for the same reason, as MONITOR_ROUTE in settings.tsx.
const SEARCH_ROUTE = "/search" as Href;

function SearchHeaderButton() {
  return (
    <Link href={SEARCH_ROUTE} asChild>
      <Pressable
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Search"
        className="min-h-[44px] justify-center px-3"
      >
        <Text className="text-xl">🔍</Text>
      </Pressable>
    </Link>
  );
}

// Two actions in one headerRight. There was no prior example of composing
// them -- Settings was the only header action -- so this is the minimal
// divergence: a flex-row wrapper, with each button keeping its own hitSlop and
// accessibility label.
function HeaderActions() {
  return (
    <View className="flex-row items-center">
      <SearchHeaderButton />
      <SettingsHeaderButton />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerRight: UI_TEST_MODE ? undefined : HeaderActions }}>
      <Tabs.Screen name="index" options={{ title: "Today" }} />
      <Tabs.Screen name="inbox" options={{ title: "Inbox" }} />
      <Tabs.Screen name="notes" options={{ title: "Notes" }} />
      <Tabs.Screen name="projects" options={{ title: "Projects" }} />
      <Tabs.Screen name="calendar" options={{ title: "Calendar" }} />
    </Tabs>
  );
}
