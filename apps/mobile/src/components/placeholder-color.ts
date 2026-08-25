import { useColorScheme } from "nativewind";

/**
 * The one placeholder colour for every text input in the app.
 *
 * Twenty-two inputs hardcoded `placeholderTextColor="#888"`, which computes to
 * about 3.6:1 on the light background -- below WCAG AA's 4.5:1 for body text --
 * and, unlike every surrounding class, carried no dark-mode variant at all.
 *
 * These two values are the nearest neutrals that clear 4.5:1 against the
 * backgrounds actually used: `#737373` (neutral-500) on white is ~4.7:1, and
 * `#a3a3a3` (neutral-400) on the dark surface is ~7.4:1.
 *
 * NativeWind's `useColorScheme` rather than React Native's: under the default
 * `media` strategy the interop runtime throws on its own internal `.set()`, so
 * `tailwind.config.js` pins `darkMode: "class"` and NativeWind's hook is the one
 * that reads that state (see app/_layout.tsx).
 */
export const PLACEHOLDER_LIGHT = "#737373";
export const PLACEHOLDER_DARK = "#a3a3a3";

export function usePlaceholderColor(): string {
  const { colorScheme } = useColorScheme();
  return colorScheme === "dark" ? PLACEHOLDER_DARK : PLACEHOLDER_LIGHT;
}
