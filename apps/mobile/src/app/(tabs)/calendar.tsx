import { MonthGrid } from "@/components/calendar/month-grid";
import { WeekGrid } from "@/components/calendar/week-grid";
import { getMonthGridDays } from "@/components/calendar/grid-math";
import { getWeekDays } from "@/components/calendar/week-grid-layout";
import { useEventsInRange } from "@/queries/events";
import { UI_TEST_MODE } from "@/config/ui-test-mode";
import type { EventRangeItem } from "@personal-os/schema";
import { addMonths, addWeeks, endOfDay, format, startOfDay, subMonths, subWeeks } from "date-fns";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

type ViewMode = "month" | "week";

// The screen-assembly seam between three independently-built, independently-
// tested components: MonthGrid/WeekGrid (Checkpoint 4.2 Agents A/B) render
// whatever `entries` they're handed and never fetch data themselves; this
// file is the only place that computes the visible [from, to] window,
// fetches via GET /events/range (useEventsInRange, Agent C), and wires
// tap-to-create/tap-to-view navigation into events/new and events/[id]
// (also Agent C, using the exact pre-fill param shape documented in
// events/new.tsx's header comment).
function computeRangeBounds(viewMode: ViewMode, anchor: Date): { from: string; to: string } {
  const days = viewMode === "month" ? getMonthGridDays(anchor) : getWeekDays(anchor);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return {
    from: startOfDay(first).toISOString(),
    to: endOfDay(last).toISOString(),
  };
}

function shiftAnchor(viewMode: ViewMode, anchor: Date, direction: 1 | -1): Date {
  if (viewMode === "month") {
    return direction === 1 ? addMonths(anchor, 1) : subMonths(anchor, 1);
  }
  return direction === 1 ? addWeeks(anchor, 1) : subWeeks(anchor, 1);
}

export default function CalendarScreen() {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());

  const { from, to } = useMemo(() => computeRangeBounds(viewMode, anchor), [viewMode, anchor]);
  const { data: entries, isLoading, isError } = useEventsInRange({
    from,
    to,
    include_archived: false,
  });

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
    <View className="flex-1 bg-white dark:bg-black">
      <View className="flex-row items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
        <Pressable
          onPress={() => setAnchor((current) => shiftAnchor(viewMode, current, -1))}
          hitSlop={12}
          className="px-2"
        >
          <Text className="text-lg text-black dark:text-white">‹</Text>
        </Pressable>

        <Pressable onPress={() => setAnchor(new Date())}>
          <Text className="text-base font-semibold text-black dark:text-white">{label}</Text>
        </Pressable>

        <Pressable
          onPress={() => setAnchor((current) => shiftAnchor(viewMode, current, 1))}
          hitSlop={12}
          className="px-2"
        >
          <Text className="text-lg text-black dark:text-white">›</Text>
        </Pressable>
      </View>

      <View className="flex-row items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => setViewMode("month")}
            className={
              viewMode === "month"
                ? "rounded-full bg-blue-600 px-3 py-1"
                : "rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800"
            }
          >
            <Text className={viewMode === "month" ? "text-white" : "text-black dark:text-white"}>
              Month
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode("week")}
            className={
              viewMode === "week"
                ? "rounded-full bg-blue-600 px-3 py-1"
                : "rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800"
            }
          >
            <Text className={viewMode === "week" ? "text-white" : "text-black dark:text-white"}>
              Week
            </Text>
          </Pressable>
        </View>

        <Pressable onPress={() => router.push("/events/new")} hitSlop={12} className="px-2">
          <Text className="text-xl text-blue-600">+</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : isError && !UI_TEST_MODE ? (
        <View className="flex-1 items-center justify-center p-4">
          <Text className="text-red-600">Couldn&apos;t load the calendar.</Text>
        </View>
      ) : viewMode === "month" ? (
        <MonthGrid month={anchor} entries={entries ?? []} onDayPress={goToNewAllDay} onEntryPress={goToEvent} />
      ) : (
        <WeekGrid week={anchor} entries={entries ?? []} onSlotPress={goToNewTimed} onEntryPress={goToEvent} />
      )}
    </View>
  );
}
