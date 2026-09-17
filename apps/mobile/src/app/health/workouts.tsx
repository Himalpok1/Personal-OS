import type { HealthWorkoutSession } from "@personal-os/schema";
import { useState } from "react";
import { View } from "react-native";
import { WORKOUT_DETAIL_NOTE, WorkoutSessionRow } from "@/components/health/session-cards";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  ScreenCentered,
  ScreenFrame,
  ScreenHeader,
  SectionHeader,
  SkeletonScreen,
} from "@/components/ui";
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
      <ScreenFrame>
        <SkeletonScreen />
      </ScreenFrame>
    );
  }

  if (workouts.isError || workouts.data === undefined) {
    return (
      <ScreenCentered>
        <ErrorState
          message="Couldn't load workouts."
          onRetry={() => void workouts.refetch()}
          retryAccessibilityLabel="Retry loading workouts"
          size="screen"
        />
      </ScreenCentered>
    );
  }

  const { items, total } = workouts.data;
  const groups = groupByStartDate(items);
  const hasMore = items.length < total;
  const atCap = limit >= MAX_LIMIT;

  return (
    <Screen refreshing={workouts.isRefetching} onRefresh={() => void workouts.refetch()}>
      <ScreenHeader
        variant="compact"
        title="Workouts"
        subtitle={`Last ${RANGE_DAYS} days, by start date`}
      />

      {/* The standing gap, stated once from the contract rather than hardcoded
          per row: the 6.3 sync engine stores an allowlisted SessionDetail only,
          so distance, calories and heart-rate zones are always null today. */}
      <AppText variant="label" tone="secondary" className="pt-3 font-normal">
        {WORKOUT_DETAIL_NOTE}
      </AppText>

      {groups.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon="run"
            title={`No workouts in the last ${RANGE_DAYS} days.`}
            body="A session has to reach Google Health before Personal OS can read it."
          />
        </Card>
      ) : (
        groups.map((group) => (
          <View key={group.date}>
            <SectionHeader title={formatHeaderDate(group.date)} />
            <Card padding="none" className="px-4">
              {group.sessions.map((session, index) => (
                <WorkoutSessionRow
                  key={session.id}
                  session={session}
                  last={index === group.sessions.length - 1}
                />
              ))}
            </Card>
          </View>
        ))
      )}

      {hasMore ? (
        <View className="pt-5">
          {atCap ? (
            <AppText variant="label" tone="secondary" className="font-normal">
              Showing the first {items.length} of {total} sessions.
            </AppText>
          ) : (
            <Button
              label={`Load more (${items.length} of ${total})`}
              onPress={() => setLimit((current) => Math.min(MAX_LIMIT, current + PAGE_SIZE))}
              accessibilityLabel="Load more workouts"
              variant="outline"
              block
            />
          )}
        </View>
      ) : null}
    </Screen>
  );
}
