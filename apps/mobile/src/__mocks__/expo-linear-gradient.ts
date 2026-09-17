// expo-linear-gradient's entry point pulls in expo-modules-core's native
// registry, which the mobile vitest setup (react-native → react-native-web,
// node_modules untransformed) cannot load. Nothing under test depends on a
// gradient actually painting: the component is a View that carries its
// `colors` prop, so tree-walking tests can still assert which preset a card
// chose. Aliased in vitest.config.mts, like expo-router and nativewind.
import { createElement, type ReactNode } from "react";
import { View } from "react-native";

export function LinearGradient(props: {
  colors: readonly string[];
  children?: ReactNode;
  className?: string;
  style?: unknown;
  start?: unknown;
  end?: unknown;
}) {
  const { children, ...rest } = props;
  return createElement(View, rest as Record<string, unknown>, children);
}
