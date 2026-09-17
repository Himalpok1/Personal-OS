// Runtime access to the design tokens (Checkpoint 10.3).
//
// Tailwind class names cover almost everything; this module exists for the
// few places a raw colour string is unavoidable -- a gradient's stops, a chart
// stroke, a navigator's theme object, a `placeholderTextColor`, an icon's
// `color` prop -- so those places read the SAME palette the classes compile
// from rather than a hand-typed hex. tokens.js is the single source; this
// file only adds types and the scheme-aware lookup.
import { useColorScheme } from "nativewind";
import { tokens, type ColorRole, type GradientName } from "./tokens";

export type { ColorRole, GradientName };
export type ColorScheme = "light" | "dark";

/** Every colour role resolved for one scheme. */
export type ResolvedColors = Record<ColorRole, string>;

function resolve(scheme: ColorScheme): ResolvedColors {
  const out = {} as ResolvedColors;
  for (const role of Object.keys(tokens.colors) as ColorRole[]) {
    const pair = tokens.colors[role];
    out[role] = scheme === "dark" ? pair.dark : pair.DEFAULT;
  }
  return out;
}

export const LIGHT_COLORS: ResolvedColors = resolve("light");
export const DARK_COLORS: ResolvedColors = resolve("dark");

export function colorsForScheme(scheme: ColorScheme): ResolvedColors {
  return scheme === "dark" ? DARK_COLORS : LIGHT_COLORS;
}

/** A gradient preset's two stops for one scheme. */
export function gradientForScheme(name: GradientName, scheme: ColorScheme): [string, string] {
  const preset = tokens.gradients[name];
  return scheme === "dark" ? preset.dark : preset.light;
}

/**
 * The resolved palette for the current scheme. NativeWind's `useColorScheme`,
 * not React Native's, for the reason app/_layout.tsx records (the interop
 * runtime's `class` strategy is only readable through NativeWind's own hook).
 */
export function useTheme(): { scheme: ColorScheme; colors: ResolvedColors } {
  const { colorScheme } = useColorScheme();
  const scheme: ColorScheme = colorScheme === "dark" ? "dark" : "light";
  return { scheme, colors: colorsForScheme(scheme) };
}

/** The gradient stops for a preset under the current scheme. */
export function useGradient(name: GradientName): [string, string] {
  const { scheme } = useTheme();
  return gradientForScheme(name, scheme);
}

/** The raw token table, for tests. */
export { tokens };
