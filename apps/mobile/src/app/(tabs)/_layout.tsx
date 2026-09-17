import { Link, Tabs, type Href } from "expo-router";
import { Platform, Pressable, View, type ColorValue } from "react-native";
import { UI_TEST_MODE } from "@/config/ui-test-mode";
import { Icon, useTheme, type IconName } from "@/components/ui";

// Header actions (Checkpoint 10.3: Material icons through the design
// system's Icon, replacing the emoji glyphs). Settings and Search are header
// icons, not a 6th/7th tab -- on the Rabbit R1's 480px-wide screen a
// five/six-item tab bar is cramped (see docs/STATUS.md's Phase 3 plan), and
// a header action makes search reachable from every tab, which is what a
// global lookup should be.
//
// `as Href` because expo-router's typed routes are generated from the route
// tree and the generated declaration lags a newly added screen. Same escape
// hatch, for the same reason, as MONITOR_ROUTE in settings.tsx.
const SEARCH_ROUTE = "/search" as Href;

function HeaderIconLink({ href, icon, label }: { href: Href; icon: IconName; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={label}
        className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
      >
        <Icon name={icon} size="lg" tone="on-surface" />
      </Pressable>
    </Link>
  );
}

// Two actions in one headerRight: a flex-row wrapper, with each button keeping
// its own hitSlop and accessibility label.
function HeaderActions() {
  return (
    <View className="mr-1 flex-row items-center">
      <HeaderIconLink href={SEARCH_ROUTE} icon="magnify" label="Search" />
      <HeaderIconLink href="/settings" icon="cog-outline" label="Settings" />
    </View>
  );
}

const TAB_ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  index: { active: "view-dashboard", inactive: "view-dashboard-outline" },
  inbox: { active: "inbox", inactive: "inbox-outline" },
  notes: { active: "note-text", inactive: "note-text-outline" },
  projects: { active: "folder", inactive: "folder-outline" },
  calendar: { active: "calendar-month", inactive: "calendar-month-outline" },
};

function tabIcon(name: keyof typeof TAB_ICONS) {
  const icons = TAB_ICONS[name];
  return function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    // react-navigation types `color` as ColorValue; the tab bar only ever
    // hands the tint strings set on screenOptions above.
    return <Icon name={focused ? icons.active : icons.inactive} size={24} color={String(color)} />;
  };
}

export default function TabsLayout() {
  const { colors, scheme } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerRight: UI_TEST_MODE ? undefined : HeaderActions,
        headerStyle: { backgroundColor: colors.canvas },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "700", color: colors["on-surface"] },
        headerTintColor: colors["on-surface"],
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors["on-surface-muted"],
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.outline,
          // A hairline on the light canvas; the outline alone is enough in the
          // dark one.
          borderTopWidth: scheme === "dark" ? 1 : 0.5,
          // Android's default 49px bar leaves the label nearly touching the
          // icon; web has no home indicator to clear.
          ...(Platform.OS === "web" ? { height: 56 } : {}),
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      {/* Checkpoint 10.3: Today draws its own in-flow header (the greeting
          is the title, Search and Settings sit beside it), so the navigator
          bar would only repeat it. Every other tab keeps the bar. */}
      <Tabs.Screen
        name="index"
        options={{ title: "Today", headerShown: false, tabBarIcon: tabIcon("index") }}
      />
      <Tabs.Screen name="inbox" options={{ title: "Inbox", tabBarIcon: tabIcon("inbox") }} />
      <Tabs.Screen name="notes" options={{ title: "Notes", tabBarIcon: tabIcon("notes") }} />
      <Tabs.Screen
        name="projects"
        options={{ title: "Projects", tabBarIcon: tabIcon("projects") }}
      />
      <Tabs.Screen
        name="calendar"
        options={{ title: "Calendar", tabBarIcon: tabIcon("calendar") }}
      />
    </Tabs>
  );
}
