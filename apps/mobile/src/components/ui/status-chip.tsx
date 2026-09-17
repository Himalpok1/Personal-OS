// Status chips (Checkpoint 10.3): a small, rounded, tinted label with a
// closed set of semantic tones. Used for urgency, submission state, project
// status, connection health -- anything that is a WORD about state.
//
// A chip never carries an interaction. A tappable pill is a `Button` with
// `variant="tonal"` / `size="sm"`; keeping the two apart is what lets a
// reader trust that a coloured word is information, not an affordance.
import { View } from "react-native";
import { Icon, type IconName } from "./icon";
import { AppText } from "./text";
import type { ColorRole } from "./theme";

export type ChipTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";
export type ChipSize = "sm" | "md";

const CONTAINER_CLASS: Record<ChipTone, string> = {
  neutral: "bg-surface-container dark:bg-surface-container-dark",
  primary: "bg-primary-container dark:bg-primary-container-dark",
  success: "bg-success-container dark:bg-success-container-dark",
  warning: "bg-warning-container dark:bg-warning-container-dark",
  danger: "bg-danger-container dark:bg-danger-container-dark",
  info: "bg-info-container dark:bg-info-container-dark",
};

const LABEL_CLASS: Record<ChipTone, string> = {
  neutral: "text-on-surface-variant dark:text-on-surface-variant-dark",
  primary: "text-on-primary-container dark:text-on-primary-container-dark",
  success: "text-on-success-container dark:text-on-success-container-dark",
  warning: "text-on-warning-container dark:text-on-warning-container-dark",
  danger: "text-on-danger-container dark:text-on-danger-container-dark",
  info: "text-on-info-container dark:text-on-info-container-dark",
};

const ICON_ROLE: Record<ChipTone, ColorRole> = {
  neutral: "on-surface-variant",
  primary: "on-primary-container",
  success: "on-success-container",
  warning: "on-warning-container",
  danger: "on-danger-container",
  info: "on-info-container",
};

const SIZE_CLASS: Record<ChipSize, string> = {
  sm: "px-2 py-0.5 gap-1",
  md: "px-2.5 py-1 gap-1.5",
};

export interface StatusChipProps {
  label: string;
  tone?: ChipTone;
  size?: ChipSize;
  icon?: IconName;
  /** A leading dot instead of an icon -- the lighter option for a dense row. */
  dot?: boolean;
  className?: string;
  accessibilityLabel?: string;
}

/** Pure helper so tests can pin the tone vocabulary without rendering. */
export function chipClasses(tone: ChipTone, size: ChipSize): { container: string; label: string } {
  return {
    container: `flex-row items-center self-start rounded-full ${CONTAINER_CLASS[tone]} ${SIZE_CLASS[size]}`,
    label: LABEL_CLASS[tone],
  };
}

const DOT_CLASS: Record<ChipTone, string> = {
  neutral: "bg-on-surface-muted dark:bg-on-surface-muted-dark",
  primary: "bg-primary dark:bg-primary-dark",
  success: "bg-success dark:bg-success-dark",
  warning: "bg-warning dark:bg-warning-dark",
  danger: "bg-danger dark:bg-danger-dark",
  info: "bg-info dark:bg-info-dark",
};

export function StatusChip({
  label,
  tone = "neutral",
  size = "sm",
  icon,
  dot,
  className,
  accessibilityLabel,
}: StatusChipProps) {
  const classes = chipClasses(tone, size);
  return (
    <View
      className={[classes.container, className].filter(Boolean).join(" ")}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {icon ? <Icon name={icon} size="xs" tone={ICON_ROLE[tone]} /> : null}
      {dot && !icon ? <View className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[tone]}`} /> : null}
      <AppText
        variant={size === "sm" ? "caption" : "label"}
        tone="inherit"
        className={`${LABEL_CLASS[tone]} font-semibold`}
        numberOfLines={1}
      >
        {label}
      </AppText>
    </View>
  );
}
