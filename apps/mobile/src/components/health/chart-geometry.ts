// Pure chart geometry, hand-rolled and React-free -- the same pattern as
// calendar/week-grid-layout.ts, which computes the week view's placement math
// as plain data and lets a thin RN component render it with ordinary Views.
//
// There is deliberately NO charting dependency in this repo and none is being
// added. Beyond the bundle cost on a 480x640 device, a charting library's
// default behaviour is the exact thing this surface cannot tolerate: given a
// series with holes, every mainstream chart component either drops the gap and
// connects across it, or fills it with zero. Both draw a value we do not have.
// Owning the geometry is what makes "a gap is a gap" enforceable and testable.
import type { HealthAggregation, HealthMetricPoint, HealthValueState } from "@personal-os/schema";

/**
 * Minimum drawn bar height, in pixels.
 *
 * This exists for exactly one case and it is the most important assertion in
 * this file: a GENUINE RECORDED ZERO (state "value", value "0") must render as
 * a visible bar, distinct from a day with no bar at all. Zero steps on a day
 * the watch was worn is data; a missing day is not. Migration 0013's has_data
 * CHECK (ADR-047) exists to keep those apart in Postgres, and the chart is the
 * last place the distinction can be thrown away.
 */
export const MIN_BAR_HEIGHT = 2;

/**
 * Head/foot padding applied to an `average` domain, as a fraction of the data
 * range. A resting-heart-rate chart scaled from zero is a flat line at the top
 * of the frame and tells the reader nothing.
 */
export const AVERAGE_DOMAIN_PAD_RATIO = 0.1;

/** Where a degenerate (all-equal) average series is drawn within the frame. */
const FLAT_SERIES_RATIO = 0.5;

export interface HealthChartBar {
  localDate: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Always true. Bars are only ever emitted for readable values. */
  hasValue: boolean;
  value: string | null;
}

export interface HealthChartLinePoint {
  localDate: string;
  x: number;
  /**
   * null where there is no readable value. A renderer MUST break the path
   * here: joining across a null is interpolation, and an interpolated health
   * value is a number nobody recorded.
   */
  y: number | null;
}

export interface HealthChartGap {
  localDate: string;
  /**
   * The API's own state for the day, passed through verbatim.
   *
   * `"value"` can legitimately appear here in one pathological case: the API
   * declared a value we could not parse. We refuse to position a number we
   * cannot read rather than drawing it at the floor, so it lands in the gaps
   * with its declared state intact.
   */
  state: HealthValueState;
}

export interface HealthChart {
  bars: HealthChartBar[];
  line: HealthChartLinePoint[];
  /** Smallest readable value in the series, or null when there are none. */
  min: number | null;
  /** Largest readable value in the series, or null when there are none. */
  max: number | null;
  /** Lower edge of the drawn value domain (0 for `sum`). */
  domainMin: number | null;
  /** Upper edge of the drawn value domain. */
  domainMax: number | null;
  /**
   * y of the zero line, for a renderer that wants a reference rule -- clamped
   * into the frame, so it sits at the bottom whenever zero is off-domain.
   * Bars themselves are always drawn from the frame's floor, never from here;
   * splitting bars above and below a zero line would be a different chart.
   */
  baseline: number;
  gaps: HealthChartGap[];
}

export interface BuildHealthChartInput {
  points: readonly HealthMetricPoint[];
  width: number;
  height: number;
  /**
   * Which series to populate. Only one is computed: a caller renders bars or a
   * line, never both, and emitting geometry nobody draws invites a renderer to
   * quietly pick the wrong one.
   */
  kind: "bar" | "line";
  /**
   * From the catalog, never guessed per screen (HealthAggregationSchema's own
   * comment): summing resting heart rate and averaging steps are both
   * nonsense, and the correct answer is a property of the metric.
   */
  aggregation: HealthAggregation;
}

const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

