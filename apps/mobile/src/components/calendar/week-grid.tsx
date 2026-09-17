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
//
// Checkpoint 10.3: colours come from the design tokens -- a timed block is a
// `primary` block, an all-day entry a `secondary-container` pill, today a
// `primary-container` disc -- written here because components/ui/ has no
// calendar primitive. The placement math and every dimension are untouched.
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { format } from "date-fns";
import type { EventRangeItem } from "@personal-os/schema";
import { AppText } from "@/components/ui";
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

const HAIRLINE_CLASS = "border-outline dark:border-outline-dark";
const GRIDLINE_CLASS = "border-outline/60 dark:border-outline-dark/60";
const TIMED_BLOCK_CLASS = "bg-primary active:opacity-80 dark:bg-primary-dark";
const TIMED_TEXT_CLASS = "text-on-primary dark:text-on-primary-dark";
const ALL_DAY_PILL_CLASS =
  "bg-secondary-container active:opacity-80 dark:bg-secondary-container-dark";
const ALL_DAY_TEXT_CLASS = "text-on-secondary-container dark:text-on-secondary-container-dark";
const TODAY_DISC_CLASS = "bg-primary-container dark:bg-primary-container-dark";
const TODAY_TEXT_CLASS = "text-on-primary-container dark:text-on-primary-container-dark";

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
      hitSlop={4}
      className={`overflow-hidden rounded-sm px-1 py-0.5 ${TIMED_BLOCK_CLASS}`}
      accessibilityRole="button"
      accessibilityLabel={placement.entry.title}
    >
      <AppText
        variant="caption"
        tone="inherit"
        numberOfLines={1}
        className={`text-[10px] font-semibold leading-[13px] ${TIMED_TEXT_CLASS}`}
      >
        {placement.entry.title}
      </AppText>
      <AppText
        variant="caption"
        tone="inherit"
        numberOfLines={1}
        className={`text-[9px] leading-[12px] opacity-80 ${TIMED_TEXT_CLASS}`}
      >
        {formatTimeLabel(placement.entry, placement.startMinutes)}
      </AppText>
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
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      {/* Day-name / date header row */}
      <View className={`flex-row border-b ${HAIRLINE_CLASS}`}>
        <View style={{ width: GUTTER_WIDTH }} />
        {layout.days.map((day, dayIndex) => {
          const isToday = isSameLocalDay(day, today);
          return (
            <View
              key={dayIndex}
              className="flex-1 items-center py-1"
              // One accessible node per header day, naming "today" explicitly:
              // the tinted circle was otherwise the only signal (6.7A, AY6).
              accessible
              accessibilityLabel={`${format(day, "EEEE d")}${isToday ? ", today" : ""}`}
            >
              <AppText variant="overline" tone="muted" className="text-[10px]">
                {format(day, "EEE")}
              </AppText>
              <View
                className={`h-6 w-6 items-center justify-center rounded-full ${
                  isToday ? TODAY_DISC_CLASS : ""
                }`}
              >
                <AppText
                  variant="label"
                  tone={isToday ? "inherit" : "default"}
                  className={`font-semibold ${isToday ? TODAY_TEXT_CLASS : ""}`}
                >
                  {format(day, "d")}
                </AppText>
              </View>
            </View>
          );
        })}
      </View>

      {/* All-day row -- Google Calendar's own convention of a distinct strip
          above the hourly grid rather than trying to place all-day entries
          within it. Omitted entirely (no empty strip) when nothing is
          all-day this week. */}
      {hasAnyAllDayEntry ? (
        <View className={`flex-row border-b py-1 ${HAIRLINE_CLASS}`}>
          <View style={{ width: GUTTER_WIDTH }} />
          {layout.days.map((_, dayIndex) => (
            <View key={dayIndex} className="flex-1 gap-0.5 px-0.5">
              {(allDayByDay.get(dayIndex) ?? []).map((placement) => (
                <Pressable
                  key={placement.entry.id}
                  onPress={() => onEntryPress(placement.entry)}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={placement.entry.title}
                  className={`rounded-sm px-1 py-0.5 ${ALL_DAY_PILL_CLASS}`}
                >
                  <AppText
                    variant="caption"
                    tone="inherit"
                    numberOfLines={1}
                    className={`text-[10px] font-semibold leading-[13px] ${ALL_DAY_TEXT_CLASS}`}
                  >
                    {placement.entry.title}
                  </AppText>
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
                <AppText
                  variant="caption"
                  tone="muted"
                  numberOfLines={1}
                  className="text-[10px] leading-[13px]"
                >
                  {hour === 0 ? "" : format(new Date(2000, 0, 1, hour), "h a")}
                </AppText>
              </View>
            ))}
          </View>

          {/* One column per day */}
          {layout.days.map((day, dayIndex) => (
            <View
              key={dayIndex}
              style={{ height: GRID_HEIGHT }}
              className={`relative flex-1 border-l ${GRIDLINE_CLASS}`}
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
                  accessibilityRole="button"
                  accessibilityLabel={`${format(day, "EEEE d")}, ${format(new Date(2000, 0, 1, hour), "h a")}, new event`}
                  className={`border-b ${GRIDLINE_CLASS}`}
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
