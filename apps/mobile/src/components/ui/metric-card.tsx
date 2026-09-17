// A number with a name (Checkpoint 10.3): the tile for a stat row -- "Overdue
// 2", "Steps 6,120", "Due this week 8". Optional icon, unit, caption and an
// optional press handler. Compact by design: a row of three must fit the
// Rabbit R1's 480px width with the screen's 16px gutter.
import { Icon, type IconName } from "./icon";
import { Card } from "./card";
import { AppText, type TextTone } from "./text";
import type { ChipTone } from "./status-chip";
import type { ColorRole } from "./theme";

export interface MetricCardProps {
  label: string;
  /** Already formatted -- this component never rounds or localises. */
  value: string;
  unit?: string;
  caption?: string;
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

export function MetricCard({
  label,
  value,
  unit,
  caption,
  icon,
  tone = "neutral",
  onPress,
  accessibilityLabel,
  className,
  testID,
}: MetricCardProps) {
  const spoken =
    accessibilityLabel ??
    `${label} ${value}${unit ? ` ${unit}` : ""}${caption ? `, ${caption}` : ""}`;
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
      <AppText variant="headline" tone={VALUE_TONE[tone]} numberOfLines={1} className="mt-1">
        {value}
        {unit ? <AppText variant="label" tone="muted">{` ${unit}`}</AppText> : null}
      </AppText>
      {icon || caption ? (
        <AppText variant="caption" tone="muted" numberOfLines={1} className="mt-0.5">
          {icon ? <Icon name={icon} size="xs" tone={ICON_ROLE[tone]} /> : null}
          {icon && caption ? " " : ""}
          {caption ?? ""}
        </AppText>
      ) : null}
    </Card>
  );
}
