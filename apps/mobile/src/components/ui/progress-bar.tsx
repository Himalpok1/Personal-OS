// A determinate progress bar (Checkpoint 10.3): a track and a fill, no
// dependency beyond View. `value` is clamped to [0, 1] -- a caller that hands
// it 1.4 (extra credit) gets a full bar, never an overflowing one, and NaN
// renders empty rather than throwing the layout off.
import { View } from "react-native";
import type { ChipTone } from "./status-chip";

export type ProgressTone = Exclude<ChipTone, "neutral">;

const FILL_CLASS: Record<ProgressTone, string> = {
  primary: "bg-primary dark:bg-primary-dark",
  success: "bg-success dark:bg-success-dark",
  warning: "bg-warning dark:bg-warning-dark",
  danger: "bg-danger dark:bg-danger-dark",
  info: "bg-info dark:bg-info-dark",
};

export interface ProgressBarProps {
  /** 0..1. Anything outside is clamped; a non-finite value renders empty. */
  value: number;
  tone?: ProgressTone;
  /** Track height in Tailwind units: `sm` 4px, `md` 8px. */
  size?: "sm" | "md";
  /** On a gradient card the track and fill are white-tinted instead of palette-tinted. */
  onGradient?: boolean;
  accessibilityLabel?: string;
  className?: string;
}

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function ProgressBar({
  value,
  tone = "primary",
  size = "sm",
  onGradient = false,
  accessibilityLabel,
  className,
}: ProgressBarProps) {
  const fraction = clampProgress(value);
  const height = size === "sm" ? "h-1" : "h-2";
  const track = onGradient ? "bg-white/25" : "bg-surface-container dark:bg-surface-container-dark";
  const fill = onGradient ? "bg-white" : FILL_CLASS[tone];
  return (
    <View
      className={[`w-full overflow-hidden rounded-full ${height} ${track}`, className]
        .filter(Boolean)
        .join(" ")}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
    >
      <View className={`h-full rounded-full ${fill}`} style={{ width: `${fraction * 100}%` }} />
    </View>
  );
}
