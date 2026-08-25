import { describe, expect, it } from "vitest";
import type { HealthMetricPoint } from "@personal-os/schema";
import { MIN_BAR_HEIGHT, buildHealthChart } from "./chart-geometry";

const WIDTH = 320;
const HEIGHT = 120;

function value(localDate: string, v: string): HealthMetricPoint {
  return { local_date: localDate, state: "value", value: v, source_count: 1 };
}

function absent(localDate: string): HealthMetricPoint {
  return { local_date: localDate, state: "verified_absent", value: null, source_count: null };
}

function unknown(localDate: string): HealthMetricPoint {
  return { local_date: localDate, state: "unknown", value: null, source_count: null };
}

function day(n: number): string {
  return `2026-08-${String(n).padStart(2, "0")}`;
}

describe("buildHealthChart empty input", () => {
  it("returns empty geometry rather than throwing", () => {
    const chart = buildHealthChart({
      points: [],
      width: WIDTH,
      height: HEIGHT,
      kind: "bar",
      aggregation: "sum",
    });
    expect(chart.bars).toEqual([]);
    expect(chart.line).toEqual([]);
    expect(chart.gaps).toEqual([]);
    expect(chart.min).toBeNull();
    expect(chart.max).toBeNull();
  });

  it("draws no bars and no line values when nothing in the range is readable", () => {
    const points = [absent(day(1)), unknown(day(2)), absent(day(3))];
    const bar = buildHealthChart({
      points,
      width: WIDTH,
      height: HEIGHT,
      kind: "bar",
      aggregation: "sum",
    });
    expect(bar.bars).toEqual([]);
    expect(bar.min).toBeNull();
    expect(bar.gaps.map((g) => g.state)).toEqual(["verified_absent", "unknown", "verified_absent"]);

    const line = buildHealthChart({
      points,
      width: WIDTH,
      height: HEIGHT,
      kind: "line",
      aggregation: "average",
    });
    // A flat line along the bottom would be a chart of zeros; every y is null.
    expect(line.line.every((p) => p.y === null)).toBe(true);
  });
});

describe("buildHealthChart missing days", () => {
  it("emits no bar at all for a missing day", () => {
    const chart = buildHealthChart({
      points: [value(day(1), "5000"), absent(day(2)), value(day(3), "7000")],
      width: WIDTH,
      height: HEIGHT,
      kind: "bar",
      aggregation: "sum",
    });
    expect(chart.bars.map((b) => b.localDate)).toEqual([day(1), day(3)]);
    expect(chart.bars.every((b) => b.height > 0)).toBe(true);
  });

  it("breaks the line at a missing day instead of interpolating across it", () => {
    const chart = buildHealthChart({
      points: [value(day(1), "60"), unknown(day(2)), value(day(3), "70")],
      width: WIDTH,
      height: HEIGHT,
      kind: "line",
      aggregation: "average",
    });
    expect(chart.line).toHaveLength(3);
    expect(chart.line[0].y).not.toBeNull();
    expect(chart.line[1].y).toBeNull();
    expect(chart.line[2].y).not.toBeNull();
  });

  it("reports every non-value day in gaps with its state verbatim", () => {
    const chart = buildHealthChart({
      points: [value(day(1), "1"), absent(day(2)), unknown(day(3))],
      width: WIDTH,
      height: HEIGHT,
      kind: "bar",
      aggregation: "sum",
    });
    expect(chart.gaps).toEqual([
      { localDate: day(2), state: "verified_absent" },
      { localDate: day(3), state: "unknown" },
    ]);
  });

  it("refuses to position a declared value it cannot parse, rather than drawing a zero", () => {
    const corrupt: HealthMetricPoint = {
      local_date: day(2),
      state: "value",
      value: "not-a-number",
      source_count: 1,
    };
    const chart = buildHealthChart({
      points: [value(day(1), "100"), corrupt],
      width: WIDTH,
      height: HEIGHT,
      kind: "bar",
      aggregation: "sum",
    });
    expect(chart.bars.map((b) => b.localDate)).toEqual([day(1)]);
    expect(chart.gaps).toEqual([{ localDate: day(2), state: "value" }]);
    expect(chart.max).toBe(100);
  });
});

describe("buildHealthChart genuine zeros", () => {
  it("draws a visible bar for a recorded zero, distinct from a missing day", () => {
    // The single most important assertion in this file. A recorded zero is
    // data; a missing day is not, and the two must never look the same.
    const chart = buildHealthChart({
      points: [value(day(1), "0"), absent(day(2)), value(day(3), "8000")],
      width: WIDTH,
      height: HEIGHT,
      kind: "bar",
      aggregation: "sum",
    });

    const zeroBar = chart.bars.find((b) => b.localDate === day(1));
    expect(zeroBar).toBeDefined();
    expect(zeroBar?.height).toBe(MIN_BAR_HEIGHT);
    expect(zeroBar?.value).toBe("0");
    expect(zeroBar?.hasValue).toBe(true);

    expect(chart.bars.some((b) => b.localDate === day(2))).toBe(false);
    expect(chart.gaps).toEqual([{ localDate: day(2), state: "verified_absent" }]);
  });

  it("places a recorded zero on the line rather than dropping it", () => {
    const chart = buildHealthChart({
      points: [value(day(1), "0"), value(day(2), "10")],
      width: WIDTH,
      height: HEIGHT,
      kind: "line",
      aggregation: "sum",
    });
    expect(chart.line[0].y).not.toBeNull();
    expect(chart.line[0].y).toBe(HEIGHT);
  });

  it("draws an all-zero series as visible bars, not as an empty chart", () => {
    const chart = buildHealthChart({
      points: [value(day(1), "0"), value(day(2), "0"), value(day(3), "0")],
      width: WIDTH,
      height: HEIGHT,
      kind: "bar",
      aggregation: "sum",
    });
    expect(chart.bars).toHaveLength(3);
    expect(chart.bars.every((b) => b.height === MIN_BAR_HEIGHT)).toBe(true);
    expect(chart.min).toBe(0);
    expect(chart.max).toBe(0);
    expect(chart.gaps).toEqual([]);
  });
});

