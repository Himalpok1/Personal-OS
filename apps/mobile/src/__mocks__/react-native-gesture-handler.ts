// react-native-gesture-handler installs a native gesture system at import
// (and its web build assumes a DOM the vitest environment does not have).
// Under test every gesture surface is inert: the root view is a plain View,
// a swipeable renders its children and never opens an action panel, and the
// `Gesture` builder is a chainable no-op. Aliased in vitest.config.mts for
// both the package root and the `react-native-gesture-handler/
// ReanimatedSwipeable` subpath `SwipeableRow` imports (the alias for the
// subpath is listed FIRST there, because a prefix alias would otherwise
// rewrite it to a path inside this file).
import { createElement, type ReactNode } from "react";
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";

export function GestureHandlerRootView(props: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return createElement(View, { style: props.style }, props.children);
}

export interface SwipeableMethods {
  close: () => void;
  openLeft: () => void;
  openRight: () => void;
  reset: () => void;
}

/**
 * The swipeable stand-in keeps the `renderLeftActions`/`renderRightActions`
 * props on its element so a test can assert which panels a row offers, but
 * renders only its children -- the panels exist on a device alone.
 */
export function ReanimatedSwipeable(props: {
  children?: ReactNode;
  renderLeftActions?: unknown;
  renderRightActions?: unknown;
  [key: string]: unknown;
}) {
  return createElement(View, null, props.children);
}

export const Swipeable = ReanimatedSwipeable;

const chain = new Proxy(
  {},
  {
    get: () => () => chain,
  },
) as Record<string, (...args: unknown[]) => unknown>;

export const Gesture = {
  Pan: () => chain,
  Tap: () => chain,
  LongPress: () => chain,
  Native: () => chain,
  Simultaneous: () => chain,
  Exclusive: () => chain,
  Race: () => chain,
};

export function GestureDetector(props: { children?: ReactNode }) {
  return props.children ?? null;
}

export { Pressable, ScrollView };

export default ReanimatedSwipeable;
