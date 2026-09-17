// expo-haptics reaches the native module registry at import; under vitest
// the primitives' `triggerHaptic` is a no-op on web anyway (Platform.OS is
// "web" under react-native-web), so the mock only needs the enums and three
// resolved promises. Aliased in vitest.config.mts.
export const ImpactFeedbackStyle = { Light: "light", Medium: "medium", Heavy: "heavy" } as const;
export const NotificationFeedbackType = {
  Success: "success",
  Warning: "warning",
  Error: "error",
} as const;
export const impactAsync = async (): Promise<void> => {};
export const notificationAsync = async (): Promise<void> => {};
export const selectionAsync = async (): Promise<void> => {};
