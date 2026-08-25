import type {
  HealthMetricCapability,
  HealthMetricTile,
  HealthSummaryResponse,
} from "@personal-os/schema";
import { Link, useRouter, type Href } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { FLOATING_CLEARANCE } from "@/components/floating-layout";
import { HealthConnectionCard } from "@/components/health/connection-card";
import { resolveHealthConnectionState } from "@/components/health/connection-state";
import { MetricTile } from "@/components/health/metric-tile";
import { SleepSummaryCard, WorkoutSessionRow } from "@/components/health/session-cards";
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

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between px-4 pb-2 pt-5">
      <Text className="text-sm font-semibold uppercase text-neutral-500 dark:text-neutral-400">
        {title}
      </Text>
      {action ?? null}
    </View>
  );
}

function SeeAllLink({ href, label }: { href: Href; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={label}
        className="min-h-[44px] items-center justify-center"
      >
        <Text className="text-sm text-blue-600 dark:text-blue-400">See all</Text>
      </Pressable>
    </Link>
  );
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
    <View className="flex-row flex-wrap px-3">
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

function EmptyLine({ children }: { children: string }) {
  return (
    <Text className="px-4 pb-1 text-sm text-neutral-500 dark:text-neutral-400">{children}</Text>
  );
}

function HealthDashboard({ data }: { data: HealthSummaryResponse }) {
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
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName={FLOATING_CLEARANCE}
      keyboardShouldPersistTaps="handled"
    >
      <View className="px-4 pt-4">
        <Text className="text-2xl font-bold text-black dark:text-white">Health</Text>
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">
          {formatHeaderDate(data.local_date)}
        </Text>
      </View>

      <View className="px-4 pt-4">
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
          // Navigates to Settings rather than starting OAuth here. The consent
          // flow and the connect mutation live on that screen; running a second
          // copy of a credential-handling path from the dashboard would mean two
          // places where a grant can be minted, and only one of them reviewed as
          // such. The card's own copy already says what needs to happen.
          onReconnect={() => router.push("/settings")}
        />
      </View>

      {groups.length === 0 ? (
        <>
          <SectionHeader title="Today" />
          <EmptyLine>No metrics are being synced yet.</EmptyLine>
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
              onOpenTrend={(metric) => router.push(`/health/trends/${encodeURIComponent(metric)}`)}
            />
          </View>
        ))
      )}

      <SectionHeader title="Sleep" action={<SeeAllLink href="/health/sleep" label="All sleep" />} />
      {data.latest_sleep === null ? (
        <EmptyLine>
          No sleep sessions yet. One has to reach Google Health before Personal OS can read it.
        </EmptyLine>
      ) : (
        <View className="px-4">
          <SleepSummaryCard
            session={data.latest_sleep}
            averageSeconds={data.sleep_7d_average_seconds}
            compact={compact}
          />
        </View>
      )}

      <SectionHeader
        title="Workouts"
        action={<SeeAllLink href="/health/workouts" label="All workouts" />}
      />
      {data.latest_workout === null ? (
        <EmptyLine>
          No workouts yet. One has to reach Google Health before Personal OS can read it.
        </EmptyLine>
      ) : (
        <WorkoutSessionRow session={data.latest_workout} />
      )}
    </ScrollView>
  );
}

export default function HealthScreen() {
  const { data, isLoading, isError, refetch } = useHealthSummary();

  if (isLoading) {
    // Reserves the full height rather than collapsing, so the connection card
    // and the first metric group do not jump into place on arrival.
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Text className="text-neutral-500">Loading…</Text>
      </View>
    );
  }

  if (isError || !data) {
    // Deliberately does NOT fall through to "not connected". When the API is
    // unreachable we know nothing about the connection, and telling the user
    // their Google Health link is gone would invite them to mint a new grant to
    // fix a network problem (connection-state.ts's first rule, same reasoning).
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white dark:bg-black px-6">
        <Text className="text-center text-red-600">Couldn&apos;t load health data.</Text>
        <Pressable
          onPress={() => void refetch()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Retry loading health data"
          className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
        >
          <Text className="font-semibold text-white">Retry</Text>
        </Pressable>
      </View>
    );
  }

  return <HealthDashboard data={data} />;
}
