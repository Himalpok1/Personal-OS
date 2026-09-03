import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Checkpoint 8.4. The two Android capture front doors are wired across four
 * files that no compiler cross-checks: a Kotlin module, its TypeScript
 * declaration, a config plugin, and app.config.ts. Every string below is
 * duplicated by necessity, and a drift in any of them fails SILENTLY -- the
 * share sheet simply stops offering Personal OS, or the shortcut opens the app
 * without opening the composer. Neither shows up as an error anywhere.
 *
 * This is the same class of structural guard as no-raw-console.test.ts and
 * Checkpoint 8.3's mobile-inert-rendering.test.ts.
 */
const MOBILE_ROOT = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(MOBILE_ROOT, rel), "utf8");

const KOTLIN = read(
  "modules/capture-intent/android/src/main/java/expo/modules/captureintent/CaptureIntentModule.kt",
);
const MODULE_CONFIG = read("modules/capture-intent/expo-module.config.json");
const TS_MODULE = read("modules/capture-intent/src/CaptureIntentModule.ts");
const TYPES = read("modules/capture-intent/src/CaptureIntent.types.ts");
const PLUGIN = read("plugins/withCaptureShortcut.ts");
const APP_CONFIG = read("app.config.ts");

function firstMatch(source: string, pattern: RegExp): string {
  const found = pattern.exec(source);
  expect(found, `no match for ${String(pattern)}`).not.toBeNull();
  return found![1]!;
}

describe("capture-intent native contract", () => {
  it("uses the same shortcut action string in Kotlin and in the config plugin", () => {
    const kotlin = firstMatch(KOTLIN, /const val ACTION_COMPOSE = "([^"]+)"/);
    const plugin = firstMatch(PLUGIN, /CAPTURE_SHORTCUT_ACTION = "([^"]+)"/);
    expect(kotlin).toBe(plugin);
    // A shortcut whose action the module does not recognise opens the app and
    // does nothing, which is indistinguishable from a normal launch.
    expect(kotlin).toBe("com.himal.personalos.action.CAPTURE");
  });

  it("registers the Kotlin class under the fully-qualified name the module config declares", () => {
    const pkg = firstMatch(KOTLIN, /^package ([\w.]+)/m);
    const cls = firstMatch(KOTLIN, /^class (\w+) : Module\(\)/m);
    expect(MODULE_CONFIG).toContain(`${pkg}.${cls}`);
  });

  it("uses the same native module name in Kotlin and in requireNativeModule", () => {
    const kotlinName = firstMatch(KOTLIN, /Name\("([^"]+)"\)/);
    const tsName = firstMatch(TS_MODULE, /requireNativeModule<\w+>\("([^"]+)"\)/);
    expect(kotlinName).toBe(tsName);
  });

  it("declares the same event name in Kotlin, in sendEvent, and in the TS event map", () => {
    const declared = firstMatch(KOTLIN, /Events\("([^"]+)"\)/);
    expect(KOTLIN).toContain(`sendEvent("${declared}"`);
    expect(TYPES).toContain(`${declared}:`);
  });

  it("exposes the consume function the hook calls, under one name", () => {
    expect(KOTLIN).toContain('Function("consumePendingCaptureIntent")');
    expect(TS_MODULE).toContain("consumePendingCaptureIntent()");
  });

  it("declares the ACTION_SEND text/plain filter for the production identity only", () => {
    expect(APP_CONFIG).toMatch(/action:\s*"SEND"/);
    expect(APP_CONFIG).toMatch(/mimeType:\s*"text\/plain"/);
    // Gated, so a UI-test build does not put a second Personal OS in the
    // share sheet -- same reasoning as googleServicesFile above it.
    expect(APP_CONFIG).toMatch(/!uiTestMode\s*&&\s*\{\s*intentFilters:/);
  });

  it("registers the shortcut plugin, gated the same way", () => {
    expect(APP_CONFIG).toMatch(/!uiTestMode\s*\?\s*\["\.\/plugins\/withCaptureShortcut\.ts"\]/);
  });

  it("keeps the module Android-only, matching the two existing local modules", () => {
    expect(JSON.parse(MODULE_CONFIG).platforms).toEqual(["android"]);
  });

  it("consumes rather than reads: the sticky launch intent is neutered natively", () => {
    // Without this, process death plus restore from Recents re-delivers the
    // same share and captures it a second time with a different client_uuid.
    expect(KOTLIN).toContain("neutralize(launchIntent)");
    expect(KOTLIN).toMatch(/intent\.removeExtra\(Intent\.EXTRA_TEXT\)/);
    expect(KOTLIN).toMatch(/intent\.action = Intent\.ACTION_MAIN/);
  });

  it("reads the warm-start intent from the OnNewIntent argument, never activity.intent", () => {
    // React Native's ReactActivity.onNewIntent never calls setIntent(), so
    // activity.intent stays the ORIGINAL launch intent for the Activity's
    // whole life -- using it on the warm path silently replays the old share.
    const onNewIntent = /OnNewIntent \{ intent ->([\s\S]*?)\n    \}/.exec(KOTLIN);
    expect(onNewIntent).not.toBeNull();
    expect(onNewIntent![1]).not.toContain("currentActivity");
  });
});
