// A list row (Checkpoint 10.3): optional leading icon in a tinted disc, a
// title, an optional subtitle and meta line, an optional trailing element
// (a chip, a chevron, a value). Pressable when `onPress` is given -- 44px
// minimum either way -- with a hairline divider below unless it is `last`.
//
// Rows inside a `Card` use `inset` so the divider stops short of the card's
// rounded corners; rows on the canvas use the default full-bleed divider.
import type { ReactNode } from "react";
import { Pressable, View, type AccessibilityRole } from "react-native";
import { Icon, type IconName } from "./icon";
import { AppText, type TextTone } from "./text";
import type { ChipTone } from "./status-chip";
import type { ColorRole } from "./theme";

const DISC_CLASS: Record<ChipTone, string> = {
  neutral: "bg-surface-container dark:bg-surface-container-dark",
  primary: "bg-primary-container dark:bg-primary-container-dark",
  success: "bg-success-container dark:bg-success-container-dark",
  warning: "bg-warning-container dark:bg-warning-container-dark",
  danger: "bg-danger-container dark:bg-danger-container-dark",
  info: "bg-info-container dark:bg-info-container-dark",
};

const DISC_ICON_ROLE: Record<ChipTone, ColorRole> = {
  neutral: "on-surface-variant",
  primary: "on-primary-container",
  success: "on-success-container",
  warning: "on-warning-container",
  danger: "on-danger-container",
  info: "on-info-container",
};

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** A third, muted line (a due instant, a course code). */
  meta?: string;
  icon?: IconName;
  iconTone?: ChipTone;
  /** Any leading element instead of an icon disc (a checkbox, a colour dot). */
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Draw a chevron as the trailing element when there is no explicit one. */
  chevron?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  /**
   * The row contains its own interactive control (a completion checkbox in
   * `leading`, a switch in `trailing`). A pressable row then renders WITHOUT
   * the `button` role: on web a role-less Pressable is a `div`, whereas a
   * `button` inside a `button` is invalid HTML that React logs as a hydration
   * error, and on every platform the inner control keeps its own role and
   * label, which is what assistive tech should land on.
   */
  containsControl?: boolean;
  titleTone?: TextTone;
  /** Strike through and mute the title (a completed item). */
  done?: boolean;
  last?: boolean;
  inset?: boolean;
  disabled?: boolean;
  className?: string;
  testID?: string;
}

export function ListRow({
  title,
  subtitle,
  meta,
  icon,
  iconTone = "neutral",
  leading,
  trailing,
  chevron = false,
  onPress,
  accessibilityLabel,
  accessibilityRole,
  containsControl = false,
  titleTone = "default",
  done = false,
  last = false,
  inset = false,
  disabled = false,
  className,
  testID,
}: ListRowProps) {
  const divider = last ? "" : "border-b border-outline/70 dark:border-outline-dark";
  const container = [
    "min-h-[52px] flex-row items-center gap-3 py-2.5",
    inset ? "" : "px-4",
    divider,
    onPress ? "active:opacity-70" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      {leading ??
        (icon ? (
          <View
            className={`h-9 w-9 items-center justify-center rounded-full ${DISC_CLASS[iconTone]}`}
          >
            <Icon name={icon} size="md" tone={DISC_ICON_ROLE[iconTone]} />
          </View>
        ) : null)}
      <View className="flex-1">
        <AppText
          variant="body-strong"
          tone={done ? "muted" : titleTone}
          numberOfLines={2}
          className={done ? "line-through" : ""}
        >
          {title}
        </AppText>
        {subtitle ? (
          <AppText
            variant="label"
            tone="secondary"
            numberOfLines={2}
            className="mt-0.5 font-normal"
          >
            {subtitle}
          </AppText>
        ) : null}
        {meta ? (
          <AppText variant="caption" tone="muted" numberOfLines={1} className="mt-0.5">
            {meta}
          </AppText>
        ) : null}
      </View>
      {trailing ??
        (chevron ? <Icon name="chevron-right" size="md" tone="on-surface-muted" /> : null)}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole={accessibilityRole ?? (containsControl ? undefined : "button")}
        accessibilityLabel={accessibilityLabel ?? title}
        hitSlop={4}
        className={container}
        testID={testID}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View
      className={container}
      // Same rule as Card: a labelled inert row is one accessible group.
      accessible={accessibilityLabel !== undefined ? true : undefined}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {content}
    </View>
  );
}
