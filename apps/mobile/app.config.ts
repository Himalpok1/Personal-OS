import type { ExpoConfig } from "expo/config";

const uiTestMode = process.env.EXPO_PUBLIC_UI_TEST_MODE === "true";

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
    // NOTE (Checkpoint 5.4): there is deliberately no `usesCleartextTraffic`
    // here. Expo's app-config schema has no such android property -- it was
    // set here previously and SILENTLY IGNORED, which is the real root cause
    // of the "Rabbit can't reach the dev API" incident re-diagnosed in
    // Checkpoints 5.1, 5.2 and 5.3 (each time worked around by hand-patching
    // the generated manifest, which android/ being gitignored made invisible
    // in review). UI-test builds talk to a cleartext http://localhost dev API
    // over `adb reverse`, and SDK 36 blocks that without the manifest flag.
    // The supported fix is the expo-build-properties config plugin
    // (`android.usesCleartextTraffic`), which is not currently a dependency;
    // until it is added, a local UI-test pass must patch
    // android/app/src/main/AndroidManifest.xml after prebuild. Production
    // builds must NEVER enable cleartext -- they reach the API over HTTPS
    // via Tailscale.
    ...(!uiTestMode && {
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
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
    "expo-secure-store",
    ...(!uiTestMode ? ["expo-audio"] : []),
    "expo-sqlite",
    ...(!uiTestMode ? ["expo-notifications"] : []),
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
