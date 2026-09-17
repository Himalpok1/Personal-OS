// Cards (Checkpoint 10.3).
//
// `Card` is the surface every dashboard block sits on: a white (dark: raised
// navy) panel with the `card` radius, a soft tinted shadow on the light
// canvas and a hairline outline in the dark one. `GradientCard` is the same
// footprint over a two-stop gradient preset from tokens.js, for the handful
// of hero blocks that must lead the page (Today's greeting, the semester
// overview, the health summary) -- gradients improve hierarchy only while
// they are rare, so screens are expected to use ONE.
//
// Both accept an `onPress`; a pressable card renders a Pressable with the
// `button` role and dims on press, an inert one renders a View. Neither
// adds horizontal margin: the parent (`Screen` or a section) owns the gutter,
// so a card in a two-column row and a card on its own align the same way.
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useGradient, type GradientName } from "./theme";

export type CardPadding = "none" | "sm" | "md" | "lg";

const PADDING_CLASS: Record<CardPadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

export interface CardProps {
  children: ReactNode;
  padding?: CardPadding;
  /** `raised` uses the stronger shadow -- for the one block that should lead a section. */
  elevation?: "flat" | "card" | "raised";
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  /** Extra classes (layout only: margins, widths). Never colours. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const CARD_BASE =
  "rounded-card bg-surface border border-outline/70 dark:bg-surface-dark dark:border-outline-dark";

const ELEVATION_CLASS = {
  flat: "",
  card: "shadow-card dark:shadow-none",
  raised: "shadow-card-raised dark:shadow-none",
} as const;

/** Pure helper so the class vocabulary can be pinned in a test. */
export function cardClass(
  padding: CardPadding = "md",
  elevation: CardProps["elevation"] = "card",
  extra?: string,
): string {
  return [CARD_BASE, ELEVATION_CLASS[elevation], PADDING_CLASS[padding], extra]
    .filter(Boolean)
    .join(" ");
}

export function Card({
  children,
  padding = "md",
  elevation = "card",
  onPress,
  accessibilityLabel,
  accessibilityRole,
  className,
  style,
  testID,
}: CardProps) {
  const classes = cardClass(padding, elevation, className);
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole={accessibilityRole ?? "button"}
        accessibilityLabel={accessibilityLabel}
        hitSlop={4}
        className={`${classes} active:opacity-80`}
        style={style}
        testID={testID}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View
      className={classes}
      style={style}
      // A label on a plain View is spoken only when the View is itself an
      // accessible element (RN) / carries a role (web), so a labelled card is
      // made one -- it then reads as a single group, which is the intent.
      accessible={accessibilityLabel !== undefined ? true : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={
        accessibilityRole ?? (accessibilityLabel !== undefined ? "summary" : undefined)
      }
      testID={testID}
    >
      {children}
    </View>
  );
}

export interface GradientCardProps extends Omit<CardProps, "elevation"> {
  gradient?: GradientName;
}

export function GradientCard({
  children,
  gradient = "hero",
  padding = "lg",
  onPress,
  accessibilityLabel,
  accessibilityRole,
  className,
  style,
  testID,
}: GradientCardProps) {
  const stops = useGradient(gradient);
  // The gradient is an absolutely-filled layer under a padded content View,
  // and the wrapper clips both to the card radius. LinearGradient is not one
  // of the components NativeWind's interop wraps, so a `className` on it is
  // silently dropped -- padding and radius live on plain Views instead.
  const body = (
    <View className={`overflow-hidden rounded-card ${PADDING_CLASS[padding]}`}>
      <LinearGradient
        colors={stops}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children}
    </View>
  );
  const wrapperClass = ["rounded-card shadow-card-raised dark:shadow-none", className]
    .filter(Boolean)
    .join(" ");
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole={accessibilityRole ?? "button"}
        accessibilityLabel={accessibilityLabel}
        hitSlop={4}
        className={`${wrapperClass} active:opacity-90`}
        style={style}
        testID={testID}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View
      className={wrapperClass}
      style={style}
      accessible={accessibilityLabel !== undefined ? true : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={
        accessibilityRole ?? (accessibilityLabel !== undefined ? "summary" : undefined)
      }
      testID={testID}
    >
      {body}
    </View>
  );
}