describe("buildHealthChart scale", () => {
  it("anchors a sum domain at zero so an ordinary day is not flattened", () => {
    const chart = buildHealthChart({
      points: [value(day(1), "6000"), value(day(2), "8000")],
      width: WIDTH,
      height: HEIGHT,
      kind: "bar",
      aggregation: "sum",
    });
    expect(chart.domainMin).toBe(0);
    expect(chart.domainMax).toBe(8000);
    // 6000 of an 8000 domain sits three quarters up the frame.
    expect(chart.bars[0].height).toBeCloseTo(HEIGHT * 0.75, 5);
  });

  it("pads an average domain below the minimum so the series is legible", () => {
    const chart = buildHealthChart({
      points: [value(day(1), "58"), value(day(2), "62")],
      width: WIDTH,
      height: HEIGHT,
      kind: "line",
      aggregation: "average",
    });
    expect(chart.domainMin).toBeCloseTo(57.6, 5);
    expect(chart.domainMax).toBeCloseTo(62.4, 5);
    expect(chart.min).toBe(58);
    expect(chart.max).toBe(62);
  });

  it("never lets a padded floor push a value outside the frame", () => {
    const chart = buildHealthChart({
      points: [value(day(1), "58"), value(day(2), "62"), value(day(3), "60")],
      width: WIDTH,
      height: HEIGHT,
      kind: "line",
      aggregation: "average",
    });
    for (const point of chart.line) {
      expect(point.y).not.toBeNull();
      expect(point.y as number).toBeGreaterThanOrEqual(0);
      expect(point.y as number).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it("survives an all-equal average series without dividing by zero", () => {
    const chart = buildHealthChart({
      points: [value(day(1), "60"), value(day(2), "60"), value(day(3), "60")],
      width: WIDTH,
      height: HEIGHT,
      kind: "line",
      aggregation: "average",
    });
    expect(chart.line.every((p) => p.y === HEIGHT / 2)).toBe(true);
    expect(chart.min).toBe(60);
    expect(chart.max).toBe(60);
  });

  it("handles a negative-capable metric without clamping the domain to zero", () => {
    const chart = buildHealthChart({
      points: [value(day(1), "-0.4"), value(day(2), "0.2")],
      width: WIDTH,
      height: HEIGHT,
      kind: "line",
      aggregation: "average",
    });
    expect(chart.domainMin as number).toBeLessThan(-0.4);
    // Zero is inside the domain, so the reference line sits inside the frame.
    expect(chart.baseline).toBeGreaterThan(0);
    expect(chart.baseline).toBeLessThan(HEIGHT);
  });
});

describe("buildHealthChart horizontal geometry", () => {
  it("tiles the full width with no cumulative drift across 90 points", () => {
    const points = Array.from({ length: 90 }, (_, i) => ({
      local_date: new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10),
      state: "value" as const,
      value: String(1000 + i),
      source_count: 1,
    }));
    const chart = buildHealthChart({
      points,
      width: 481,
      height: HEIGHT,
      kind: "bar",
      aggregation: "sum",
    });

    expect(chart.bars).toHaveLength(90);
    expect(chart.bars[0].x).toBe(0);

    const last = chart.bars[89];
    expect(Math.abs(last.x + last.width - 481)).toBeLessThanOrEqual(1);

    // Abutting slots: each bar starts exactly where the previous one ended.
    for (let i = 1; i < chart.bars.length; i += 1) {
      expect(chart.bars[i].x).toBe(chart.bars[i - 1].x + chart.bars[i - 1].width);
    }
    // Every slot carries real width; none collapses to a hairline.
    expect(chart.bars.every((b) => b.width >= 1)).toBe(true);
  });

  it("keeps slot positions even when days in the middle are missing", () => {
    const chart = buildHealthChart({
      points: [value(day(1), "1"), absent(day(2)), value(day(3), "2"), value(day(4), "3")],
      width: 400,
      height: HEIGHT,
      kind: "bar",
      aggregation: "sum",
    });
    // The third day keeps its own slot rather than sliding left into the gap.
    expect(chart.bars.map((b) => b.x)).toEqual([0, 200, 300]);
  });

  it("centres line points within their slot", () => {
    const chart = buildHealthChart({
      points: [value(day(1), "1"), value(day(2), "2")],
      width: 400,
      height: HEIGHT,
      kind: "line",
      aggregation: "average",
    });
    expect(chart.line.map((p) => p.x)).toEqual([100, 300]);
  });
});

describe("buildHealthChart kind", () => {
  it("computes only the series the caller will draw", () => {
    const points = [value(day(1), "5"), value(day(2), "6")];
    const bar = buildHealthChart({
      points,
      width: WIDTH,
      height: HEIGHT,
      kind: "bar",
      aggregation: "sum",
    });
    expect(bar.bars).toHaveLength(2);
    expect(bar.line).toEqual([]);

    const line = buildHealthChart({
      points,
      width: WIDTH,
      height: HEIGHT,
      kind: "line",
      aggregation: "average",
    });
    expect(line.line).toHaveLength(2);
    expect(line.bars).toEqual([]);
  });
});
