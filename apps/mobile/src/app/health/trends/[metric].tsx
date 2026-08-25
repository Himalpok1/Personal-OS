import { ApiClientError } from "@personal-os/api-client";
import type { HealthMetricSeriesResponse } from "@personal-os/schema";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { FLOATING_CLEARANCE } from "@/components/floating-layout";
import { formatHealthValue, metricLabel } from "@/components/health/format";
import { ChartDataSummary, HealthChart } from "@/components/health/health-chart";
import { METRIC_EXPLANATIONS, resolveMetricDisplay } from "@/components/health/metric-state";
import { useHealthMetricSeries, useHealthSummary } from "@/queries/health";
import { addLocalDays, formatShortDate, todayLocalDate } from "@/utils/local-date";

// One metric's daily trend over a bounded recent range.
//
// Three ranges and no year option. The brief permits 90 days "if it stays
// simple", and it does -- but a 365-day range would be a different screen: 90
// points already crowd a 480px-wide chart, and the sync engine's warm window
// only re-verifies a trailing span (ADR-046's 35-day staleness contract), so a
// year of history is mostly rows nothing has revisited.

const RANGES = [7, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];

/**
 * Bars for a summed metric, a line for an averaged one.
 *
 * The mapping is derived from the catalog's `aggregation`, never chosen per
 * screen: a bar's area reads as an accumulated quantity, which is true of steps
 * and false of resting heart rate. Summing resting heart rate and averaging
 * steps are both nonsense, and the correct answer is a property of the metric
 * (HealthAggregationSchema's own comment).
 */
function chartKind(aggregation: HealthMetricSeriesResponse["aggregation"]): "bar" | "line" {
  return aggregation === "sum" ? "bar" : "line";
}

