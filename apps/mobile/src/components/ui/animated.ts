// Animated, class-styled hosts (Checkpoint 10.6).
//
// NativeWind's interop wraps `View`, `Text`, `Pressable` and the other core
// components at JSX time: `<Pressable className>` becomes an element whose
// type is the interop wrapper, which resolves the class string into a
// `style` and renders the real Pressable. Reanimated's `Animated.View`
// (`createAnimatedComponent(View)`) is NOT one of those wrapped types, so a
// `className` on it is silently dropped -- the rule every 10.3 primitive
// already follows by styling animated nodes through `style` only.
//
// A press-scale on a card or button needs BOTH on one node: the class
// string that gives the card its surface, radius and layout (`flex-1`,
// `absolute`, `flex-row` -- contracts every screen already relies on) and the
// animated transform. Registering the animated component with `cssInterop`
// looks like the answer and is the wrong way round: on native the interop
// spreads the inline `style` into a plain object, so Reanimated's animated-
// style marker survives while the class-derived styles are discarded by its
// props filter (the surface vanishes). The right way round is to animate the
// INTEROP-WRAPPED component: Reanimated forwards `className` down untouched,
// the interop resolves it, and the animated transform is applied natively by
// view tag on top -- the same path as `createAnimatedComponent(Pressable)`,
// with one transparent forwardRef in between.
//
// The wrapped component is resolved through NativeWind's public
// `createInteropElement`, exactly as the JSX runtime does, rather than by
// re-registering `Pressable` (which would replace the global registration).
// Under vitest the nativewind mock's `createInteropElement` is React's own
// `createElement` and the reanimated mock's `createAnimatedComponent` is the
// identity, so these ARE `Pressable` and `View` there -- a tree-walking test
// sees the host type it already knows.
import Animated from "react-native-reanimated";
import { createInteropElement } from "nativewind";
import { Pressable, View } from "react-native";

function interopType<C>(component: C): C {
  const element = createInteropElement(
    component as unknown as Parameters<typeof createInteropElement>[0],
    {},
  ) as unknown as { type: C };
  return element.type;
}

/** A Pressable that takes both `className` and an animated `style`. */
export const AnimatedPressable = Animated.createAnimatedComponent(interopType(Pressable));

/** A View that takes both `className` and `entering`/`exiting`/`layout`. */
export const AnimatedView = Animated.createAnimatedComponent(interopType(View));
