// A number that counts up to its value (Checkpoint 10.6).
//
// The standard Reanimated trick: a shared value eased toward the target and
// written into a non-editable TextInput through `useAnimatedProps` on every
// frame, so the count never round-trips through React. The input is a
// `text` to assistive tech and its label is the FINAL formatted value, so a
// screen reader announces the end state while sighted users watch the
// count -- "motion never blocks" (motion.ts).
//
// Two limits worth knowing. (1) `format` runs on the UI thread: pass a
// worklet (a function whose body starts with the `"worklet"` directive) or
// leave the default, which groups thousands with commas and never touches
// Intl. (2) The counter is a `rich` motion: under reduced motion and on web
// it is a plain `AppText` of the formatted value -- the same node role, the
// same label, no TextInput.
//
// Styling note: the animated input takes no className (components/ui/
// animated.ts explains why), so its type style is resolved from the same
// tokens `AppText` compiles from -- size and line height from
// `tokens.fontSize`, colour from the palette by tone.
import { useEffect } from "react";
import { TextInput, type StyleProp, type TextStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { DURATION, useMotionEnabled } from "./motion";
import { AppText, type TextTone, type TextVariant } from "./text";
import { tokens, useTheme, type ColorRole } from "./theme";

export type NumberFormat = (value: number) => string;

/** Round to an integer and group thousands. Worklet-safe: no Intl, no locale. */
export function formatGroupedInteger(value: number): string {
  "worklet";
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value);
  const digits = String(Math.abs(rounded));
  let grouped = "";
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    grouped += digits[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) grouped += ",";
  }
  return rounded < 0 ? `-${grouped}` : grouped;
}

/** The value a screen reader is given: always the final, formatted number. */
export function animatedNumberLabel(value: number, format: NumberFormat = formatGroupedInteger) {
  return format(value);
}

export interface AnimatedNumberProps {
  value: number;
  /** A worklet, or omitted for comma-grouped integers. */
  format?: NumberFormat;
  variant?: TextVariant;
  tone?: TextTone;
  accessibilityLabel?: string;
  /** Layout-only classes, applied on the plain-text branch (the counter takes `style`). */
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

const VARIANT_WEIGHT: Record<TextVariant, TextStyle["fontWeight"]> = {
  display: "700",
  headline: "600",
  title: "600",
  body: "400",
  "body-strong": "500",
  label: "500",
  caption: "400",
  overline: "600",
};

const TONE_ROLE: Record<
  Exclude<TextTone, "on-gradient" | "on-gradient-muted" | "inherit">,
  ColorRole
> = {
  default: "on-surface",
  secondary: "on-surface-variant",
  muted: "on-surface-muted",
  primary: "primary",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
};

/** The type style `AppText` would compile for a variant, as a style object. */
export function numberTextStyle(
  variant: TextVariant,
  tone: TextTone,
  colors: Record<ColorRole, string>,
): TextStyle {
  const sizeKey = variant === "body-strong" ? "body" : variant;
  const [size, meta] = tokens.fontSize[sizeKey] as [
    string,
    { lineHeight: string; letterSpacing?: string },
  ];
  const color =
    tone === "on-gradient" || tone === "on-gradient-muted"
      ? "#FFFFFF"
      : tone === "inherit"
        ? undefined
        : colors[TONE_ROLE[tone]];
  return {
    fontSize: parseFloat(size),
    lineHeight: parseFloat(meta.lineHeight),
    letterSpacing: meta.letterSpacing ? parseFloat(meta.letterSpacing) : undefined,
    fontWeight: VARIANT_WEIGHT[variant],
    color,
    padding: 0,
    margin: 0,
  };
}

export function AnimatedNumber({
  value,
  format = formatGroupedInteger,
  variant = "headline",
  tone = "default",
  accessibilityLabel,
  className,
  style,
  testID,
}: AnimatedNumberProps) {
  const motion = useMotionEnabled("rich");
  const label = accessibilityLabel ?? animatedNumberLabel(value, format);
  if (!motion) {
    return (
      <AppText
        variant={variant}
        tone={tone}
        className={className}
        style={style}
        accessibilityRole="text"
        accessibilityLabel={label}
        testID={testID}
      >
        {format(value)}
      </AppText>
    );
  }
  return (
    <AnimatedNumberCounter
      value={value}
      format={format}
      variant={variant}
      tone={tone}
      accessibilityLabel={label}
      style={style}
      testID={testID}
    />
  );
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * The counting leaf. Uses a React effect (to start the timing when `value`
 * changes), so it is never invoked directly by a tree-walking test -- the
 * tests list it as a host type and assert on its props instead.
 */
export function AnimatedNumberCounter({
  value,
  format,
  variant,
  tone,
  accessibilityLabel,
  style,
  testID,
}: {
  value: number;
  format: NumberFormat;
  variant: TextVariant;
  tone: TextTone;
  accessibilityLabel: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const { colors } = useTheme();
  const progress = useSharedValue(value);
  useEffect(() => {
    progress.set(
      withTiming(value, {
        duration: DURATION.slow,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [progress, value]);
  const animatedProps = useAnimatedProps(() => {
    const text = format(progress.get());
    return { text, defaultValue: text };
  });
  return (
    <AnimatedTextInput
      editable={false}
      underlineColorAndroid="transparent"
      animatedProps={animatedProps}
      defaultValue={format(value)}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={[numberTextStyle(variant, tone, colors), style]}
      testID={testID}
    />
  );
}
