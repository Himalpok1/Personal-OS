import type {
  HealthMetricCapability,
  HealthMetricTile,
  HealthSummaryResponse,
} from "@personal-os/schema";
import { useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { HealthConnectionCard } from "@/components/health/connection-card";
import { resolveHealthConnectionState } from "@/components/health/connection-state";
import { metricShortLabel } from "@/components/health/format";
import { pickHeadlineMetrics } from "@/components/health/headline-metrics";
import { MetricTile } from "@/components/health/metric-tile";
import { SleepSummaryCard, WorkoutSessionRow } from "@/components/health/session-cards";
import {
  AppText,
  Card,
  EmptyState,
  ErrorState,
  GradientCard,
  Screen,
  ScreenCentered,
  ScreenFrame,
  ScreenHeader,
  SectionHeader,
  SkeletonScreen,
} from "@/components/ui";
import { useHealthAutoRefresh, useHealthSummary, useSyncHealthNow } from "@/queries/health";
import { formatHeaderDate } from "@/utils/local-date";

// The Health dashboard: one civil day of every enabled metric, plus the latest
// sleep and workout, plus an honest statement of how fresh any of it is.
//
// The governing product rule for this whole screen is that ABSENCE IS SHOWN,
// NEVER HIDDEN. `summary.today` deliberately carries a tile for every catalog
// metric including the ones with no data (HealthSummaryResponseSchema says so),
// because a metric that silently vanishes from a grid reads as a zero. So every
// tile the server sends is rendered, and MetricTile decides what words go in it.
//
// Nothing here interprets a number, and nothing claims knowledge of a paired
// device or of when a wearable last synced -- that would need a fourth OAuth
// scope this project never requested (ADR-046).

/**
 * Display grouping for the daily metrics.
 *
 * Declared here rather than derived from the catalog because it is a
 * presentation decision, not a property of the data: the catalog knows a
 * metric's unit and aggregation, not which heading a person expects to find it
 * under. Order within a group is the order below, so the grid layout is stable
 * regardless of how the server happens to order its array.
 */
const METRIC_GROUPS: readonly { title: string; metrics: readonly string[] }[] = [
  {
    title: "Activity",
    metrics: [
      "steps",
      "distance",
      "floors",
      "active-zone-minutes",
      "active-energy-burned",
      "total-calories",
      "sedentary-period",
    ],
  },
  {
    title: "Vitals",
    metrics: [
      "heart-rate",
      "daily-resting-heart-rate",
      "daily-heart-rate-variability",
      "daily-oxygen-saturation",
      "daily-respiratory-rate",
      "daily-sleep-temperature-derivations",
      "daily-vo2-max",
    ],
  },
  { title: "Body", metrics: ["weight", "body-fat"] },
];

const GROUPED_METRICS: ReadonlySet<string> = new Set(
  METRIC_GROUPS.flatMap((group) => group.metrics),
);

/** How long the post-request confirmation stays on the card. */
const NOTICE_VISIBLE_MS = 8_000;

// Typed through `Href` for the reason health-today-card.tsx records: the
// route union is a generated artifact that may predate a route.
const SLEEP_ROUTE = "/health/sleep" as Href;
const WORKOUTS_ROUTE = "/health/workouts" as Href;
const SETTINGS_ROUTE = "/settings" as Href;

interface TileGroup {
  title: string;
  tiles: HealthMetricTile[];
}

/**
 * Partition today's tiles into the display groups.
 *
 * A metric this file has never heard of falls into a trailing "Other" group
 * rather than being dropped. `metric` is unconstrained text in both Postgres
 * and Zod (ADR-050), so Google adding one is an expected future state, and
 * silently omitting it would be the exact absence-reads-as-zero failure this
 * screen exists to avoid.
 */
function groupMetricTiles(tiles: readonly HealthMetricTile[]): TileGroup[] {
  const byMetric = new Map(tiles.map((tile) => [tile.metric, tile]));

  const groups: TileGroup[] = [];
  for (const group of METRIC_GROUPS) {
    const present = group.metrics
      .map((metric) => byMetric.get(metric))
      .filter((tile): tile is HealthMetricTile => tile !== undefined);
    if (present.length > 0) groups.push({ title: group.title, tiles: present });
  }

  const other = tiles.filter((tile) => !GROUPED_METRICS.has(tile.metric));
  if (other.length > 0) groups.push({ title: "Other", tiles: other });

  return groups;
}

function MetricGrid({
  group,
  capabilities,
  latest,
  todayLocalDate,
  compact,
  onOpenTrend,
}: {
  group: TileGroup;
  capabilities: ReadonlyMap<string, HealthMetricCapability>;
  latest: ReadonlyMap<string, HealthMetricTile>;
  todayLocalDate: string;
  compact: boolean;
  onOpenTrend: (metric: string) => void;
}) {
  // Two columns on the Rabbit R1 (480px) and three on a wide web window. The
  // fraction lives on a wrapper so MetricTile stays layout-agnostic.
  const columnClass = compact ? "w-1/2" : "w-1/3";

  return (
    <View className="-mx-1 flex-row flex-wrap">
      {group.tiles.map((tile) => {
        const capability = capabilities.get(tile.metric);
        // A tile with no matching capability record cannot be explained
        // honestly -- the capability is what says WHY a value is missing. The
        // server always sends both, so this is defence against a contract
        // regression; fabricating a capability would be inventing a claim about
        // the user's account, which is strictly worse than showing one fewer
        // tile.
        if (capability === undefined) return null;
        return (
          <View key={tile.metric} className={`${columnClass} p-1`}>
            <MetricTile
              tile={tile}
              capability={capability}
              todayLocalDate={todayLocalDate}
              latest={latest.get(tile.metric)}
              compact={compact}
              onPress={() => onOpenTrend(tile.metric)}
            />
          </View>
        );
      })}
    </View>
  );
}

/**
 * The gradient block that leads the screen: today's date and the handful of
 * metrics that actually carry a value today, under the same precedence and
 * formatting the grid tiles use (headline-metrics.ts). Every number here
 * also appears in the grid below with its full label -- this is the glance,
 * the grid is the record.
 */
function TodaySummary({ data }: { data: HealthSummaryResponse }) {
  const headlines = pickHeadlineMetrics(data.today, data.capabilities, data.local_date);
  const spoken =
    headlines.length === 0
      ? `Today, ${formatHeaderDate(data.local_date)}. Nothing recorded for today yet.`
      : `Today, ${formatHeaderDate(data.local_date)}. ${headlines
          .map(
            (h) => `${metricShortLabel(h.metric)} ${h.text}${h.unitLabel ? ` ${h.unitLabel}` : ""}`,
          )
          .join(", ")}.`;

  return (
    <GradientCard gradient="health" className="mt-4" accessibilityLabel={spoken}>
      <AppText variant="overline" tone="on-gradient-muted">
        Today
      </AppText>
      <AppText variant="title" tone="on-gradient" className="mt-0.5">
        {formatHeaderDate(data.local_date)}
      </AppText>
      {headlines.length === 0 ? (
        <AppText variant="body" tone="on-gradient-muted" className="mt-3">
          Nothing recorded for today yet.
        </AppText>
      ) : (
        <View className="mt-3 flex-row flex-wrap gap-x-6 gap-y-3">
          {headlines.map((headline) => (
            <View key={headline.metric}>
              <AppText variant="overline" tone="on-gradient-muted" numberOfLines={1}>
                {metricShortLabel(headline.metric)}
              </AppText>
              <View className="flex-row items-baseline gap-1">
                <AppText variant="headline" tone="on-gradient">
                  {headline.text}
                </AppText>
                {headline.unitLabel ? (
                  <AppText variant="caption" tone="on-gradient-muted">
                    {headline.unitLabel}
                  </AppText>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}
    </GradientCard>
  );
}

function HealthDashboard({
  data,
  refreshing,
  onRefresh,
}: {
  data: HealthSummaryResponse;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  // One threshold, defined once. 520 rather than the Rabbit's exact 480 so a
  // slightly wider small screen still gets the compact treatment.
  const compact = width < 520;

  const sync = useSyncHealthNow();
  const [noticeVisible, setNoticeVisible] = useState(false);

  // The notice is a TRANSIENT confirmation and is implemented as one, rather
  // than being driven by `sync.isSuccess` -- which latches true until the next
  // mutation and would leave "Sync requested." pinned to the card for the rest
  // of the screen's life, long after it stopped being news.
  //
  // A timer rather than server evidence, deliberately. The obvious alternative
  // is to clear it once `freshness.sync_in_progress` turns true, but a run that
  // starts and finishes between two polls never shows that flag, so the notice
  // would linger exactly in the case where everything worked.
  const requestedAt = sync.isSuccess ? sync.submittedAt : null;
  useEffect(() => {
    if (requestedAt === null) return;
    setNoticeVisible(true);
    const timer = setTimeout(() => setNoticeVisible(false), NOTICE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [requestedAt]);

  // The app-open bounded refresh is mounted HERE and nowhere else -- see
  // useHealthAutoRefresh's own comment for why one owner matters.
  useHealthAutoRefresh(data);

  const capabilities = new Map(data.capabilities.map((c) => [c.metric, c]));
  const latest = new Map(data.latest.map((tile) => [tile.metric, tile]));
  const groups = groupMetricTiles(data.today);

  const state = resolveHealthConnectionState({
    configured: data.configured,
    connection: data.connection,
    freshness: data.freshness,
  });

  const connectionId = data.connection?.id ?? null;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {/* Compact: the navigator bar says "Health" and the hero carries the date. */}
      <ScreenHeader variant="compact" title="Health" />

      <TodaySummary data={data} />

      <View className="mt-4">
        <HealthConnectionCard
          state={state}
          connection={data.connection}
          freshness={data.freshness}
          todayLocalDate={data.local_date}
          isSyncPending={sync.isPending}
          // `warm` for the explicit button: it is the pass that can densify and
          // tombstone, which is exactly what a user asking for a full refresh
          // wants -- and exactly what the automatic path must never do.
          onSync={
            connectionId === null ? undefined : () => sync.mutate({ connectionId, kind: "warm" })
          }
          // The API answers `{ queued }` on enqueue, never on completion, so the
          // notice says what actually happened and no more. Real progress
          // arrives as `freshness.sync_in_progress` on the next summary read.
          notice={noticeVisible ? "Sync requested." : undefined}
          // Latched (not a timer) deliberately: a failure stays on screen
          // until the next attempt clears it, because unlike the success
          // notice it is not news that goes stale -- it is the current state
          // of the last request. Cleared automatically when the user taps
          // Sync again (TanStack resets isError on mutate).
          errorNotice={
            sync.isError
              ? "Couldn't request a sync — check your connection and try again."
              : undefined
          }
          // Navigates to Settings rather than starting OAuth here. The consent
          // flow and the connect mutation live on that screen; running a second
          // copy of a credential-handling path from the dashboard would mean two
          // places where a grant can be minted, and only one of them reviewed as
          // such. The card's own copy already says what needs to happen.
          onReconnect={() => router.push(SETTINGS_ROUTE)}
        />
      </View>

      {groups.length === 0 ? (
        <>
          <SectionHeader title="Today" icon="chart-line" />
          <Card>
            <EmptyState icon="chart-line" title="No metrics are being synced yet." />
          </Card>
        </>
      ) : (
        groups.map((group) => (
          <View key={group.title}>
            <SectionHeader title={group.title} />
            <MetricGrid
              group={group}
              capabilities={capabilities}
              latest={latest}
              todayLocalDate={data.local_date}
              compact={compact}
              onOpenTrend={(metric) =>
                router.push(`/health/trends/${encodeURIComponent(metric)}` as Href)
              }
            />
          </View>
        ))
      )}

      <SectionHeader
        title="Sleep"
        icon="sleep"
        action={{
          label: "See all",
          onPress: () => router.push(SLEEP_ROUTE),
          accessibilityLabel: "All sleep",
        }}
      />
      {data.latest_sleep === null ? (
        <Card>
          <EmptyState
            icon="sleep"
            title="No sleep sessions yet."
            body="One has to reach Google Health before Personal OS can read it."
          />
        </Card>
      ) : (
        <SleepSummaryCard
          session={data.latest_sleep}
          averageSeconds={data.sleep_7d_average_seconds}
          compact={compact}
        />
      )}

      <SectionHeader
        title="Workouts"
        icon="run"
        action={{
          label: "See all",
          onPress: () => router.push(WORKOUTS_ROUTE),
          accessibilityLabel: "All workouts",
        }}
      />
      {data.latest_workout === null ? (
        <Card>
          <EmptyState
            icon="run"
            title="No workouts yet."
            body="One has to reach Google Health before Personal OS can read it."
          />
        </Card>
      ) : (
        <Card padding="none" className="px-4">
          <WorkoutSessionRow session={data.latest_workout} last />
        </Card>
      )}
    </Screen>
  );
}

export default function HealthScreen() {
  const { data, isLoading, isError, refetch } = useHealthSummary();
  // Pull-to-refresh state of its own rather than the query's `isRefetching`:
  // the summary query polls every few seconds while a sync runs
  // (queries/health.ts), and each of those background reads would otherwise
  // spin the refresh control as if the user had pulled.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    void refetch().finally(() => setRefreshing(false));
  };

  if (isLoading) {
    // A skeleton where the header, the summary and the first metric group
    // WILL appear, so nothing jumps into place on arrival.
    return (
      <ScreenFrame>
        <SkeletonScreen />
      </ScreenFrame>
    );
  }

  if (isError || !data) {
    // Deliberately does NOT fall through to "not connected". When the API is
    // unreachable we know nothing about the connection, and telling the user
    // their Google Health link is gone would invite them to mint a new grant to
    // fix a network problem (connection-state.ts's first rule, same reasoning).
    return (
      <ScreenCentered>
        <ErrorState
          message="Couldn't load health data."
          onRetry={() => void refetch()}
          retryAccessibilityLabel="Retry loading health data"
          size="screen"
        />
      </ScreenCentered>
    );
  }

  return <HealthDashboard data={data} refreshing={refreshing} onRefresh={onRefresh} />;
}
