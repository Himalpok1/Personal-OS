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
    ...(uiTestMode && { usesCleartextTraffic: true }),
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