function RangeSelector({
  value,
  onChange,
}: {
  value: RangeDays;
  onChange: (days: RangeDays) => void;
}) {
  return (
    <View className="flex-row gap-2 px-4 pt-3">
      {RANGES.map((days) => {
        const selected = days === value;
        return (
          <Pressable
            key={days}
            onPress={() => onChange(days)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Show the last ${days} days`}
            className={`min-h-[44px] flex-1 items-center justify-center rounded-lg px-3 ${
              selected
                ? "bg-blue-600"
                : "bg-neutral-100 active:bg-neutral-200 dark:bg-neutral-900 dark:active:bg-neutral-800"
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                selected ? "text-white" : "text-neutral-700 dark:text-neutral-200"
              }`}
            >
              {days} days
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className="text-sm text-neutral-500 dark:text-neutral-400">{label}</Text>
      <Text className="text-sm font-medium text-black dark:text-white">{value}</Text>
    </View>
  );
}

/**
 * Aggregates and day counts.
 *
 * Two rules run through every line here. First, only the aggregate the
 * metric's own `aggregation` declares meaningful is printed -- a total of
 * resting heart rate is a number with no referent, and printing both would
 * invite reading the wrong one. Second, a null aggregate is rendered as WORDS,
 * never as 0: the server returns null exactly when no day in the range carried
 * a value (HealthSeriesSummarySchema), and "0 steps on average" is a different,
 * false claim.
 */
function SeriesStats({ series }: { series: HealthMetricSeriesResponse }) {
  const { summary, unit, aggregation } = series;

  const format = (value: string | null): string => {
    if (value === null) return "No data";
    const formatted = formatHealthValue(value, unit);
    return formatted.unitLabel ? `${formatted.text} ${formatted.unitLabel}` : formatted.text;
  };

  return (
    <View className="mx-4 mt-4 rounded-xl border border-neutral-200 px-4 py-2 dark:border-neutral-800">
      {aggregation === "sum" ? (
        <StatRow label="Total" value={format(summary.total)} />
      ) : (
        <StatRow label="Average" value={format(summary.average)} />
      )}
      <StatRow label="Lowest" value={format(summary.min)} />
      <StatRow label="Highest" value={format(summary.max)} />
      <View className="my-1 h-px bg-neutral-200 dark:bg-neutral-800" />
      <StatRow
        label="Days with a value"
        value={`${summary.days_with_value} of ${summary.days_in_range}`}
      />
      {/* "Checked, nothing recorded" and "never checked" are different facts and
          are never merged into one "no data" count -- that collapse is the same
          class of mistake as rendering a missing value as zero. */}
      <StatRow label="Checked — nothing recorded" value={String(summary.days_verified_absent)} />
      <StatRow label="Not synced yet" value={String(summary.days_unknown)} />
    </View>
  );
}

function CenteredMessage({ title, body }: { title: string; body?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-white px-6 dark:bg-black">
      <Text className="text-center text-base font-medium text-black dark:text-white">{title}</Text>
      {body === undefined ? null : (
        <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">{body}</Text>
      )}
    </View>
  );
}

function TrendContent({
  series,
  metric,
  compact,
  chartWidth,
  todayDate,
}: {
  series: HealthMetricSeriesResponse;
  metric: string;
  compact: boolean;
  chartWidth: number;
  todayDate: string;
}) {
  const rangeEmpty = series.summary.days_with_value === 0;

  // The explanation for an empty range comes from the SAME frozen precedence
  // the dashboard tiles use, fed by a real point rather than a fabricated one:
  // the last day in the range, which is the most recent thing we actually know.
  // Re-deriving "why is this blank" here is how "no data yet" quietly becomes
  // "unsupported" on one screen and not the other.
  const lastPoint = series.points[series.points.length - 1];
  const explanationKey =
    rangeEmpty && lastPoint !== undefined
      ? resolveMetricDisplay({
          tile: {
            metric: series.metric,
            unit: series.unit,
            aggregation: series.aggregation,
            point: lastPoint,
          },
          capability: series.capability,
          todayLocalDate: todayDate,
        }).explanation
      : null;

  return (
    <>
      <View className="px-4 pt-4">
        <Text className="text-2xl font-bold text-black dark:text-white">{metricLabel(metric)}</Text>
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">
          {formatShortDate(series.from)} – {formatShortDate(series.to)}
        </Text>
      </View>

      <View className="px-4 pt-4">
        <HealthChart
          metric={series.metric}
          points={series.points}
          unit={series.unit}
          aggregation={series.aggregation}
          kind={chartKind(series.aggregation)}
          width={chartWidth}
          height={compact ? 140 : 200}
        />
      </View>

      <View className="px-4 pt-2">
        <ChartDataSummary metric={series.metric} points={series.points} unit={series.unit} />
      </View>

      {explanationKey === null ? null : (
        <View className="mx-4 mt-4 rounded-xl bg-neutral-100 px-4 py-3 dark:bg-neutral-900">
          <Text className="text-sm text-neutral-600 dark:text-neutral-300">
            {METRIC_EXPLANATIONS[explanationKey]}
          </Text>
        </View>
      )}

      <SeriesStats series={series} />
    </>
  );
}

export default function HealthTrendScreen() {
  const params = useLocalSearchParams<{ metric: string }>();
  const metric = params.metric ?? "";
  const { width } = useWindowDimensions();
  const compact = width < 520;

  const [days, setDays] = useState<RangeDays>(30);

  // The summary's `local_date` is the requested timezone's own civil date,
  // computed server-side. Preferring it over the device clock keeps this screen
  // from disagreeing with the dashboard by a day around midnight or while
  // travelling; the device date is only a fallback for a cold load.
  const summary = useHealthSummary();
  const anchor = summary.data?.local_date ?? todayLocalDate();
  // `to` is INCLUSIVE (HealthSeriesQuerySchema), so "7 days" is today plus the
  // six before it -- not today minus seven, which would be eight dates.
  const to = anchor;
  const from = addLocalDays(anchor, -(days - 1));

  const series = useHealthMetricSeries({ metric, from, to, enabled: metric.length > 0 });

  // Chart width is measured, never hardcoded: this app renders at 480px on the
  // Rabbit R1 and at whatever a browser window happens to be. 32 = px-4 either
  // side; the floor stops a pathologically narrow window producing a chart with
  // negative width.
  const chartWidth = Math.max(240, width - 32);

  if (metric.length === 0) {
    return <CenteredMessage title="No metric was selected." />;
  }

  if (series.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Text className="text-neutral-500">Loading…</Text>
      </View>
    );
  }

  if (series.isError) {
    // `metric_not_readable` is the route's answer for a metric that has no daily
    // series at all -- sleep and exercise are sessions, and intraday heart rate
    // is deliberately never synced (6.2P F5 deferral). That is a fact about the
    // metric, not a failure, so it gets an honest sentence rather than an error
    // banner with a Retry that could never succeed.
    const notReadable =
      series.error instanceof ApiClientError && series.error.code === "metric_not_readable";

    if (notReadable) {
      return (
        <CenteredMessage
          title={`${metricLabel(metric)} doesn't have a daily trend.`}
          body="This one is recorded as individual sessions rather than a value per day."
        />
      );
    }

    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white px-6 dark:bg-black">
        <Text className="text-center text-red-600">Couldn&apos;t load this trend.</Text>
        <Pressable
          onPress={() => void series.refetch()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Retry loading this trend"
          className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
        >
          <Text className="font-semibold text-white">Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName={FLOATING_CLEARANCE}
      keyboardShouldPersistTaps="handled"
    >
      <RangeSelector value={days} onChange={setDays} />
      {series.data === undefined ? null : (
        <TrendContent
          series={series.data}
          metric={metric}
          compact={compact}
          chartWidth={chartWidth}
          todayDate={anchor}
        />
      )}
    </ScrollView>
  );
}
