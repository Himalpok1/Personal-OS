// Buttons (Checkpoint 10.3): four variants, two sizes, every one at least
// 44px tall (the hit target the rest of the app already enforces with
// min-h-[44px]). `primary` fires a light haptic on press -- it is the one
// variant reserved for the action a screen exists for, so it earns the
// feedback; the others stay silent so a busy screen does not buzz.
//
// `busy` renders the label dimmed and disables the press, mirroring
// use-busy-press.ts's rule that a pending mutation must not be re-fired by a
// second tap; callers wire it to `mutation.isPending`.
//
// Checkpoint 10.6: both buttons render through `PressableScale`, so a press
// settles the node to 97% on a device. Each variant keeps its own `active:`
// class (an outline button tints, a primary one dims), so the scale's own
// opacity fallback is switched off here -- two opacities would stack.
import { View } from "react-native";
import { triggerHaptic } from "./haptics";
import { Icon, type IconName } from "./icon";
import { PressableScale } from "./pressable-scale";
import { AppText } from "./text";
import type { ColorRole } from "./theme";

export type ButtonVariant = "primary" | "tonal" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const CONTAINER_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary dark:bg-primary-dark active:opacity-90",
  tonal: "bg-primary-container dark:bg-primary-container-dark active:opacity-80",
  outline:
    "border border-outline-strong bg-transparent dark:border-outline-strong-dark active:bg-surface-container dark:active:bg-surface-container-dark",
  ghost: "bg-transparent active:bg-surface-container dark:active:bg-surface-container-dark",
  danger: "bg-danger-container dark:bg-danger-container-dark active:opacity-80",
};

const LABEL_CLASS: Record<ButtonVariant, string> = {
  primary: "text-on-primary dark:text-on-primary-dark",
  tonal: "text-on-primary-container dark:text-on-primary-container-dark",
  outline: "text-on-surface dark:text-on-surface-dark",
  ghost: "text-primary dark:text-primary-dark",
  danger: "text-on-danger-container dark:text-on-danger-container-dark",
};

const ICON_ROLE: Record<ButtonVariant, ColorRole> = {
  primary: "on-primary",
  tonal: "on-primary-container",
  outline: "on-surface",
  ghost: "primary",
  danger: "on-danger-container",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "min-h-[44px] px-3.5 py-2 gap-1.5",
  md: "min-h-[48px] px-5 py-3 gap-2",
};

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Disables the press and dims the label while a mutation is pending. */
  busy?: boolean;
  disabled?: boolean;
  /** Stretch to the parent's width (a form's submit) instead of hugging the label. */
  block?: boolean;
  haptic?: boolean;
  accessibilityLabel?: string;
  className?: string;
  testID?: string;
}

/** Pure helper so the vocabulary can be pinned in a test. */
export function buttonClasses(
  variant: ButtonVariant,
  size: ButtonSize,
  block: boolean,
): { container: string; label: string } {
  return {
    container: [
      "flex-row items-center justify-center rounded-inner",
      CONTAINER_CLASS[variant],
      SIZE_CLASS[size],
      block ? "w-full" : "self-start",
    ].join(" "),
    label: LABEL_CLASS[variant],
  };
}

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  busy = false,
  disabled = false,
  block = false,
  haptic = variant === "primary",
  accessibilityLabel,
  className,
  testID,
}: ButtonProps) {
  const classes = buttonClasses(variant, size, block);
  const inert = busy || disabled;
  return (
    <PressableScale
      activeClassName={null}
      onPress={() => {
        if (inert) return;
        if (haptic) triggerHaptic("light");
        onPress();
      }}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inert, busy }}
      hitSlop={4}
      className={[classes.container, inert ? "opacity-60" : "", className]
        .filter(Boolean)
        .join(" ")}
      testID={testID}
    >
      {icon ? (
        <Icon name={icon} size={size === "sm" ? "sm" : "md"} tone={ICON_ROLE[variant]} />
      ) : null}
      <AppText
        variant={size === "sm" ? "label" : "body-strong"}
        tone="inherit"
        className={`${classes.label} font-semibold`}
        numberOfLines={1}
      >
        {busy ? `${label}…` : label}
      </AppText>
    </PressableScale>
  );
}

export interface IconButtonProps {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  tone?: ColorRole;
  /** `plain` is an unboxed 44px target for a header; `tonal` sits in a tinted disc. */
  variant?: "plain" | "tonal";
  /**
   * Checkpoint 10.6: the same pending/disabled contract as `Button`. `busy`
   * is wired to a mutation's `isPending` so a second tap on an archive icon
   * never re-fires it (the guard notes.tsx used to keep by hand).
   */
  busy?: boolean;
  disabled?: boolean;
  className?: string;
  testID?: string;
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  tone = "on-surface",
  variant = "plain",
  busy = false,
  disabled = false,
  className,
  testID,
}: IconButtonProps) {
  const inert = busy || disabled;
  return (
    <PressableScale
      activeClassName={null}
      onPress={() => {
        if (inert) return;
        onPress();
      }}
      disabled={inert}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: inert, busy }}
      className={[
        "h-11 w-11 items-center justify-center rounded-full active:opacity-70",
        variant === "tonal" ? "bg-surface-container dark:bg-surface-container-dark" : "",
        inert ? "opacity-50" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      testID={testID}
    >
      <View pointerEvents="none">
        <Icon name={icon} size="lg" tone={tone} />
      </View>
    </PressableScale>
  );
}
