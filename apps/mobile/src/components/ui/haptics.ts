// Haptic feedback, safely (Checkpoint 10.3).
//
// One function the primitives call on a meaningful tap -- a primary button, a
// completion, a destructive confirm -- never on plain navigation, so the
// device does not buzz on every row. It is a no-op on web (expo-haptics has
// nothing to drive there) and swallows a rejected promise on a device whose
// vibrator is disabled or absent (the Rabbit R1 reports one, but this must
// never turn a tap into an unhandled rejection).
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export type HapticKind = "light" | "medium" | "success" | "warning" | "error" | "selection";

export function triggerHaptic(kind: HapticKind = "light"): void {
  if (Platform.OS === "web") return;
  void run(kind).catch(() => {});
}

async function run(kind: HapticKind): Promise<void> {
  switch (kind) {
    case "light":
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    case "medium":
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    case "success":
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    case "warning":
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    case "error":
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    case "selection":
      return Haptics.selectionAsync();
  }
}
