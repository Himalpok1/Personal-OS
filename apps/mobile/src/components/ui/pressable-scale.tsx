// A Pressable that settles under the finger (Checkpoint 10.6).
//
// Press-in springs the whole node to 97%, release springs it back -- the
// tactile cue a card or button is a thing that can be pushed. It is the ONE
// press animation in the design system: `Card`, `GradientCard`, `MetricCard`,
// `Button` and `IconButton` all render through it, so every pressable
// surface in the app answers a touch the same way.
//
// Under reduced motion, and on web (where Reanimated would drive the spring
// from JS on every frame), it is a plain Pressable with an `active:` opacity
// class instead -- the same end state, the same handlers, no motion. The
// decision is `pressScaleConfig`, a pure function a test can pin; the
// component only calls Reanimated hooks (never React's), so the tree-walking
// tests can still invoke it directly under the reanimated mock.
//
// The animated branch renders `AnimatedPressable` (components/ui/animated.ts):
// an interop-wrapped Pressable that takes BOTH the class string and the
// animated style on one node, which is what keeps every caller's layout
// class (`flex-1`, `absolute`, `flex-row`) exactly where it was.
import type { ComponentProps, ReactNode } from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { AnimatedPressable } from "./animated";
import { PRESS_SCALE, SPRING, useMotionEnabled } from "./motion";

/** The opacity fallback a pressable gets when it cannot scale. */
export const PRESS_FALLBACK_CLASS = "active:opacity-80";

export interface PressScaleConfig {
  /** Render the spring-scaled node, or the plain Pressable. */
  animated: boolean;
  /** The scale the node springs to on press-in. */
  pressedScale: number;
  /** The `active:` class appended to the plain branch (empty in the animated one). */
  fallbackClass: string;
}

/** Pure decision so the vocabulary can be pinned without rendering. */
export function pressScaleConfig(
  motion: boolean,
  activeClassName: string | null = PRESS_FALLBACK_CLASS,
): PressScaleConfig {
  return {
    animated: motion,
    pressedScale: PRESS_SCALE,
    fallbackClass: motion ? "" : (activeClassName ?? ""),
  };
}

type PressableBaseProps = Omit<ComponentProps<typeof Pressable>, "style" | "children">;

export interface PressableScaleProps extends PressableBaseProps {
  children?: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * The `active:` class used when the node cannot scale (web, reduced
   * motion). `null` when the caller's own classes already carry an active
   * state (Button's variants do), so two opacities do not stack.
   */
  activeClassName?: string | null;
}

export function PressableScale({
  children,
  className,
  style,
  activeClassName = PRESS_FALLBACK_CLASS,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps) {
  const motion = useMotionEnabled("rich");
  const config = pressScaleConfig(motion, activeClassName);
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  if (!config.animated) {
    return (
      <Pressable
        {...rest}
        disabled={disabled}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        className={[className, config.fallbackClass].filter(Boolean).join(" ")}
        style={style}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(event: GestureResponderEvent) => {
        if (!disabled) scale.set(withSpring(config.pressedScale, SPRING.press));
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        scale.set(withSpring(1, SPRING.press));
        onPressOut?.(event);
      }}
      className={className}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
