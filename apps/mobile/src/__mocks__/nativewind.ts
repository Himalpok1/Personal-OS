// NativeWind's published entry point is not transformed by the mobile vitest
// setup (node_modules are left alone), and importing it throws
// `SyntaxError: Unexpected token 'typeof'` before a single test runs -- it
// takes the whole suite file down, not just the assertion.
//
// Nothing under test depends on NativeWind's runtime: className strings are
// inert props in these tests, and the only hook the app calls is
// `useColorScheme`. Mocking it here follows the same route already taken for
// `expo-router` in this directory, aliased in vitest.config.mts.
//
// Light is the right default: it is what an unstyled test render implies, and
// it keeps `usePlaceholderColor` returning a deterministic value.
export const useColorScheme = () => ({
  colorScheme: "light" as const,
  setColorScheme: () => {},
  toggleColorScheme: () => {},
});

export const cssInterop = () => {};
export const remapProps = () => {};
export const verifyInstallation = () => {};

// Checkpoint 10.3: components/ui/web-color-scheme.ts calls this once at boot
// on web; under vitest it must simply exist.
export const colorScheme = {
  set: (_value: "light" | "dark" | "system") => {},
  get: () => "light" as const,
  toggle: () => {},
};
