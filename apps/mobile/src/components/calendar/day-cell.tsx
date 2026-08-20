import type { EventRangeItem } from "@personal-os/schema";
import { Pressable, Text, View } from "react-native";

// Presentational only, no data fetching -- entries are pre-bucketed by the
// caller (month-grid.tsx, via grid-math.ts's groupEntriesByDay) and handed
// in as exactly this day's entries. Sized for the Rabbit R1's 480px-wide
// screen down to a 7-column grid (~68px/cell), same "generic small-screen
// styling, no vendor checks" precedent as the rest of apps/mobile (see
// docs/STATUS.md's Phase 3 Checkpoint 3 note on hardware-input isolation).
export interface DayCellProps {
  date: Date;
  isCurrentPeriod: boolean;
  isToday: boolean;
  entries: EventRangeItem[];
  onPress: (date: Date) => void;
  onEntryPress: (entry: EventRangeItem) => void;
}

// Above this many entries, switch from title chips to compact dots -- a
// small cell can realistically show 2-3 titles before it needs scroll
// affordance this component deliberately doesn't add (that's a detail-view
// concern, not a grid-cell one).
const MAX_TITLE_ENTRIES = 2;

export function DayCell({ date, isCurrentPeriod, isToday, entries, onPress, onEntryPress }: DayCellProps) {
  const dayNumber = date.getDate();
  const visibleEntries = entries.slice(0, MAX_TITLE_ENTRIES);
  const overflowCount = entries.length - visibleEntries.length;

  return (
    <Pressable
      onPress={() => onPress(date)}
      accessibilityLabel={`${date.toDateString()}${entries.length > 0 ? `, ${entries.length} event${entries.length === 1 ? "" : "s"}` : ""}`}
      className={`min-h-[64px] flex-1 border-b border-r border-neutral-200 p-1 dark:border-neutral-800 ${
        isCurrentPeriod ? "bg-white dark:bg-black" : "bg-neutral-50 dark:bg-neutral-950"
      }`}
    >
      <View
        className={`h-6 w-6 items-center justify-center rounded-full ${
          isToday ? "bg-blue-600" : ""
        }`}
      >
        <Text
          className={`text-xs ${
            isToday
              ? "font-semibold text-white"
              : isCurrentPeriod
                ? "text-black dark:text-white"
                : "text-neutral-400 dark:text-neutral-600"
          }`}
        >
          {dayNumber}
        </Text>
      </View>

      <View className="mt-1 gap-0.5">
        {visibleEntries.map((entry) => (
          <Pressable
            key={entry.id + (entry.occurs_at ?? entry.starts_at ?? entry.start_date ?? "")}
            onPress={(e) => {
              // Stop the tap from also triggering the cell's onPress
              // (tap-to-create) -- both handlers are on nested Pressables.
              e.stopPropagation();
              onEntryPress(entry);
            }}
            className="rounded bg-blue-100 px-1 py-0.5 dark:bg-blue-950"
          >
            <Text
              numberOfLines={1}
              className="text-[10px] text-blue-800 dark:text-blue-200"
            >
              {entry.title}
            </Text>
          </Pressable>
        ))}
        {overflowCount > 0 ? (
          <Text className="text-[10px] text-neutral-500 dark:text-neutral-400">
            +{overflowCount} more
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
