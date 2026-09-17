// One bar of the Academics card's workload strip (Checkpoint 10.6, ADR-076
// §3): grows from the floor to its measured height on mount over the `slow`
// duration, so the week reads in rather than snapping in. An animated LEAF
// (a React effect), so the card test lists it as a host type and asserts on
// its props; the geometry itself is pure (`workloadStripColumns`).
//
// Under reduced motion the bar starts AT its height and never animates --
// the same end state, instantly (docs/MOBILE-DESIGN-SYSTEM.md → Motion). A
// raw colour is unavoidable for a drawn bar (theme.ts: "a chart stroke"),
// so it arrives resolved from the palette, never as a class.
import { useEffect } from "react";
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { AnimatedView, DURATION, useMotionEnabled } from "@/components/ui";

export interface WorkloadBarProps {
  heightPx: number;
  color: string;
  testID?: string;
}

/** Pure: where the bar starts, given the motion decision. */
export function workloadBarInitialHeight(motion: boolean, heightPx: number): number {
  return motion ? 0 : heightPx;
}

export function WorkloadBar({ heightPx, color, testID }: WorkloadBarProps) {
  const motion = useMotionEnabled("cheap");
  const height = useSharedValue(workloadBarInitialHeight(motion, heightPx));
  useEffect(() => {
    if (!motion) {
      height.set(heightPx);
      return;
    }
    height.set(withTiming(heightPx, { duration: DURATION.slow, easing: Easing.out(Easing.cubic) }));
  }, [height, heightPx, motion]);
  const style = useAnimatedStyle(() => ({ height: height.get() }));
  // AnimatedView (components/ui/animated.ts) takes both the class string and
  // the animated style; a plain Animated.View would drop the className.
  return (
    <AnimatedView
      className="w-full rounded-sm"
      style={[{ backgroundColor: color }, style]}
      testID={testID}
    />
  );
}
