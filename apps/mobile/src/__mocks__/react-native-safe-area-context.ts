// react-native-safe-area-context's entry point is untransformed ESM under the
// mobile vitest setup and throws `Unexpected token 'typeof'` at import, the
// same way nativewind does. `Screen` (components/ui/screen.tsx) reads the
// top inset from it, and the ui barrel is imported by most component tests,
// so the module is aliased here. Insets are zero -- exactly what web reports.
import { createElement, type ReactNode } from "react";
import { View } from "react-native";

export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
export const SafeAreaView = (props: { children?: ReactNode }) =>
  createElement(View, props as Record<string, unknown>, props.children);
export const SafeAreaProvider = ({ children }: { children?: ReactNode }) => children;
