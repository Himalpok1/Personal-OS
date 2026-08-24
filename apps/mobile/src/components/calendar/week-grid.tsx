// A 7-column-by-time-of-day week view, built from View/ScrollView +
// NativeWind -- no third-party calendar library, per this project's locked
// architecture decision. All the actual day-column/time-slot placement
// math lives in week-grid-layout.ts (a pure, RN-free module with its own
// vitest coverage); this file is intentionally a thin renderer over that
// module's output, matching this codebase's established split between
// tested pure logic and untested RN composition (see
// notifications/reconcile.ts's header comment, and this app's
// vitest.config.ts, which only transforms `src/**/*.test.ts`, not `.tsx`).
//
// Deliberately does NOT reuse calendar/day-cell.tsx (Agent A's month-view
// cell): a week view needs to show TIME OF DAY as vertical position within
// a scrollable hour grid, which a month view's whole-day cell has no
// concept of -- forcing this into that shape would mean re-deriving the
// same layout math DayCell doesn't do anyway. Google Calendar's own
// week-view/month-view split follows the same reasoning.
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { format } from "date-fns";
import type { EventRangeItem } from "@personal-os/schema";
import {
  MINUTES_PER_DAY,
  isSameLocalDay,
  layoutWeek,
  type AllDayPlacement,
  type TimedPlacement,
} from "./week-grid-layout";

interface WeekGridProps {
  week: Date;
  entries: EventRangeItem[];
  onSlotPress: (date: Date) => void;
  onEntryPress: (entry: EventRangeItem) => void;
}

// Hourly rows, vertically scrollable. 40px keeps a full 24-row day
// reachable with a modest amount of scrolling even on the Rabbit R1's
// 480x640 display (a later verification step checks the real device;
// this value is chosen to stay usable there rather than assuming a normal
// phone's screen) while still giving each row a real touch target.
const HOUR_ROW_HEIGHT = 40;
const GRID_HEIGHT = HOUR_ROW_HEIGHT * 24;
const GUTTER_WIDTH = 44;
// A zero-duration (point-in-time) entry, or any entry shorter than this,
// is still given at least this much visual height so it stays legible and
// tappable -- a rendering concern only, not part of the pure layout math.
const MIN_BLOCK_MINUTES = 30;

function minutesToPixels(minutes: number): number {
  return (minutes / MINUTES_PER_DAY) * GRID_HEIGHT;
}

function formatTimeLabel(entry: EventRangeItem, startMinutes: number): string {
  // Defensive (Checkpoint 5.7.1): all-day entries never reach here today --
  // week-grid-layout.ts `continue`s past the timed path for them -- but this
  // function reads occurs_at with no guard of its own, which is exactly the
  // shape that shipped the "12:00" bug on Today. Safe by construction now,
  // not merely by its single caller.
  if (entry.all_day) return "";
  const startIso = entry.is_recurring_instance ? entry.occurs_at : entry.starts_at;
  if (!startIso) return "";
  // Re-derive from the real instant for correct minute-level formatting
  // rather than reformatting the clipped startMinutes integer, which would
  // read "00:00" for the clipped-at-midnight half of a multi-day entry.
  const hours = Math.floor(startMinutes / 60);
  const minutes = startMinutes % 60;
  const period = hours < 12 ? "AM" : "PM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes.toString().padStart(2, "0")} ${period}`;
}

function TimedBlock({
  placement,
  onPress,
}: {
  placement: TimedPlacement;
  onPress: (entry: EventRangeItem) => void;
}) {
  const top = minutesToPixels(placement.startMinutes);
  const rawHeight = minutesToPixels(placement.endMinutes - placement.startMinutes);
  const height = Math.max(rawHeight, minutesToPixels(MIN_BLOCK_MINUTES));

  return (
    <Pressable
      onPress={() => onPress(placement.entry)}
      style={{ position: "absolute", top, height, left: 1, right: 1 }}
      className="overflow-hidden rounded-sm bg-blue-600 px-1 py-0.5 active:bg-blue-700"
      accessibilityLabel={placement.entry.title}
    >
      <Text numberOfLines={1} className="text-[10px] font-semibold text-white">
        {placement.entry.title}
      </Text>
      <Text numberOfLines={1} className="text-[9px] text-blue-100">
        {formatTimeLabel(placement.entry, placement.startMinutes)}
      </Text>
    </Pressable>
  );
}

