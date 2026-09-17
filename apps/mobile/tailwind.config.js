// Checkpoint 10.3: the semantic colour, type and radius tokens every UI
// primitive in src/components/ui/ is built from. There is ONE palette,
// src/components/ui/tokens.js: Tailwind requires it here at build time to
// mint class names, and src/components/ui/theme.ts re-exports the same object
// (typed) for the handful of places that must hand a raw colour to a `style`
// prop -- gradients, chart strokes, navigator theming, placeholder text.
// theme.test.ts pins this config's `extend` to that object and pins the
// contrast contract every role must keep.
//
// Every token comes in a light value and a `-dark` sibling; primitives apply
// them as `bg-surface dark:bg-surface-dark`, so a screen that composes
// primitives never writes a `dark:` variant of its own.
const { tokens } = require("./src/components/ui/tokens.js");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  // "class" not the default "media": react-native-css-interop's web runtime
  // syncs OS preference into a class via its own MutationObserver-driven
  // colorScheme.set() -- under "media" that set() call throws
  // unconditionally ("Cannot manually set color scheme, as dark mode is
  // type 'media'"), which crashes app boot on web. "class" still follows
  // the OS preference automatically (the interop runtime keeps toggling the
  // class in response to prefers-color-scheme), it just does so through a
  // code path the library actually supports.
  darkMode: "class",
  theme: {
    extend: {
      colors: tokens.colors,
      fontSize: tokens.fontSize,
      borderRadius: tokens.borderRadius,
      boxShadow: tokens.boxShadow,
    },
  },
  plugins: [],
};
