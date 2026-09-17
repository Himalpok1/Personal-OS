// The course hero's grade bar (Checkpoint 10.6, ADR-076 §3): `ProgressBar`'s
// `onGradient` variant, filling from empty to the weighted grade on mount.
// An animated LEAF (a React effect) kept beside its one consumer; the fill
// fraction is `ProgressBar`'s own `clampProgress`, so a 110% extra-credit
// grade fills the bar and never overflows it, exactly as before. Under
// reduced motion it starts full. The white-alpha track and fill are the
// documented on-gradient exception `ProgressBar` itself draws.
import { useEffect } from "react";
import { View } from "react-native";
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { AnimatedView, DURATION, clampProgress, useMotionEnabled } from "@/components/ui";

export interface GradeProgressProps {
  /** 0..1, clamped like ProgressBar. */
  value: number;
  accessibilityLabel?: string;
  className?: string;
}

/** Pure: the fill the bar starts from, given the motion decision. */
export function gradeProgressInitialFraction(motion: boolean, fraction: number): number {
  return motion ? 0 : fraction;
}

export function GradeProgress({ value, accessibilityLabel, className }: GradeProgressProps) {
  const fraction = clampProgress(value);
  const motion = useMotionEnabled("cheap");
  const fill = useSharedValue(gradeProgressInitialFraction(motion, fraction));
  useEffect(() => {
    if (!motion) {
      fill.set(fraction);
      return;
    }
    fill.set(withTiming(fraction, { duration: DURATION.slow, easing: Easing.out(Easing.cubic) }));
  }, [fill, fraction, motion]);
  const style = useAnimatedStyle(() => ({ width: `${fill.get() * 100}%` }));
  return (
    <View
      className={["h-2 w-full overflow-hidden rounded-full bg-white/25", className]
        .filter(Boolean)
        .join(" ")}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
    >
      <AnimatedView className="h-full rounded-full bg-white" style={style} />
    </View>
  );
}
