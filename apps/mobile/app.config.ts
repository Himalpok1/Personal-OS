import type { ExpoConfig } from "expo/config";

const uiTestMode = process.env.EXPO_PUBLIC_UI_TEST_MODE === "true";

// Defence in depth for the one link a repo audit cannot see: EXPO_PUBLIC_UI_TEST_MODE
// could in principle be set on the EAS dashboard for the `production` environment,
// which would silently produce a production-profile build carrying the UI-test
// identity and cleartext traffic. Nothing in this repo sets it that way, but the
// dashboard is outside the repo, so fail the build loudly rather than trust it.
const easBuildProfile = process.env.EAS_BUILD_PROFILE;
if (uiTestMode && easBuildProfile?.toLowerCase().startsWith("production")) {
  throw new Error(
    `Refusing to build: EXPO_PUBLIC_UI_TEST_MODE=true with EAS profile "${easBuildProfile}". ` +
      "The UI-test identity enables cleartext traffic and must never ship as production.",
  );
}

type ExpoPlugin = NonNullable<ExpoConfig["plugins"]>[number];

// UI-test builds reach a cleartext http://localhost dev API over `adb reverse`,
// which SDK 36 blocks without this manifest attribute. Absent entirely from the
// production config, so production's native generation is unchanged --
// production reaches the API over HTTPS via Tailscale and must NEVER enable
// cleartext. (expo-build-properties writes nothing for a property it is not
// given, so no other native output moves either.)
const uiTestOnlyPlugins: ExpoPlugin[] = uiTestMode
  ? [["expo-build-properties", { android: { usesCleartextTraffic: true } }]]
  : [];

const config: ExpoConfig = {
  name: uiTestMode ? "Personal OS UI Test" : "mobile",
  slug: "mobile",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: uiTestMode ? "personal-os-ui-test" : "mobile",
  userInterfaceStyle: "automatic",
  ios: {
    icon: "./assets/expo.icon",
  },
  android: {
    package: uiTestMode ? "com.himal.personalos.dev" : "com.himal.personalos",
    // Cleartext traffic is NOT configured here: Expo's app-config schema has
    // no `android.usesCleartextTraffic` property, and setting one was silently
    // ignored for three checkpoints (the real root cause of the recurring
    // "Rabbit can't reach the dev API" incident). It is configured through the
    // expo-build-properties plugin below, for UI-test builds only.
    ...(!uiTestMode && {
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
    }),
    // Android share sheet (Checkpoint 8.4). Gated on the production identity
    // for the same reason googleServicesFile is above: leaving it ungated
    // would put a second, near-identical "Personal OS" entry in the share
    // sheet whenever a UI-test build is installed alongside.
    //
    // Unlike `android.usesCleartextTraffic` (see the comment above, which
    // records three checkpoints lost to a property Expo's schema does not
    // have), `intentFilters` IS in the schema -- @expo/config-types'
    // ExpoConfig declares it, and @expo/config-plugins' IntentFilters.js
    // renders `action` as android.intent.action.SEND, `category` as
    // android.intent.category.DEFAULT and `data.mimeType` as
    // android:mimeType. Verified against the installed packages, not assumed.
    ...(!uiTestMode && {
      intentFilters: [
        { action: "SEND", category: ["DEFAULT"], data: [{ mimeType: "text/plain" }] },
      ],
    }),
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: "single",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#208AEF",
        image: "./assets/images/splash-icon.png",
        imageWidth: 76,
      },
    ],
    "./plugins/withHardwareInputBridge.ts",
    // Launcher shortcut into Quick Capture (Checkpoint 8.4). Production only,
    // for the same reason the share-sheet intentFilters above are: two
    // near-identical "Capture" shortcuts on one device is worse than none.
    ...(!uiTestMode ? ["./plugins/withCaptureShortcut.ts"] : []),
    "expo-secure-store",
    ...(!uiTestMode ? ["expo-audio"] : []),
    "expo-sqlite",
    ...(!uiTestMode ? ["expo-notifications"] : []),
    ...uiTestOnlyPlugins,
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    ...(!uiTestMode && {
      eas: {
        projectId: "b704be80-5b01-411e-9239-fa0cea642783",
      },
    }),
  },
  owner: "himal_pok",
};

export default config;
