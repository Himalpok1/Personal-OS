// A day-series chart drawn with plain Views over chart-geometry.ts, in the
// same shape as calendar/week-grid.tsx over week-grid-layout.ts: tested pure
// math, thin untested renderer.
//
// NO CHARTING LIBRARY, and none is being added -- `react-native-svg` is not a
// dependency of this app either (checked, not assumed). That is a constraint
// worth stating rather than working around, because the default behaviour of
// every mainstream chart component is precisely what this surface cannot
// tolerate: given a series with holes it either connects across them or fills
// them with zero, and both draw a number nobody recorded. Owning the drawing
// is what makes "a gap is a gap" something a test can assert.
import { Text, View } from "react-native";
import type { HealthAggregation, HealthMetricPoint } from "@personal-os/schema";
import { formatShortDate } from "@/utils/local-date";
import { GAP_MARKER_HEIGHT, GAP_MARKER_WIDTH, buildHealthChart, slotEdge } from "./chart-geometry";
import { formatHealthValue, metricLabel } from "./format";

const LINE_THICKNESS = 2;
const POINT_DOT_SIZE = 4;
// Slot tiling, the gap-marker geometry and MIN_BAR_HEIGHT all come from
// chart-geometry.ts. `slotEdge` used to be hand-copied here, on the reasoning
// that exporting it would mean editing a file this component "does not own" --
// which was an authorship artifact, not a constraint. Two copies of a tiling
// function can drift, and if they do the gap markers slide out from under the
// days they describe. One definition, imported.

interface LineSegment {
  key: string;
  left: number;
  top: number;
  length: number;
  angleDeg: number;
}

/**
 * Consecutive readable pairs only.
 *
 * A null `y` ends the current run and starts a new one, so the path BREAKS at
 * every gap instead of being interpolated across it. This is the whole reason
 * the geometry emits `y: null` rather than dropping the point.
 */
function buildSegments(line: readonly { localDate: string; x: number; y: number | null }[]) {
  const segments: LineSegment[] = [];
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i]!;
    const b = line[i + 1]!;
    if (a.y === null || b.y === null) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) continue;
    segments.push({
      key: `${a.localDate}:${b.localDate}`,
      // Positioned by its MIDPOINT and then rotated, because RN rotates a
      // view about its own centre -- anchoring at the left edge instead would
      // swing every segment away from its endpoints.
      left: (a.x + b.x) / 2 - length / 2,
      top: (a.y + b.y) / 2 - LINE_THICKNESS / 2,
      length,
      angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
    });
  }
  return segments;
}

interface SeriesCounts {
  withValue: number;
  verifiedAbsent: number;
  unknown: number;
}

function countStates(points: readonly HealthMetricPoint[]): SeriesCounts {
  let withValue = 0;
  let verifiedAbsent = 0;
  let unknown = 0;
  for (const point of points) {
    if (point.state === "value" && point.value !== null) withValue += 1;
    else if (point.state === "verified_absent") verifiedAbsent += 1;
    else unknown += 1;
  }
  return { withValue, verifiedAbsent, unknown };
}

/**
 * The chart in words.
 *
 * Always rendered, never an alternative to the picture. It is the screen
 * reader's version, the no-colour version, and the version that survives a
 * reader who cannot tell a faint gap marker from a very short bar -- and
 * every one of those readers needs the counts, because "5 bars over 30 days"
 * is a fundamentally different fact from "30 bars" and the drawing alone does
 * not say which of the 25 blanks were checked.
 */
export function ChartDataSummary({
  metric,
  points,
  unit,
}: {
  metric: string;
  points: HealthMetricPoint[];
  unit: string;
}) {
  return (
    <Text className="text-xs leading-4 text-neutral-500 dark:text-neutral-400">
      {describeSeries(metric, points, unit)}
    </Text>
  );
}

/**
 * Shared by ChartDataSummary and the chart's own accessibilityLabel so the
 * spoken and printed descriptions cannot disagree.
 */
/**
 * The spoken description of ONE day.
 *
 * The aggregate summary tells a screen-reader user how many days have values;
 * it cannot tell them what happened on a particular day, which is the whole
 * point of a chart. Every mark -- bar or gap -- carries this, so the series is
 * interrogable rather than merely summarised.
 *
 * A recorded zero says "0", explicitly, and is never phrased like an absence.
 */
export function describeDay(point: HealthMetricPoint, metric: string, unit: string): string {
  const day = formatShortDate(point.local_date);
  if (point.state === "value" && point.value !== null) {
    const { text, unitLabel } = formatHealthValue(point.value, unit);
    return `${metricLabel(metric)}, ${day}: ${text}${unitLabel === "" ? "" : ` ${unitLabel}`}.`;
  }
  if (point.state === "verified_absent") {
    return `${metricLabel(metric)}, ${day}: checked, nothing recorded.`;
  }
  return `${metricLabel(metric)}, ${day}: not synced yet.`;
}

