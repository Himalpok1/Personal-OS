import type { HealthSleepSession } from "@personal-os/schema";
import { useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { FLOATING_CLEARANCE } from "@/components/floating-layout";
import { formatDuration } from "@/components/health/format";
import { SleepSessionRow } from "@/components/health/session-cards";
import { useHealthSleepSessions, useHealthSummary } from "@/queries/health";
import { addLocalDays, formatHeaderDate, todayLocalDate } from "@/utils/local-date";

// Sleep history, keyed on the civil WAKE date (ADR-049) -- which is the axis
// the provider filter, the attribution rule and the tombstone sweep all share,
// so "how did I sleep last night" lands on the morning after, as asked.

const RANGE_DAYS = 30;
const PAGE_SIZE = 50;
/** Matches HealthSessionRangeQuerySchema's own ceiling. */
const MAX_LIMIT = 200;

interface DateGroup {
  date: string;
  sessions: HealthSleepSession[];
}

/**
 * Group sessions under their wake date, newest first.
 *
 * The order is asserted here rather than inherited from the response: the route
 * happens to return descending today, but a list whose order depends on an
 * unstated server detail is one refactor away from silently inverting.
 */
function groupByWakeDate(sessions: readonly HealthSleepSession[]): DateGroup[] {
  const byDate = new Map<string, HealthSleepSession[]>();
  for (const session of sessions) {
    const existing = byDate.get(session.wake_local_date);
    if (existing === undefined) byDate.set(session.wake_local_date, [session]);
    else existing.push(session);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, group]) => ({ date, sessions: group }));
}

export default function HealthSleepScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 520;
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Same anchor rule as the trend screen: the server's civil date for the
  // requested timezone, so two Health screens can never disagree by a day.
  const summary = useHealthSummary();
  const anchor = summary.data?.local_date ?? todayLocalDate();
  const to = anchor; // inclusive
  const from = addLocalDays(anchor, -(RANGE_DAYS - 1));

  const sleep = useHealthSleepSessions({ from, to, limit });

  if (sleep.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Text className="text-neutral-500">Loading…</Text>
      </View>
    );
  }

  if (sleep.isError || sleep.data === undefined) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white px-6 dark:bg-black">
        <Text className="text-center text-red-600">Couldn&apos;t load sleep sessions.</Text>
        <Pressable
          onPress={() => void sleep.refetch()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Retry loading sleep sessions"
          className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
        >
          <Text className="font-semibold text-white">Retry</Text>
        </Pressable>
      </View>
    );
  }

  const { items, total } = sleep.data;
  const groups = groupByWakeDate(items);
  const hasMore = items.length < total;
  const atCap = limit >= MAX_LIMIT;
  const average = summary.data?.sleep_7d_average_seconds ?? null;

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName={FLOATING_CLEARANCE}
      keyboardShouldPersistTaps="handled"
    >
      <View className="px-4 pt-4">
        <Text className="text-2xl font-bold text-black dark:text-white">Sleep</Text>
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">
          Last {RANGE_DAYS} days, by wake date
        </Text>
      </View>

      {/* Null means no session landed in the trailing 7 wake-dates. Rendered as
          words, never as "0h 0m", which would read as seven sleepless nights. */}
      {average === null ? null : (
        <View className="mx-4 mt-4 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <Text className="text-xs uppercase text-neutral-500 dark:text-neutral-400">
            7-day average
          </Text>
          <Text
            className={`font-semibold text-black dark:text-white ${compact ? "text-xl" : "text-2xl"}`}
          >
            {formatDuration(average)}
          </Text>
        </View>
      )}

      {groups.length === 0 ? (
        <Text className="px-4 pt-6 text-sm text-neutral-500 dark:text-neutral-400">
          No sleep sessions in the last {RANGE_DAYS} days. A session has to reach Google Health
          before Personal OS can read it.
        </Text>
      ) : (
        groups.map((group) => (
          <View key={group.date}>
            <Text className="px-4 pb-1 pt-5 text-sm font-semibold uppercase text-neutral-500 dark:text-neutral-400">
              {formatHeaderDate(group.date)}
            </Text>
            {group.sessions.map((session) => (
              <SleepSessionRow key={session.id} session={session} />
            ))}
          </View>
        ))
      )}

      {hasMore ? (
        <View className="px-4 pt-5">
          {atCap ? (
            // Honest rather than a button that cannot do anything: the schema
            // caps `limit` at 200, so beyond that this screen genuinely cannot
            // show more within its 30-day window.
            <Text className="text-sm text-neutral-500 dark:text-neutral-400">
              Showing the first {items.length} of {total} sessions.
            </Text>
          ) : (
            <Pressable
              onPress={() => setLimit((current) => Math.min(MAX_LIMIT, current + PAGE_SIZE))}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Load more sleep sessions"
              className="min-h-[44px] items-center justify-center rounded-lg border border-neutral-300 px-4 active:bg-neutral-100 dark:border-neutral-700 dark:active:bg-neutral-900"
            >
              <Text className="font-medium text-blue-600 dark:text-blue-400">
                Load more ({items.length} of {total})
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}
