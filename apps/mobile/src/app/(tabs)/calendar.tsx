import { AgendaView } from "@/components/agenda/agenda-view";
import { MonthGrid } from "@/components/calendar/month-grid";
import { ViewModeToggle, type CalendarViewMode } from "@/components/calendar/view-mode-toggle";
import { WeekGrid } from "@/components/calendar/week-grid";
import { getMonthGridDays } from "@/components/calendar/grid-math";
import { getWeekDays } from "@/components/calendar/week-grid-layout";
import { useEventsInRange } from "@/queries/events";
import { UI_TEST_MODE } from "@/config/ui-test-mode";
import type { EventRangeItem } from "@personal-os/schema";
import { addMonths, addWeeks, endOfDay, format, startOfDay, subMonths, subWeeks } from "date-fns";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText, Card, ErrorState, IconButton, ScreenFrame, SkeletonCard } from "@/components/ui";

// Month/Week are grid views over a computed [from, to] window; Agenda is a
// self-fetching vertical list that owns its own range and project filter
// (Checkpoint 5.4). All three are modes of this one tab -- the app
// deliberately stays at five tabs.
type ViewMode = CalendarViewMode;
type GridViewMode = Exclude<CalendarViewMode, "agenda">;

// The screen-assembly seam between three independently-built, independently-
// tested components: MonthGrid/WeekGrid (Checkpoint 4.2 Agents A/B) render
// whatever `entries` they're handed and never fetch data themselves; this
// file is the only place that computes the visible [from, to] window,
// fetches via GET /events/range (useEventsInRange, Agent C), and wires
// tap-to-create/tap-to-view navigation into events/new and events/[id]
// (also Agent C, using the exact pre-fill param shape documented in
// events/new.tsx's header comment).
function computeRangeBounds(viewMode: GridViewMode, anchor: Date): { from: string; to: string } {
  const days = viewMode === "month" ? getMonthGridDays(anchor) : getWeekDays(anchor);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return {
    from: startOfDay(first).toISOString(),
    to: endOfDay(last).toISOString(),
  };
}

function shiftAnchor(viewMode: GridViewMode, anchor: Date, direction: 1 | -1): Date {
  if (viewMode === "month") {
    return direction === 1 ? addMonths(anchor, 1) : subMonths(anchor, 1);
  }
  return direction === 1 ? addWeeks(anchor, 1) : subWeeks(anchor, 1);
}

export default function CalendarScreen() {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());

  // Agenda owns its own range, so the grid window is neither computed nor
  // fetched in that mode -- passing undefined leaves useEventsInRange
  // disabled rather than firing a request whose result nothing renders.
  const rangeBounds = useMemo(
    () => (viewMode === "agenda" ? null : computeRangeBounds(viewMode, anchor)),
    [viewMode, anchor],
  );
  const {
    data: entries,
    isLoading,
    isError,
    refetch,
  } = useEventsInRange(
    rangeBounds ? { from: rangeBounds.from, to: rangeBounds.to, include_archived: false } : undefined,
  );

  // Retry must refetch whichever query actually failed. Agenda mode is a
  // self-fetching component (AgendaView) that owns and retries its own
  // query -- this screen's error branch only ever renders for the Month/Week
  // grid, so refetching useEventsInRange here is always the right target.

  const goToEvent = (entry: EventRangeItem) => {
    if (entry.is_recurring_instance && entry.occurs_at) {
      router.push(`/events/${entry.id}?occursAt=${encodeURIComponent(entry.occurs_at)}`);
    } else {
      router.push(`/events/${entry.id}`);
    }
  };

  const goToNewAllDay = (date: Date) => {
    router.push(`/events/new?date=${format(date, "yyyy-MM-dd")}&allDay=true`);
  };

  const goToNewTimed = (date: Date) => {
    const end = new Date(date.getTime() + 30 * 60 * 1000);
    router.push(`/events/new?startsAt=${date.toISOString()}&endsAt=${end.toISOString()}`);
  };

  const label =
    viewMode === "month"
      ? format(anchor, "MMMM yyyy")
      : `${format(getWeekDays(anchor)[0]!, "MMM d")} - ${format(getWeekDays(anchor)[6]!, "MMM d, yyyy")}`;

  return (
    <ScreenFrame>
      {viewMode === "agenda" ? null : (
        <View className="flex-row items-center justify-between px-2 pt-2">
          {/* "Previous month"/"Next month" is wrong when the user is on Week
              -- the label must track the current view mode, matching the
              precedent already set by "Jump to today" below. */}
          <IconButton
            icon="chevron-left"
            onPress={() => setAnchor((current) => shiftAnchor(viewMode, current, -1))}
            accessibilityLabel={viewMode === "month" ? "Previous month" : "Previous week"}
          />

          <Pressable
            onPress={() => setAnchor(new Date())}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Jump to today"
            className="min-h-[44px] flex-1 items-center justify-center px-2 active:opacity-70"
          >
            <AppText variant="title" numberOfLines={1}>
              {label}
            </AppText>
          </Pressable>

          <IconButton
            icon="chevron-right"
            onPress={() => setAnchor((current) => shiftAnchor(viewMode, current, 1))}
            accessibilityLabel={viewMode === "month" ? "Next month" : "Next week"}
          />
        </View>
      )}

      <View className="flex-row items-center gap-2 px-4 py-2">
        <ViewModeToggle value={viewMode} onChange={setViewMode} />

        <IconButton
          icon="plus"
          variant="tonal"
          tone="primary"
          onPress={() => router.push("/events/new")}
          accessibilityLabel="New event"
        />
      </View>

      {viewMode === "agenda" ? (
        <AgendaView />
      ) : isLoading ? (
        <View className="px-4 pt-2">
          <SkeletonCard lines={6} />
        </View>
      ) : isError && !UI_TEST_MODE ? (
        <ErrorState
          size="screen"
          message="Couldn't load the calendar."
          onRetry={() => void refetch()}
          retryAccessibilityLabel="Retry loading the calendar"
        />
      ) : (
        // One card around whichever grid is showing: the grid draws its own
        // hairlines and cell surfaces, the card gives it the same edge every
        // other block on the canvas has. `overflow-hidden` clips the cells to
        // the card radius; `flex-1` lets the week grid's own ScrollView fill
        // the remaining height exactly as it did on the bare screen.
        <Card padding="none" className="mx-4 mb-2 flex-1 overflow-hidden">
          {viewMode === "month" ? (
            <MonthGrid
              month={anchor}
              entries={entries ?? []}
              onDayPress={goToNewAllDay}
              onEntryPress={goToEvent}
            />
          ) : (
            <WeekGrid
              week={anchor}
              entries={entries ?? []}
              onSlotPress={goToNewTimed}
              onEntryPress={goToEvent}
            />
          )}
        </Card>
      )}
    </ScreenFrame>
  );
}
