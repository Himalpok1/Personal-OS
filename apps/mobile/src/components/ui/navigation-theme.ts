// React Navigation theme objects built from the palette (Checkpoint 10.3),
// so the stack/tab chrome (header, tab bar, screen background) matches the
// canvas and surfaces the screens themselves draw.
// expo-router vendors react-navigation and re-exports its theme objects and
// type (see node_modules/expo-router/build/exports.d.ts); there is no
// @react-navigation/native package for this app to import from.
import { DarkTheme, DefaultTheme, type Theme } from "expo-router";
import { colorsForScheme, type ColorScheme } from "./theme";

export function navigationTheme(scheme: ColorScheme): Theme {
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const c = colorsForScheme(scheme);
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: c.primary,
      background: c.canvas,
      card: c.surface,
      text: c["on-surface"],
      border: c.outline,
      notification: c.accent,
    },
  };
}
