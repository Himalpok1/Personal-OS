import { useColorScheme } from "nativewind";
import { tokens } from "./ui/tokens";

/**
 * The one placeholder colour for every text input in the app.
 *
 * Twenty-two inputs hardcoded `placeholderTextColor="#888"`, which computes to
 * about 3.6:1 on the light background -- below WCAG AA's 4.5:1 for body text --
 * and, unlike every surrounding class, carried no dark-mode variant at all.
 *
 * The two values are the palette's `placeholder` role, pinned ≥ 4.5:1 on every
 * surface an input is drawn on by components/ui/theme.test.ts.
 *
 * NativeWind's `useColorScheme` rather than React Native's: under the default
 * `media` strategy the interop runtime throws on its own internal `.set()`, so
 * `tailwind.config.js` pins `darkMode: "class"` and NativeWind's hook is the one
 * that reads that state (see app/_layout.tsx).
 */
// Checkpoint 10.3: the values are the palette's `placeholder` role (tokens.js),
// chosen to clear 4.5:1 on the `surface-container` well every text input now
// sits on -- the old `#737373` was tuned for white and read 4.16:1 there.
export const PLACEHOLDER_LIGHT = tokens.colors.placeholder.DEFAULT;
export const PLACEHOLDER_DARK = tokens.colors.placeholder.dark;

export function usePlaceholderColor(): string {
  const { colorScheme } = useColorScheme();
  return colorScheme === "dark" ? PLACEHOLDER_DARK : PLACEHOLDER_LIGHT;
}
