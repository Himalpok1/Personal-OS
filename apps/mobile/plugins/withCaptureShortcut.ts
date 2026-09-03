/// <reference types="node" />
import {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withStringsXml,
  type ConfigPlugin,
} from "@expo/config-plugins";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Adds a launcher shortcut ("Capture") that opens the Quick Capture composer.
 *
 * WHY A PLUGIN AT ALL. Expo's app-config schema has `android.intentFilters`
 * (which is why the share sheet needs no plugin) but has NO `android.shortcuts`
 * key -- verified against the installed @expo/config-types' ExpoConfig, whose
 * android block lists intentFilters and never mentions shortcuts. Static
 * shortcuts are a res/xml resource plus an activity meta-data pointer, and
 * neither is expressible in app.config.ts.
 *
 * WHY A CUSTOM ACTION RATHER THAN A DEEP LINK. The obvious alternative is to
 * point the shortcut at `mobile://capture` and let expo-router handle it. That
 * would need a real `/capture` route, but the composer is a global <Modal>
 * mounted in the root layout, not a route -- so the route would exist only to
 * bounce straight back out. Worse, nothing in this app reads an incoming URL
 * today. A custom action reuses the CaptureIntent module already required by
 * the share sheet, including its consume-once semantics, and adds no routing.
 *
 * The action string is duplicated in CaptureIntentModule.kt's companion
 * object; that pairing is asserted by plugins/withCaptureShortcut.test.ts.
 */
// @expo/config-plugins' ManifestActivity declares only `intent-filter`, not
// `meta-data` -- that field is typed on ManifestApplication alone. The XML
// permits it on an activity (and Android REQUIRES it there for shortcuts), so
// the shape is widened locally rather than casting to any at each use.
type ManifestMetaDataItem = { $: Record<string, string> };
type ActivityWithMetaData = { "meta-data"?: ManifestMetaDataItem[] };

export const CAPTURE_SHORTCUT_ACTION = "com.himal.personalos.action.CAPTURE";
const SHORTCUT_ID = "capture";
const SHORTCUTS_META_DATA = "android.app.shortcuts";
const SHORT_LABEL_KEY = "capture_shortcut_short_label";
const LONG_LABEL_KEY = "capture_shortcut_long_label";

export function buildShortcutsXml(androidPackage: string): string {
  // android:targetClass is the package's own MainActivity, exactly as Expo
  // generates it -- `.MainActivity` relative to the application id.
  return `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <shortcut
    android:shortcutId="${SHORTCUT_ID}"
    android:enabled="true"
    android:icon="@mipmap/ic_launcher"
    android:shortcutShortLabel="@string/${SHORT_LABEL_KEY}"
    android:shortcutLongLabel="@string/${LONG_LABEL_KEY}">
    <intent
      android:action="${CAPTURE_SHORTCUT_ACTION}"
      android:targetPackage="${androidPackage}"
      android:targetClass="${androidPackage}.MainActivity" />
  </shortcut>
</shortcuts>
`;
}

const withCaptureShortcut: ConfigPlugin = (config) => {
  // 1. The labels a static shortcut requires as string resources -- Android
  //    rejects a literal for shortcutShortLabel.
  config = withStringsXml(config, (cfg) => {
    cfg.modResults = AndroidConfig.Strings.setStringItem(
      [
        { $: { name: SHORT_LABEL_KEY, translatable: "false" }, _: "Capture" },
        { $: { name: LONG_LABEL_KEY, translatable: "false" }, _: "New quick capture" },
      ],
      cfg.modResults,
    );
    return cfg;
  });

  // 2. The resource itself.
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const androidPackage = cfg.android?.package;
      if (!androidPackage) {
        throw new Error("withCaptureShortcut: android.package must be set");
      }
      const xmlDir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml",
      );
      await fs.mkdir(xmlDir, { recursive: true });
      await fs.writeFile(
        path.join(xmlDir, "shortcuts.xml"),
        buildShortcutsXml(androidPackage),
        "utf8",
      );
      return cfg;
    },
  ]);

  // 3. The pointer. This meta-data must sit on the LAUNCHER activity, not on
  //    <application> -- Android reads android.app.shortcuts from the activity
  //    that declares MAIN/LAUNCHER, so addMetaDataItemToMainApplication is the
  //    wrong helper here.
  config = withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(
      cfg.modResults,
    ) as unknown as ActivityWithMetaData;
    const metaData = (activity["meta-data"] ??= []);
    // Idempotent: prebuild re-runs against an already-patched manifest, the
    // same hazard withHardwareInputBridge.ts guards with a content sniff.
    const existing = metaData.find((item) => item.$["android:name"] === SHORTCUTS_META_DATA);
    if (existing) {
      existing.$["android:resource"] = "@xml/shortcuts";
      return cfg;
    }
    metaData.push({
      $: { "android:name": SHORTCUTS_META_DATA, "android:resource": "@xml/shortcuts" },
    });
    return cfg;
  });

  return config;
};

export { withCaptureShortcut };
export default withCaptureShortcut;