export function describeSeries(
  metric: string,
  points: readonly HealthMetricPoint[],
  unit: string,
): string {
  const label = metricLabel(metric);
  if (points.length === 0) return `${label}: no days in this range.`;

  const first = points[0]!.local_date;
  const last = points[points.length - 1]!.local_date;
  const range = first === last ? formatShortDate(first) : `${formatShortDate(first)} to ${formatShortDate(last)}`;
  const counts = countStates(points);

  const sentences = [
    `${label}, ${range}.`,
    `${counts.withValue} of ${points.length} days have a recorded value.`,
  ];

  if (counts.verifiedAbsent > 0) {
    sentences.push(
      `${counts.verifiedAbsent} ${counts.verifiedAbsent === 1 ? "day was" : "days were"} checked with nothing recorded.`,
    );
  }
  if (counts.unknown > 0) {
    sentences.push(
      `${counts.unknown} ${counts.unknown === 1 ? "day has" : "days have"} not been synced.`,
    );
  }

  if (counts.withValue > 0) {
    // min/max come back from the geometry rather than being re-parsed here,
    // so there is exactly one implementation of "which strings are readable".
    // Width/height are irrelevant to them, hence the 1x1 frame.
    const { min, max } = buildHealthChart({
      points,
      width: 1,
      height: 1,
      kind: "bar",
      aggregation: "sum",
    });
    if (min !== null && max !== null) {
      // String(number) is the shortest round-tripping form of the parsed
      // double. Display-only: the exact per-day strings are never routed
      // through the geometry, so nothing here can lose precision that a
      // reader could act on.
      const lo = formatHealthValue(String(min), unit);
      const hi = formatHealthValue(String(max), unit);
      const suffix = lo.unitLabel ? ` ${lo.unitLabel}` : "";
      sentences.push(
        min === max
          ? `Value ${lo.text}${suffix}.`
          : `Lowest ${lo.text}${suffix}, highest ${hi.text}${suffix}.`,
      );
    }
  }

  return sentences.join(" ");
}

export interface HealthChartProps {
  metric: string;
  points: HealthMetricPoint[];
  unit: string;
  aggregation: HealthAggregation;
  kind: "bar" | "line";
  width: number;
  height: number;
}

export function HealthChart({
  metric,
  points,
  unit,
  aggregation,
  kind,
  width,
  height,
}: HealthChartProps) {
  const description = describeSeries(metric, points, unit);

  if (points.length === 0) {
    // An honest empty frame, not a blank box. The height is still reserved so
    // toggling a range from "has days" to "has none" does not reflow the page.
    return (
      <View accessible accessibilityLabel={description}>
        <View
          style={{ width, height }}
          className="items-center justify-center rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700"
        >
          <Text className="px-3 text-center text-xs text-neutral-500 dark:text-neutral-400">
            No days in this range yet.
          </Text>
        </View>
        <ChartDataSummary metric={metric} points={points} unit={unit} />
      </View>
    );
  }

  const chart = buildHealthChart({ points, width, height, kind, aggregation });
  const segments = kind === "line" ? buildSegments(chart.line) : [];
  const gapDates = new Set(chart.gaps.map((gap) => gap.localDate));
  const count = points.length;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={description}>
      <View style={{ width, height }} className="relative overflow-hidden">
        {chart.bars.map((bar) => (
          <View
            key={`bar-${bar.localDate}`}
            accessible
            accessibilityRole="image"
            accessibilityLabel={describeDay(
              { local_date: bar.localDate, state: "value", value: bar.value, source_count: null },
              metric,
              unit,
            )}
            style={{
              position: "absolute",
              left: bar.x,
              top: bar.y,
              // A hairline inset keeps adjacent bars visually separate without
              // changing the tiling the geometry computed.
              width: Math.max(1, bar.width - 1),
              height: bar.height,
            }}
            className="rounded-sm bg-blue-500 dark:bg-blue-400"
          />
        ))}

        {segments.map((segment) => (
          <View
            key={`seg-${segment.key}`}
            style={{
              position: "absolute",
              left: segment.left,
              top: segment.top,
              width: segment.length,
              height: LINE_THICKNESS,
              transform: [{ rotate: `${segment.angleDeg}deg` }],
            }}
            className="bg-blue-500 dark:bg-blue-400"
          />
        ))}

        {kind === "line"
          ? chart.line
              .filter((point) => point.y !== null)
              .map((point) => (
                <View
                  key={`dot-${point.localDate}`}
                  style={{
                    position: "absolute",
                    left: point.x - POINT_DOT_SIZE / 2,
                    top: (point.y ?? 0) - POINT_DOT_SIZE / 2,
                    width: POINT_DOT_SIZE,
                    height: POINT_DOT_SIZE,
                  }}
                  className="rounded-full bg-blue-600 dark:bg-blue-300"
                />
              ))
          : null}

        {/* Gap markers. A faint rule sitting ON the floor, deliberately NOT a
            zero-height bar (which a border would still make visible as a
            value) and deliberately NOT a full-height one. It reads as "this
            slot is accounted for and holds nothing", which is the truth. */}
        {points.map((point, index) =>
          gapDates.has(point.local_date) ? (
            <View
              key={`gap-${point.local_date}`}
              accessible
              accessibilityRole="image"
              accessibilityLabel={describeDay(point, metric, unit)}
              style={{
                position: "absolute",
                // Centred in the slot and only GAP_MARKER_WIDTH wide, so a
                // gap differs from the thinnest real bar in width as well as
                // height and colour. Three redundant channels, because colour
                // alone is not a channel for everyone.
                left:
                  (slotEdge(index, count, width) + slotEdge(index + 1, count, width)) / 2 -
                  GAP_MARKER_WIDTH / 2,
                top: height - GAP_MARKER_HEIGHT,
                width: GAP_MARKER_WIDTH,
                height: GAP_MARKER_HEIGHT,
              }}
              className="bg-neutral-300 dark:bg-neutral-700"
            />
          ) : null,
        )}
      </View>
      <ChartDataSummary metric={metric} points={points} unit={unit} />
    </View>
  );
}
