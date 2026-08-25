import type { HealthWorkoutSession } from "@personal-os/schema";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { FLOATING_CLEARANCE } from "@/components/floating-layout";
import { WORKOUT_DETAIL_NOTE, WorkoutSessionRow } from "@/components/health/session-cards";
import { useHealthSummary, useHealthWorkoutSessions } from "@/queries/health";
import { addLocalDays, formatHeaderDate, todayLocalDate } from "@/utils/local-date";

// Exercise history, keyed on the civil START date (ADR-049) -- the mirror of
// sleep's wake-date axis, and the axis the sync engine actually queries on.

const RANGE_DAYS = 30;
const PAGE_SIZE = 50;
/** Matches HealthSessionRangeQuerySchema's own ceiling. */
const MAX_LIMIT = 200;

interface DateGroup {
  date: string;
  sessions: HealthWorkoutSession[];
}

/** Group under the start date, newest first -- see the sleep screen's note. */
function groupByStartDate(sessions: readonly HealthWorkoutSession[]): DateGroup[] {
  const byDate = new Map<string, HealthWorkoutSession[]>();
  for (const session of sessions) {
    const existing = byDate.get(session.start_local_date);
    if (existing === undefined) byDate.set(session.start_local_date, [session]);
    else existing.push(session);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, group]) => ({ date, sessions: group }));
}

export default function HealthWorkoutsScreen() {
  const [limit, setLimit] = useState(PAGE_SIZE);

  const summary = useHealthSummary();
  const anchor = summary.data?.local_date ?? todayLocalDate();
  const to = anchor; // inclusive
  const from = addLocalDays(anchor, -(RANGE_DAYS - 1));

  const workouts = useHealthWorkoutSessions({ from, to, limit });

  if (workouts.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Text className="text-neutral-500">Loading…</Text>
      </View>
    );
  }

  if (workouts.isError || workouts.data === undefined) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white px-6 dark:bg-black">
        <Text className="text-center text-red-600">Couldn&apos;t load workouts.</Text>
        <Pressable
          onPress={() => void workouts.refetch()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Retry loading workouts"
          className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
        >
          <Text className="font-semibold text-white">Retry</Text>
        </Pressable>
      </View>
    );
  }

  const { items, total } = workouts.data;
  const groups = groupByStartDate(items);
  const hasMore = items.length < total;
  const atCap = limit >= MAX_LIMIT;

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName={FLOATING_CLEARANCE}
      keyboardShouldPersistTaps="handled"
    >
      <View className="px-4 pt-4">
        <Text className="text-2xl font-bold text-black dark:text-white">Workouts</Text>
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">
          Last {RANGE_DAYS} days, by start date
        </Text>
      </View>

      {/* The standing gap, stated once from the contract rather than hardcoded
          per row: the 6.3 sync engine stores an allowlisted SessionDetail only,
          so distance, calories and heart-rate zones are always null today. */}
      <Text className="px-4 pt-3 text-sm text-neutral-500 dark:text-neutral-400">
        {WORKOUT_DETAIL_NOTE}
      </Text>

      {groups.length === 0 ? (
        <Text className="px-4 pt-6 text-sm text-neutral-500 dark:text-neutral-400">
          No workouts in the last {RANGE_DAYS} days. A session has to reach Google Health before
          Personal OS can read it.
        </Text>
      ) : (
        groups.map((group) => (
          <View key={group.date}>
            <Text className="px-4 pb-1 pt-5 text-sm font-semibold uppercase text-neutral-500 dark:text-neutral-400">
              {formatHeaderDate(group.date)}
            </Text>
            {group.sessions.map((session) => (
              <WorkoutSessionRow key={session.id} session={session} />
            ))}
          </View>
        ))
      )}

      {hasMore ? (
        <View className="px-4 pt-5">
          {atCap ? (
            <Text className="text-sm text-neutral-500 dark:text-neutral-400">
              Showing the first {items.length} of {total} sessions.
            </Text>
          ) : (
            <Pressable
              onPress={() => setLimit((current) => Math.min(MAX_LIMIT, current + PAGE_SIZE))}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Load more workouts"
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
