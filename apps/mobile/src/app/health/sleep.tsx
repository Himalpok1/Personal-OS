import type { HealthSleepSession } from "@personal-os/schema";
import { useState } from "react";
import { View } from "react-native";
import { formatDuration } from "@/components/health/format";
import { SleepSessionRow } from "@/components/health/session-cards";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  MetricCard,
  Screen,
  ScreenCentered,
  ScreenFrame,
  ScreenHeader,
  SectionHeader,
  SkeletonScreen,
} from "@/components/ui";
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
      <ScreenFrame>
        <SkeletonScreen />
      </ScreenFrame>
    );
  }

  if (sleep.isError || sleep.data === undefined) {
    return (
      <ScreenCentered>
        <ErrorState
          message="Couldn't load sleep sessions."
          onRetry={() => void sleep.refetch()}
          retryAccessibilityLabel="Retry loading sleep sessions"
          size="screen"
        />
      </ScreenCentered>
    );
  }

  const { items, total } = sleep.data;
  const groups = groupByWakeDate(items);
  const hasMore = items.length < total;
  const atCap = limit >= MAX_LIMIT;
  const average = summary.data?.sleep_7d_average_seconds ?? null;

  return (
    <Screen refreshing={sleep.isRefetching} onRefresh={() => void sleep.refetch()}>
      <ScreenHeader
        variant="compact"
        title="Sleep"
        subtitle={`Last ${RANGE_DAYS} days, by wake date`}
      />

      {/* Null means no session landed in the trailing 7 wake-dates. Rendered as
          words, never as "0h 0m", which would read as seven sleepless nights. */}
      {average === null ? null : (
        <View className="mt-4 flex-row">
          <MetricCard label="7-day average" value={formatDuration(average)} icon="sleep" />
        </View>
      )}

      {groups.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon="sleep"
            title={`No sleep sessions in the last ${RANGE_DAYS} days.`}
            body="A session has to reach Google Health before Personal OS can read it."
          />
        </Card>
      ) : (
        groups.map((group) => (
          <View key={group.date}>
            <SectionHeader title={formatHeaderDate(group.date)} />
            <Card padding="none" className="px-4">
              {group.sessions.map((session, index) => (
                <SleepSessionRow
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
            // Honest rather than a button that cannot do anything: the schema
            // caps `limit` at 200, so beyond that this screen genuinely cannot
            // show more within its 30-day window.
            <AppText variant="label" tone="secondary" className="font-normal">
              Showing the first {items.length} of {total} sessions.
            </AppText>
          ) : (
            <Button
              label={`Load more (${items.length} of ${total})`}
              onPress={() => setLimit((current) => Math.min(MAX_LIMIT, current + PAGE_SIZE))}
              accessibilityLabel="Load more sleep sessions"
              variant="outline"
              block
            />
          )}
        </View>
      ) : null}
    </Screen>
  );
}
