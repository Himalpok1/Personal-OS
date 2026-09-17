// A number with a name (Checkpoint 10.3): the tile for a stat row -- "Overdue
// 2", "Steps 6,120", "Due this week 8". Optional icon, unit, caption and an
// optional press handler. Compact by design: a row of three must fit the
// Rabbit R1's 480px width with the screen's 16px gutter.
//
// Checkpoint 10.6: `delta` adds a toned change caption ("+3 vs yesterday")
// under the value, and `animate` counts the value up through
// `AnimatedNumber` when it is a plain integer string -- anything else (a
// duration, a decimal, a unit baked into the string) stays static, so the
// end state is always exactly the `value` the caller formatted.
import { View } from "react-native";
import { AnimatedNumber } from "./animated-number";
import { Icon, type IconName } from "./icon";
import { Card } from "./card";
import { AppText, type TextTone } from "./text";
import type { ChipTone } from "./status-chip";
import type { ColorRole } from "./theme";

export interface MetricDelta {
  label: string;
  tone: ChipTone;
}

export interface MetricCardProps {
  label: string;
  /** Already formatted -- this component never rounds or localises. */
  value: string;
  unit?: string;
  caption?: string;
  /** A toned change line under the value, e.g. `{ label: "+3 today", tone: "danger" }`. */
  delta?: MetricDelta;
  /** Count the value up on mount and on change (integer strings only; see `metricAnimatedValue`). */
  animate?: boolean;
  icon?: IconName;
  /** Tints the value and icon; `neutral` is the default reading. */
  tone?: ChipTone;
  onPress?: () => void;
  accessibilityLabel?: string;
  className?: string;
  testID?: string;
}

const VALUE_TONE: Record<ChipTone, TextTone> = {
  neutral: "default",
  primary: "primary",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
};

const ICON_ROLE: Record<ChipTone, ColorRole> = {
  neutral: "on-surface-variant",
  primary: "primary",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
};

/**
 * The number an `animate` metric counts to, or null when the formatted value
 * is not a plain (optionally comma-grouped, optionally negative) integer --
 * the only shape whose animated rendering reproduces the string exactly.
 */
export function metricAnimatedValue(value: string): number | null {
  if (!/^-?\d{1,3}(,\d{3})*$|^-?\d+$/.test(value.trim())) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** The spoken label: label, value, unit, then the caption and delta if present. */
export function metricSpokenLabel(input: {
  label: string;
  value: string;
  unit?: string;
  caption?: string;
  delta?: MetricDelta;
}): string {
  const parts = [`${input.label} ${input.value}${input.unit ? ` ${input.unit}` : ""}`];
  if (input.caption) parts.push(input.caption);
  if (input.delta) parts.push(input.delta.label);
  return parts.join(", ");
}

export function MetricCard({
  label,
  value,
  unit,
  caption,
  delta,
  animate = false,
  icon,
  tone = "neutral",
  onPress,
  accessibilityLabel,
  className,
  testID,
}: MetricCardProps) {
  const spoken = accessibilityLabel ?? metricSpokenLabel({ label, value, unit, caption, delta });
  const counted = animate ? metricAnimatedValue(value) : null;
  return (
    <Card
      padding="sm"
      onPress={onPress}
      accessibilityLabel={spoken}
      className={["min-w-[96px] flex-1", className].filter(Boolean).join(" ")}
      testID={testID}
    >
      <AppText variant="overline" tone="muted" numberOfLines={1}>
        {label}
      </AppText>
      {counted === null ? (
        <AppText variant="headline" tone={VALUE_TONE[tone]} numberOfLines={1} className="mt-1">
          {value}
          {unit ? <AppText variant="label" tone="muted">{` ${unit}`}</AppText> : null}
        </AppText>
      ) : (
        // A row, not a nested Text: on a device the counter is a TextInput,
        // which cannot sit inside a Text node.
        <View className="mt-1 flex-row items-baseline">
          <AnimatedNumber value={counted} variant="headline" tone={VALUE_TONE[tone]} />
          {unit ? <AppText variant="label" tone="muted">{` ${unit}`}</AppText> : null}
        </View>
      )}
      {icon || caption ? (
        <AppText variant="caption" tone="muted" numberOfLines={1} className="mt-0.5">
          {icon ? <Icon name={icon} size="xs" tone={ICON_ROLE[tone]} /> : null}
          {icon && caption ? " " : ""}
          {caption ?? ""}
        </AppText>
      ) : null}
      {delta ? (
        <AppText
          variant="caption"
          tone={VALUE_TONE[delta.tone]}
          numberOfLines={1}
          className="mt-0.5"
        >
          {delta.label}
        </AppText>
      ) : null}
    </Card>
  );
}
