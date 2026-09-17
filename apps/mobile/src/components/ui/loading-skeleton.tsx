// Loading skeletons (Checkpoint 10.3): grey blocks that pulse while a query
// is in flight, sized like the content they stand in for so the layout does
// not jump when data lands. React Native's own `Animated` (opacity loop) --
// no reanimated worklet, so it needs no babel plugin, runs on web, and is
// trivially inert under vitest. The pulsing block is styled through `style`
// rather than `className` on purpose: NativeWind's interop covers the core
// components, and `Animated.View` is not one of them.
//
// Use a skeleton where the element WILL appear (a screen's first load); where
// it may never appear (an optional Today card), render nothing instead --
// see health-today-card.tsx's reasoning.
import { useEffect, useRef } from "react";
import { Animated, Easing, View, type DimensionValue } from "react-native";
import { Card } from "./card";
import { useTheme } from "./theme";

/** One shared pulse per block; blocks mounted together breathe together. */
function usePulse(): Animated.Value {
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.55,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

export interface SkeletonProps {
  /** A width: a number of px, or a percentage string like "60%". */
  width?: DimensionValue;
  /** Height in px. */
  height?: number;
  rounded?: "sm" | "full";
  /** Layout-only classes on the wrapper (margins, flex). */
  className?: string;
}

export function Skeleton({
  width = "100%",
  height = 14,
  rounded = "sm",
  className,
}: SkeletonProps) {
  const opacity = usePulse();
  const { colors } = useTheme();
  return (
    <View
      className={className}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        style={{
          opacity,
          width,
          height,
          borderRadius: rounded === "full" ? 999 : 6,
          backgroundColor: colors["surface-container"],
        }}
      />
    </View>
  );
}

/** A card-shaped placeholder: a title line and N body lines. */
export function SkeletonCard({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <Card className={className} accessibilityLabel="Loading" accessibilityRole="progressbar">
      <Skeleton width="40%" height={16} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i % 2 === 0 ? "100%" : "75%"} height={12} className="mt-3" />
      ))}
    </Card>
  );
}

/** A list-shaped placeholder: N rows of a title and a subtitle. */
export function SkeletonList({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <View
      className={className}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} className="py-3">
          <Skeleton width={i % 3 === 0 ? "75%" : "50%"} height={16} />
          <Skeleton width="33%" height={12} className="mt-2" />
        </View>
      ))}
    </View>
  );
}

/** A whole screen while its first query is in flight: a heading, a stat row and a list. */
export function SkeletonScreen() {
  return (
    <View
      className="px-4 pt-4"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      <Skeleton width="50%" height={28} />
      <Skeleton width="33%" height={14} className="mt-2" />
      <View className="mt-5 flex-row gap-3">
        <Skeleton width="100%" height={80} className="flex-1" />
        <Skeleton width="100%" height={80} className="flex-1" />
        <Skeleton width="100%" height={80} className="flex-1" />
      </View>
      <SkeletonCard className="mt-5" />
      <SkeletonList className="mt-2" />
    </View>
  );
}
