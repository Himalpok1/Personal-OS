import { focusManager } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";

// React Native does not emit browser focus events. Bridge AppState so
// refetchOnWindowFocus actually means foreground refetch on native.
export function useQueryLifecycle(): void {
  useEffect(() => {
    if (Platform.OS === "web") return;
    focusManager.setFocused(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) => {
      focusManager.setFocused(state === "active");
    });
    return () => subscription.remove();
  }, []);
}
