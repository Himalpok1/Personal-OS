// The handful of numbers the Health screen leads with (Checkpoint 10.3).
//
// Pure, so the /health gradient summary is a renderer over this and the same
// tests that pin the tiles pin it. It applies the SAME frozen precedence
// the grid tiles use (resolveMetricDisplay) and the same formatter
// (formatHealthValue): a metric earns a headline slot only when it has a
// real recorded value for the requested civil date. A missing metric is not
// listed AT ALL here -- not as a zero, not as a dash, not as an explanation;
// the grid below the summary has the room to say why it is missing.
import type { HealthMetricCapability, HealthMetricTile } from "@personal-os/schema";
import { formatHealthValue } from "./format";
import { resolveMetricDisplay } from "./metric-state";

export interface HeadlineMetric {
  metric: string;
  /** Already formatted -- the summary never rounds or localises. */
  text: string;
  unitLabel: string;
}

/** At most this many numbers lead the screen; the grid carries the rest. */
export const MAX_HEADLINE_METRICS = 4;

export function pickHeadlineMetrics(
  today: readonly HealthMetricTile[],
  capabilities: readonly HealthMetricCapability[],
  todayLocalDate: string,
  max: number = MAX_HEADLINE_METRICS,
): HeadlineMetric[] {
  const byMetric = new Map(capabilities.map((capability) => [capability.metric, capability]));
  const headlines: HeadlineMetric[] = [];

  for (const tile of today) {
    if (headlines.length >= max) break;
    const capability = byMetric.get(tile.metric);
    // No capability means no honest explanation is possible either way; the
    // grid drops the tile for the same reason (health/index.tsx).
    if (capability === undefined) continue;

    const display = resolveMetricDisplay({ tile, capability, todayLocalDate });
    if (display.state !== "value" || display.value === null) continue;

    const formatted = formatHealthValue(display.value, tile.unit);
    headlines.push({ metric: tile.metric, text: formatted.text, unitLabel: formatted.unitLabel });
  }

  return headlines;
}
