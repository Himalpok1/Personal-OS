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
    extend: {},
  },
  plugins: [],
};
