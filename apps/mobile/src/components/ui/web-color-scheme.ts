// Web dark mode (Checkpoint 10.3).
//
// tailwind.config.js pins `darkMode: "class"`, so on web every `dark:` class
// compiles to a `.dark` descendant selector, and react-native-css-interop's
// web runtime (runtime/web/color-scheme.js) decides what NativeWind's
// `useColorScheme` reports like this: if the compiled stylesheet's
// `--css-interop-darkMode: class dark` flag is readable when the runtime
// module first evaluates, the scheme is PINNED to whether `<html>` already
// carries the `dark` class -- which static HTML never does -- so the hook
// answers "light" forever and nothing ever follows the OS preference. That
// is exactly the exported build the web container serves (stylesheet
// `<link>` in `<head>`, bundle deferred). Only the dev server, which injects
// the CSS after the bundle, takes the runtime's other branch and follows
// `prefers-color-scheme`.
//
// Two steps, both web-only (native resolves `dark:` against Appearance
// itself and needs nothing):
//   1. once at boot, `colorScheme.set("system")` -- the runtime's own API for
//      "clear the pinned value and follow Appearance", which react-native-web
//      backs with `prefers-color-scheme` and its change events;
//   2. keep the `dark` class on `<html>` in step with what the hook then
//      reports, so the compiled selectors match.
// Verified on a static export of this build under `prefers-color-scheme:
// dark` (the 10.3 review found step 2 alone was a dev-server-only fix).
import { colorScheme as nativewindColorScheme } from "nativewind";
import { useEffect } from "react";
import { Platform } from "react-native";
import type { ColorScheme } from "./theme";

export function applyWebColorSchemeClass(scheme: ColorScheme): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", scheme === "dark");
}

let followedSystem = false;

/** Step 1: make the web runtime follow the OS preference instead of its boot-time pin. Idempotent. */
export function followSystemColorSchemeOnWeb(): void {
  if (Platform.OS !== "web" || typeof document === "undefined" || followedSystem) return;
  followedSystem = true;
  try {
    nativewindColorScheme.set("system");
  } catch {
    // `set` throws under the `media` strategy or outside a browser; neither
    // applies here, and a throw must never take the app root down.
  }
}

export function useSyncWebColorSchemeClass(scheme: ColorScheme): void {
  useEffect(() => {
    followSystemColorSchemeOnWeb();
  }, []);
  useEffect(() => {
    applyWebColorSchemeClass(scheme);
  }, [scheme]);
}
