// Typography (Checkpoint 10.3): one component, a closed set of variants.
//
// Every screen used to spell its own `text-2xl font-bold text-black
// dark:text-white`; this makes the scale a vocabulary instead. Sizes are the
// `fontSize` tokens in tokens.js, weights and tones are chosen here, so a
// heading looks the same on Today, Academics, Health and Settings without
// any screen repeating a class string.
import type { ComponentProps } from "react";
import { Text } from "react-native";

export type TextVariant =
  "display" | "headline" | "title" | "body" | "body-strong" | "label" | "caption" | "overline";

export type TextTone =
  | "default"
  | "secondary"
  | "muted"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "on-gradient"
  | "on-gradient-muted"
  /** No colour class at all -- the caller supplies one via `className` (chips on tinted containers). */
  | "inherit";

const VARIANT_CLASS: Record<TextVariant, string> = {
  display: "text-display font-bold",
  headline: "text-headline font-semibold",
  title: "text-title font-semibold",
  body: "text-body",
  "body-strong": "text-body font-medium",
  label: "text-label font-medium",
  caption: "text-caption",
  overline: "text-overline font-semibold uppercase",
};

const TONE_CLASS: Record<TextTone, string> = {
  default: "text-on-surface dark:text-on-surface-dark",
  secondary: "text-on-surface-variant dark:text-on-surface-variant-dark",
  muted: "text-on-surface-muted dark:text-on-surface-muted-dark",
  primary: "text-primary dark:text-primary-dark",
  success: "text-success dark:text-success-dark",
  warning: "text-warning dark:text-warning-dark",
  danger: "text-danger dark:text-danger-dark",
  info: "text-info dark:text-info-dark",
  "on-gradient": "text-white",
  // 90%, not 80%: at 80% the muted line fell under 4.5:1 on the light stops.
  "on-gradient-muted": "text-white/90",
  inherit: "",
};

export interface AppTextProps extends ComponentProps<typeof Text> {
  variant?: TextVariant;
  tone?: TextTone;
  className?: string;
}

/** Pure helper so tests can pin the vocabulary without rendering. */
export function textClass(variant: TextVariant, tone: TextTone, extra?: string): string {
  return [VARIANT_CLASS[variant], TONE_CLASS[tone], extra].filter(Boolean).join(" ");
}

export function AppText({ variant = "body", tone = "default", className, ...rest }: AppTextProps) {
  return <Text {...rest} className={textClass(variant, tone, className)} />;
}
