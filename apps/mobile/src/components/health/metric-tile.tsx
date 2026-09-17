// One metric, one civil day. A thin renderer over metric-state.ts and
// format.ts -- the same split as brief/brief-card.tsx over
// brief-card-state.ts: every decision worth testing already happened in a
// pure module, so this file branches on a resolved state rather than
// re-deriving one.
//
// The single rule this component exists to enforce: a MISSING value never
// renders as a number. Not `0`, not `-`, not `--`, not an em dash. Missing
// states get words, because on this account twelve of the eighteen enabled
// streams have never produced a value (Checkpoint 6.3L), so "missing" is the
// COMMON case here, not the edge case -- and a dashboard whose common case
// reads as a measurement is worse than no dashboard.
import { Pressable, View } from "react-native";
import type { HealthMetricCapability, HealthMetricTile } from "@personal-os/schema";
import { AppText, cardClass } from "@/components/ui";
import { formatShortDate } from "@/utils/local-date";
import { formatHealthValue, metricLabel, metricShortLabel } from "./format";
import { METRIC_EXPLANATIONS, isMetricMissing, resolveMetricDisplay } from "./metric-state";

export interface MetricTileProps {
  tile: HealthMetricTile;
  capability: HealthMetricCapability;
  /** HealthSummaryResponse.local_date -- the requested timezone's local date. */
  todayLocalDate: string;
  /**
   * The most recent recorded value for this metric, from
   * HealthSummaryResponse.latest. Rendered as an extra line when today has no
   * value -- never in place of the missing-state words, so an older number can
   * never be read as today's.
   */
  latest?: HealthMetricTile;
  /** 480px Rabbit layout: shorter labels, tighter padding, stacked rows. */
  compact?: boolean;
  onPress?: () => void;
}

// Fixed minimum so a tile showing a number and a tile showing a sentence
// occupy the same space. Without this the grid reflows every time a sync
// fills in a value, which on a screen where most tiles are empty means the
// whole dashboard jumps whenever anything lands.
const TILE_MIN_HEIGHT = "min-h-[104px]";

// The design system's card vocabulary (Checkpoint 10.3), composed through
// `cardClass` rather than rendered through `Card` because the tile must be
// `accessible`: a screen reader reads the whole tile as ONE element carrying
// the label built below, and `Card` exposes no such prop.
const TILE_CLASS = cardClass("none", "card", `flex-1 ${TILE_MIN_HEIGHT}`);

/**
 * The "last recorded" line, or null.
 *
 * Deliberately suppressed when the latest point IS today's date: repeating
 * today's own number as "last recorded today" is noise, and it would appear
 * exactly in the confusing case where the tile is missing for a reason
 * (disabled/unscoped) that outranks a stored value in the precedence table.
 */
function latestLine(
  latest: HealthMetricTile | undefined,
  unit: string,
  currentDate: string,
): string | null {
  if (latest === undefined) return null;
  const point = latest.point;
  if (point.state !== "value" || point.value === null) return null;
  if (point.local_date === currentDate) return null;
  const formatted = formatHealthValue(point.value, unit);
  const value = formatted.unitLabel ? `${formatted.text} ${formatted.unitLabel}` : formatted.text;
  return `Last recorded ${value} on ${formatShortDate(point.local_date)}`;
}

export function MetricTile({
  tile,
  capability,
  todayLocalDate,
  latest,
  compact,
  onPress,
}: MetricTileProps) {
  const display = resolveMetricDisplay({ tile, capability, todayLocalDate });
  const label = compact ? metricShortLabel(tile.metric) : metricLabel(tile.metric);
  const missing = isMetricMissing(display.state);

  const formatted = display.value === null ? null : formatHealthValue(display.value, tile.unit);
  const explanation =
    display.explanation === null ? null : METRIC_EXPLANATIONS[display.explanation];
  const fallback = missing ? latestLine(latest, tile.unit, display.localDate) : null;

  // The label a screen reader announces. Built from the same resolved state
  // as the visible tree rather than from the tree itself, so the two cannot
  // drift -- and it always carries the DATE, because "Steps: 8,000" with no
  // date is the exact ambiguity the `latest` fallback exists to remove.
  const spokenValue =
    formatted === null
      ? (explanation ?? "no data")
      : formatted.unitLabel
        ? `${formatted.text} ${formatted.unitLabel}`
        : formatted.text;
  const accessibilityLabel = [
    `${label}: ${spokenValue}`,
    formatShortDate(display.localDate),
    fallback,
  ]
    .filter((part): part is string => part !== null)
    .join(". ");

  const body = (
    <View className={compact ? "gap-1 p-3" : "gap-1 p-4"}>
      <AppText variant="overline" tone="muted" numberOfLines={1}>
        {label}
      </AppText>

      {formatted === null ? (
        // No numeric node is rendered at all in a missing state. Not a dimmed
        // zero, not a placeholder glyph -- there is simply no number on
        // screen, which is the only rendering a reader cannot mistake for a
        // measurement.
        <AppText variant={compact ? "caption" : "label"} tone="secondary" className="font-normal">
          {explanation}
        </AppText>
      ) : (
        <View className="flex-row items-baseline gap-1">
          <AppText variant={compact ? "headline" : "display"}>{formatted.text}</AppText>
          {formatted.unitLabel ? (
            <AppText variant="label" tone="muted">
              {formatted.unitLabel}
            </AppText>
          ) : null}
        </View>
      )}

      {fallback ? (
        <AppText variant="caption" tone="muted" numberOfLines={2}>
          {fallback}
        </AppText>
      ) : null}
    </View>
  );

  if (onPress === undefined) {
    return (
      <View className={TILE_CLASS} accessible accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      className={`${TILE_CLASS} active:opacity-70`}
    >
      {body}
    </Pressable>
  );
}
