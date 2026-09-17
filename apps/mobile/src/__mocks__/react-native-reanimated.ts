// react-native-reanimated reaches the worklets runtime and a native module at
// import, neither of which exists under the mobile vitest setup. Checkpoint
// 10.6's motion primitives are written so that this mock makes them PURE:
// every Reanimated hook here is a plain function (`useSharedValue` is a box,
// `useAnimatedStyle` calls its worklet once), so a component that uses only
// Reanimated hooks can still be invoked directly by the tree-walking tests
// with no React dispatcher attached. A component that ALSO needs a React hook
// (useEffect, useSyncExternalStore) is a thin leaf the tests treat as a host
// type instead. Aliased in vitest.config.mts, like expo-router and nativewind.
//
// `Animated.View`/`Text`/`ScrollView` resolve to react-native's own, so a
// tree-walk sees `View` where the app draws an animated one, and `entering`/
// `exiting`/`layout` are inert props. The animation builders (`FadeIn`, ...)
// are chainable no-ops so a preset built at module load does not throw.
import { ScrollView, Text, View } from "react-native";

export type SharedValue<T> = {
  value: T;
  get(): T;
  set(next: T | ((current: T) => T)): void;
};

/**
 * `.set()` / `.get()` are the accessors the primitives use (React's
 * immutability lint forbids assigning to a hook result's property, and
 * Reanimated ships the methods for exactly that reason).
 */
function sharedValue<T>(initial: T): SharedValue<T> {
  return {
    value: initial,
    get() {
      return this.value;
    },
    set(next) {
      this.value = typeof next === "function" ? (next as (current: T) => T)(this.value) : next;
    },
  };
}

export function useSharedValue<T>(initial: T): SharedValue<T> {
  return sharedValue(initial);
}

export function useAnimatedStyle<T>(worklet: () => T): T {
  return worklet();
}

export function useAnimatedProps<T>(worklet: () => T): T {
  return worklet();
}

export function useDerivedValue<T>(worklet: () => T): SharedValue<T> {
  return sharedValue(worklet());
}

export function useReducedMotion(): boolean {
  return false;
}

export function useAnimatedReaction(): void {}

// The animation functions return their target value so a test reading a
// shared value after `x.set(withSpring(1))` sees the END state -- the
// "motion never blocks" rule, stated in components/ui/motion.ts, in
// miniature. The optional callback is invoked synchronously as finished.
type Callback = (finished?: boolean) => void;

export function withSpring<T>(toValue: T, _config?: unknown, callback?: Callback): T {
  callback?.(true);
  return toValue;
}

export function withTiming<T>(toValue: T, _config?: unknown, callback?: Callback): T {
  callback?.(true);
  return toValue;
}

export function withDelay<T>(_delayMs: number, animation: T): T {
  return animation;
}

export function withSequence<T>(...animations: T[]): T {
  return animations[animations.length - 1] as T;
}

export function withRepeat<T>(animation: T): T {
  return animation;
}

export function cancelAnimation(): void {}

export function runOnJS<F extends (...args: never[]) => unknown>(fn: F): F {
  return fn;
}

export function runOnUI<F extends (...args: never[]) => unknown>(fn: F): F {
  return fn;
}

export function interpolate(value: number): number {
  return value;
}

export const Extrapolation = { CLAMP: "clamp", EXTEND: "extend", IDENTITY: "identity" } as const;

export enum ReduceMotion {
  System = "system",
  Always = "always",
  Never = "never",
}

const easing = (t: number) => t;
export const Easing = {
  linear: easing,
  ease: easing,
  quad: easing,
  cubic: easing,
  in: () => easing,
  out: () => easing,
  inOut: () => easing,
  bezier: () => ({ factory: () => easing }),
};

/** A chainable, inert stand-in for every layout-animation builder. */
class AnimationBuilder {
  static duration(): AnimationBuilder {
    return new AnimationBuilder();
  }
  static delay(): AnimationBuilder {
    return new AnimationBuilder();
  }
  static springify(): AnimationBuilder {
    return new AnimationBuilder();
  }
  static withInitialValues(): AnimationBuilder {
    return new AnimationBuilder();
  }
  static reduceMotion(): AnimationBuilder {
    return new AnimationBuilder();
  }
  static easing(): AnimationBuilder {
    return new AnimationBuilder();
  }
  static damping(): AnimationBuilder {
    return new AnimationBuilder();
  }
  static stiffness(): AnimationBuilder {
    return new AnimationBuilder();
  }
  duration(): this {
    return this;
  }
  delay(): this {
    return this;
  }
  springify(): this {
    return this;
  }
  withInitialValues(): this {
    return this;
  }
  reduceMotion(): this {
    return this;
  }
  easing(): this {
    return this;
  }
  damping(): this {
    return this;
  }
  stiffness(): this {
    return this;
  }
  build(): () => Record<string, never> {
    return () => ({});
  }
}

export const FadeIn = AnimationBuilder;
export const FadeOut = AnimationBuilder;
export const FadeInDown = AnimationBuilder;
export const FadeInUp = AnimationBuilder;
export const FadeOutDown = AnimationBuilder;
export const FadeOutUp = AnimationBuilder;
export const SlideInDown = AnimationBuilder;
export const SlideOutDown = AnimationBuilder;
export const LinearTransition = AnimationBuilder;
export const Layout = AnimationBuilder;

export function createAnimatedComponent<C>(component: C): C {
  return component;
}

const Animated = {
  View,
  Text,
  ScrollView,
  createAnimatedComponent,
};

export default Animated;