function readValue(point: HealthMetricPoint): number | null {
  if (point.state !== "value" || point.value === null) return null;
  const trimmed = point.value.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Slot edges that tile the full width exactly.
 *
 * Each interior edge is rounded independently from the exact fraction rather
 * than accumulated, so error cannot compound across 90 points, and the final
 * edge is returned unrounded so the last slot's right side lands precisely on
 * `width`.
 */
function slotEdge(index: number, count: number, width: number): number {
  return index >= count ? width : Math.round((index * width) / count);
}

export function buildHealthChart(input: BuildHealthChartInput): HealthChart {
  const { points, width, height, kind, aggregation } = input;
  const count = points.length;

  if (count === 0) {
    return {
      bars: [],
      line: [],
      min: null,
      max: null,
      domainMin: null,
      domainMax: null,
      baseline: height,
      gaps: [],
    };
  }

  const readings = points.map(readValue);
  const values = readings.filter((v): v is number => v !== null);

  const gaps: HealthChartGap[] = [];
  points.forEach((point, index) => {
    if (readings[index] === null) gaps.push({ localDate: point.local_date, state: point.state });
  });

  if (values.length === 0) {
    // Nothing readable: no bars at all, and a line of pure holes. Emphatically
    // not a flat line along the bottom, which is a chart of zeros.
    return {
      bars: [],
      line:
        kind === "line"
          ? points.map((point, index) => ({
              localDate: point.local_date,
              x: (slotEdge(index, count, width) + slotEdge(index + 1, count, width)) / 2,
              y: null,
            }))
          : [],
      min: null,
      max: null,
      domainMin: null,
      domainMax: null,
      baseline: height,
      gaps,
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);

  let domainMin: number;
  let domainMax: number;
  if (aggregation === "sum") {
    // A count or a total is only meaningful against zero -- a step chart whose
    // floor is 6,000 makes an ordinary day look like a rest day.
    domainMin = Math.min(0, min);
    domainMax = Math.max(0, max);
  } else {
    const pad = (max - min) * AVERAGE_DOMAIN_PAD_RATIO;
    domainMin = min - pad;
    domainMax = max + pad;
  }
  const span = domainMax - domainMin;

  // `pad` is non-negative, so domainMin <= min always: the padded floor can
  // never push a real value below the frame. The clamp below makes that
  // structural rather than merely argued.
  const yFor = (value: number): number => {
    if (span === 0) {
      // Every readable value is identical. For `sum` that can only mean they
      // are all zero, which belongs at the floor; for `average` a flat run of
      // real readings is drawn mid-frame so it is legible as a line.
      return aggregation === "sum" ? height - MIN_BAR_HEIGHT : height * FLAT_SERIES_RATIO;
    }
    const raw = height - ((value - domainMin) / span) * height;
    return Math.min(height, Math.max(0, raw));
  };

  const bars: HealthChartBar[] = [];
  const line: HealthChartLinePoint[] = [];

  points.forEach((point, index) => {
    const left = slotEdge(index, count, width);
    const right = slotEdge(index + 1, count, width);
    const value = readings[index];

    if (kind === "line") {
      line.push({
        localDate: point.local_date,
        x: (left + right) / 2,
        y: value === null ? null : yFor(value),
      });
      return;
    }

    // A missing day produces NO bar -- not a zero-height one, which a renderer
    // could still give a border, and certainly not a full-height one.
    if (value === null) return;

    // Floor the top edge so even a zero keeps MIN_BAR_HEIGHT of ink.
    const top = Math.min(yFor(value), height - MIN_BAR_HEIGHT);
    bars.push({
      localDate: point.local_date,
      x: left,
      y: top,
      width: right - left,
      height: height - top,
      hasValue: true,
      value: point.value,
    });
  });

  const zeroY = span === 0 ? height : height - ((0 - domainMin) / span) * height;

  return {
    bars,
    line,
    min,
    max,
    domainMin,
    domainMax,
    baseline: Math.min(height, Math.max(0, zeroY)),
    gaps,
  };
}
