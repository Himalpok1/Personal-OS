// Last night against the trailing week (Checkpoint 10.6).
//
// The ONE comparison HealthSummaryResponse already carries is
// `latest_sleep.duration_seconds` against `sleep_7d_average_seconds` (the
// mean nightly duration over the trailing seven wake-dates, null when no
// night landed in that window). Nothing else on the summary has a
// seven-day figure -- `today` and `latest` are single points -- so this is
// the only trend line the Health screen can print without inventing a
// number, and it is derived here, purely, so the card is a renderer over it.
//
// The words never carry an `Nh Nm` duration: the sleep card already prints
// exactly two of those (the night and the average), and a third would read
// as a stage figure (health-components.test.tsx pins the count).
import type { IconName } from "@/components/ui";

export type SleepTrendDirection = "above" | "below" | "on_par";

export interface SleepTrend {
  direction: SleepTrendDirection;
  /** Signed: last night minus the average, in seconds. */
  deltaSeconds: number;
  /** "35 min above your 7-day average" / "On par with your 7-day average". */
  caption: string;
  icon: IconName;
}

/** Within this many seconds of the average the night reads as "on par". */
export const SLEEP_TREND_ON_PAR_SECONDS = 5 * 60;

const ICON: Record<SleepTrendDirection, IconName> = {
  above: "trending-up",
  below: "trending-down",
  on_par: "trending-neutral",
};

/**
 * `1 h 5 min`, `1 h`, `35 min` -- spaced so the string can never match the
 * `\d+h \d+m` duration shape the rest of the health surface uses.
 */
export function formatSleepDelta(seconds: number): string {
  const totalMinutes = Math.round(Math.abs(seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export function describeSleepTrend(
  durationSeconds: number,
  averageSeconds: number | null,
): SleepTrend | null {
  if (averageSeconds === null) return null;
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(averageSeconds)) return null;

  const deltaSeconds = durationSeconds - averageSeconds;
  if (Math.abs(deltaSeconds) < SLEEP_TREND_ON_PAR_SECONDS) {
    return {
      direction: "on_par",
      deltaSeconds,
      caption: "On par with your 7-day average",
      icon: ICON.on_par,
    };
  }

  const direction: SleepTrendDirection = deltaSeconds > 0 ? "above" : "below";
  return {
    direction,
    deltaSeconds,
    caption: `${formatSleepDelta(deltaSeconds)} ${direction} your 7-day average`,
    icon: ICON[direction],
  };
}
