// A list row (Checkpoint 10.3): optional leading icon in a tinted disc, a
// title, an optional subtitle and meta line, an optional trailing element
// (a chip, a chevron, a value). Pressable when `onPress` is given -- 44px
// minimum either way -- with a hairline divider below unless it is `last`.
//
// Rows inside a `Card` use `inset` so the divider stops short of the card's
// rounded corners; rows on the canvas use the default full-bleed divider.
//
// Checkpoint 10.6: `trailingChips` draws up to two `StatusChip`s (and a
// `+N` for the rest) as the trailing element, `onLongPress` gives a row a
// secondary action, and `entering` lets a list animate a row in -- the row
// then renders as the interop-wrapped animated host (components/ui/
// animated.ts) with its classes intact, no wrapper node.
import type { ReactNode } from "react";
import { Pressable, View, type AccessibilityRole } from "react-native";
import type { EntryOrExitLayoutType } from "react-native-reanimated";
import { AnimatedPressable, AnimatedView } from "./animated";
import { Icon, type IconName } from "./icon";
import { AppText, type TextTone } from "./text";
import { StatusChip, type ChipTone } from "./status-chip";
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

export interface TrailingChip {
  label: string;
  tone: ChipTone;
}

export const TRAILING_CHIP_CAP = 2;

/** Pure: which chips to draw and how many collapse into `+N`. */
export function trailingChipsVisible(
  chips: readonly TrailingChip[],
  cap: number = TRAILING_CHIP_CAP,
): { shown: TrailingChip[]; overflow: number } {
  return { shown: chips.slice(0, cap), overflow: Math.max(0, chips.length - cap) };
}

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
  /**
   * Small state chips drawn as the trailing element (after an explicit
   * `trailing`, before a chevron). At most `TRAILING_CHIP_CAP` are shown; the
   * rest collapse to `+N`.
   */
  trailingChips?: TrailingChip[];
  onPress?: () => void;
  /** A secondary action on a long press (a context sheet); the row must also have `onPress`. */
  onLongPress?: () => void;
  /** A Reanimated entering animation (`enterRise` from motion.ts), for a row that has just appeared. */
  entering?: EntryOrExitLayoutType;
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
  trailingChips,
  onPress,
  onLongPress,
  entering,
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
      {trailing ?? null}
      {trailingChips && trailingChips.length > 0 ? (
        <TrailingChipGroup chips={trailingChips} />
      ) : null}
      {trailing == null && chevron ? (
        <Icon name="chevron-right" size="md" tone="on-surface-muted" />
      ) : null}
    </>
  );
  if (onPress) {
    const Host = entering ? AnimatedPressable : Pressable;
    return (
      <Host
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={disabled}
        accessibilityRole={accessibilityRole ?? (containsControl ? undefined : "button")}
        accessibilityLabel={accessibilityLabel ?? title}
        hitSlop={4}
        className={container}
        entering={entering}
        testID={testID}
      >
        {content}
      </Host>
    );
  }
  const Host = entering ? AnimatedView : View;
  return (
    <Host
      className={container}
      // Same rule as Card: a labelled inert row is one accessible group.
      accessible={accessibilityLabel !== undefined ? true : undefined}
      accessibilityLabel={accessibilityLabel}
      entering={entering}
      testID={testID}
    >
      {content}
    </Host>
  );
}

/** The trailing chip group: wraps onto a second line inside its own column, never the title's. */
export function TrailingChipGroup({ chips }: { chips: readonly TrailingChip[] }) {
  const { shown, overflow } = trailingChipsVisible(chips);
  return (
    <View className="max-w-[45%] flex-row flex-wrap items-center justify-end gap-1">
      {shown.map((chip, index) => (
        <StatusChip key={`${chip.label}:${index}`} label={chip.label} tone={chip.tone} size="sm" />
      ))}
      {overflow > 0 ? (
        <StatusChip
          label={`+${overflow}`}
          tone="neutral"
          size="sm"
          accessibilityLabel={`${overflow} more`}
        />
      ) : null}
    </View>
  );
}