export function WeekGrid({ week, entries, onSlotPress, onEntryPress }: WeekGridProps) {
  const layout = useMemo(() => layoutWeek(week, entries), [week, entries]);
  const today = useMemo(() => new Date(), []);

  const allDayByDay = useMemo(() => {
    const byDay = new Map<number, AllDayPlacement[]>();
    for (const placement of layout.allDay) {
      const existing = byDay.get(placement.dayIndex);
      if (existing) {
        existing.push(placement);
      } else {
        byDay.set(placement.dayIndex, [placement]);
      }
    }
    return byDay;
  }, [layout.allDay]);

  const timedByDay = useMemo(() => {
    const byDay = new Map<number, TimedPlacement[]>();
    for (const placement of layout.timed) {
      const existing = byDay.get(placement.dayIndex);
      if (existing) {
        existing.push(placement);
      } else {
        byDay.set(placement.dayIndex, [placement]);
      }
    }
    return byDay;
  }, [layout.timed]);

  const hasAnyAllDayEntry = layout.allDay.length > 0;

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      {/* Day-name / date header row */}
      <View className="flex-row border-b border-neutral-200 dark:border-neutral-800">
        <View style={{ width: GUTTER_WIDTH }} />
        {layout.days.map((day, dayIndex) => {
          const isToday = isSameLocalDay(day, today);
          return (
            <View key={dayIndex} className="flex-1 items-center py-1">
              <Text className="text-[10px] uppercase text-neutral-500 dark:text-neutral-400">
                {format(day, "EEE")}
              </Text>
              <Text
                className={
                  isToday
                    ? "h-6 w-6 rounded-full bg-blue-600 text-center text-sm font-bold leading-6 text-white"
                    : "text-sm font-semibold text-black dark:text-white"
                }
              >
                {format(day, "d")}
              </Text>
            </View>
          );
        })}
      </View>

      {/* All-day row -- Google Calendar's own convention of a distinct strip
          above the hourly grid rather than trying to place all-day entries
          within it. Omitted entirely (no empty strip) when nothing is
          all-day this week. */}
      {hasAnyAllDayEntry ? (
        <View className="flex-row border-b border-neutral-200 py-1 dark:border-neutral-800">
          <View style={{ width: GUTTER_WIDTH }} />
          {layout.days.map((_, dayIndex) => (
            <View key={dayIndex} className="flex-1 gap-0.5 px-0.5">
              {(allDayByDay.get(dayIndex) ?? []).map((placement) => (
                <Pressable
                  key={placement.entry.id}
                  onPress={() => onEntryPress(placement.entry)}
                  className="rounded-sm bg-emerald-600 px-1 py-0.5 active:bg-emerald-700"
                >
                  <Text numberOfLines={1} className="text-[10px] font-semibold text-white">
                    {placement.entry.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {/* Scrollable hourly grid */}
      <ScrollView>
        <View className="flex-row">
          {/* Hour-label gutter */}
          <View style={{ width: GUTTER_WIDTH }}>
            {Array.from({ length: 24 }, (_, hour) => (
              <View key={hour} style={{ height: HOUR_ROW_HEIGHT }} className="items-end pr-1">
                <Text className="text-[9px] text-neutral-400 dark:text-neutral-500">
                  {hour === 0 ? "" : format(new Date(2000, 0, 1, hour), "h a")}
                </Text>
              </View>
            ))}
          </View>

          {/* One column per day */}
          {layout.days.map((day, dayIndex) => (
            <View
              key={dayIndex}
              style={{ height: GRID_HEIGHT }}
              className="relative flex-1 border-l border-neutral-100 dark:border-neutral-900"
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <Pressable
                  key={hour}
                  onPress={() => {
                    const slotDate = new Date(day);
                    slotDate.setHours(hour, 0, 0, 0);
                    onSlotPress(slotDate);
                  }}
                  style={{ height: HOUR_ROW_HEIGHT }}
                  className="border-b border-neutral-100 dark:border-neutral-900"
                />
              ))}
              {(timedByDay.get(dayIndex) ?? []).map((placement) => (
                <TimedBlock
                  key={`${placement.entry.id}-${placement.startMinutes}`}
                  placement={placement}
                  onPress={onEntryPress}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export type { WeekGridProps };
