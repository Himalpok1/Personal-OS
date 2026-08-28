// Row-level presentational pieces for the Agenda screen. Mirrors the row
// conventions established in (tabs)/index.tsx (the Today command center)
// exactly -- same padding, same tone classes, same completion-circle
// pattern -- but is its own file (index.tsx is owned by another agent) so
// small duplications of tiny formatting helpers below are deliberate, not
// missed reuse.
import { ApiClientError } from "@personal-os/api-client";
import type { AgendaItem, AgendaTaskItem, AgendaOccurrenceItem, AgendaEventItem } from "@personal-os/schema";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { eventTimeLabel } from "@/utils/event-time-label";
import { useCompleteOccurrence, useSkipOccurrence } from "@/queries/occurrences";
import { useCompleteTask, useUpdateTask } from "@/queries/tasks";
import { useInvalidateAgenda } from "@/queries/agenda";
import { addOneDayPreservingWallClock } from "./agenda-grouping";

export function SectionHeader({
  title,
  tone,
}: {
  title: string;
  tone: "red" | "blue" | "neutral";
}) {
  const toneClass =
    tone === "red"
      ? "text-red-600 dark:text-red-400"
      : tone === "blue"
        ? "text-blue-600 dark:text-blue-400"
        : "text-neutral-500 dark:text-neutral-400";
  return (
    <Text className={`px-4 pb-2 pt-5 text-sm font-semibold uppercase ${toneClass}`}>{title}</Text>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function isTaskOrOccurrence(item: AgendaItem): item is AgendaTaskItem | AgendaOccurrenceItem {
  return item.kind === "task" || item.kind === "occurrence";
}

export function agendaItemKey(item: AgendaItem): string {
  if (item.kind === "occurrence") return `occurrence-${item.occurrence_id}`;
  if (item.kind === "task") return `task-${item.id}`;
  return `event-${item.id}-${item.occurs_at ?? item.starts_at ?? "allday"}`;
}

// Same completion rule as Today/Tasks: completeTask first, fall back to the
// occurrence on the recurring-task 409 (ApiClientError.body.occurrence_id).
// An item that already arrived as kind "occurrence" completes/skips
// directly -- it IS the actionable representation (frozen dedupe rule).
export function AgendaTaskRow({ item }: { item: AgendaTaskItem | AgendaOccurrenceItem }) {
  const router = useRouter();
  const completeTask = useCompleteTask();
  const completeOccurrence = useCompleteOccurrence();
  const skipOccurrence = useSkipOccurrence();
  const updateTask = useUpdateTask();
  const invalidateAgenda = useInvalidateAgenda();

  const isOccurrence = item.kind === "occurrence";
  const isRecurring = isOccurrence || item.rrule !== null;
  const pending =
    completeTask.isPending ||
    completeOccurrence.isPending ||
    skipOccurrence.isPending ||
    updateTask.isPending;

  const onComplete = () => {
    if (isOccurrence) {
      completeOccurrence.mutate(item.occurrence_id, { onSuccess: invalidateAgenda });
      return;
    }
    completeTask.mutate(item.id, {
      onSuccess: invalidateAgenda,
      onError: (err) => {
        if (err instanceof ApiClientError && err.status === 409) {
          const occurrenceId = (err.body as { occurrence_id?: string | null })?.occurrence_id;
          if (occurrenceId) {
            completeOccurrence.mutate(occurrenceId, { onSuccess: invalidateAgenda });
          }
        }
      },
    });
  };

  const onSkip = () => {
    if (isOccurrence) skipOccurrence.mutate(item.occurrence_id, { onSuccess: invalidateAgenda });
  };

  // There is no per-occurrence reschedule endpoint (recorded debt) -- the
  // +1 day affordance only applies to a plain, non-recurring task's own
  // due_at. Recurring items get complete/skip only.
  const onPlusOneDay = () => {
    if (isRecurring || !item.due_at) return;
    updateTask.mutate(
      { id: item.id, body: { due_at: addOneDayPreservingWallClock(item.due_at, item.timezone) } },
      { onSuccess: invalidateAgenda },
    );
  };

  return (
    <View className="min-h-[40px] flex-row items-center gap-2 px-4 py-3">
      <Pressable
        onPress={onComplete}
        hitSlop={8}
        accessibilityLabel={`Complete ${item.title}`}
        accessibilityRole="button"
        // `pending` previously only drew the indicator dot; all three action
        // controls in this row stayed tappable mid-flight (6.7A, A2).
        disabled={pending}
        className="h-8 w-8 items-center justify-center rounded-full border-2 border-neutral-400 dark:border-neutral-600"
      >
        {pending ? <View className="h-2 w-2 rounded-full bg-neutral-400" /> : null}
      </Pressable>
      <Pressable
        onPress={() => router.push(`/tasks/${item.id}`)}
        hitSlop={4}
        className="flex-1"
        accessibilityRole="button"
      >
        <Text className="text-base text-black dark:text-white" numberOfLines={2}>
          {item.title}
        </Text>
        <View className="mt-0.5 flex-row items-center gap-2">
          {item.due_at ? (
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">
              {formatTime(item.due_at)}
            </Text>
          ) : null}
          {item.project_name ? (
            <View className="flex-row items-center gap-1">
              <View className="h-2 w-2 rounded-full bg-neutral-400 dark:bg-neutral-500" />
              <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                {item.project_name}
              </Text>
            </View>
          ) : null}
          {isRecurring ? (
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">⟲</Text>
          ) : null}
        </View>
      </Pressable>
      {isOccurrence ? (
        <Pressable
          onPress={onSkip}
          hitSlop={8}
          accessibilityLabel={`Skip ${item.title}`}
          accessibilityRole="button"
          disabled={pending}
          className="min-h-[40px] items-center justify-center px-2"
        >
          <Text className="text-xs text-neutral-500 dark:text-neutral-400">Skip</Text>
        </Pressable>
      ) : item.due_at ? (
        <Pressable
          onPress={onPlusOneDay}
          hitSlop={8}
          accessibilityLabel={`Move ${item.title} to tomorrow`}
          accessibilityRole="button"
          disabled={pending}
          className="min-h-[40px] items-center justify-center px-2"
        >
          <Text className="text-xs text-blue-600 dark:text-blue-400">+1 day</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function AgendaEventRow({ item }: { item: AgendaEventItem }) {
  const router = useRouter();
  const onPress = () => {
    if (item.occurs_at) {
      router.push(`/events/${item.id}?occursAt=${encodeURIComponent(item.occurs_at)}`);
    } else {
      router.push(`/events/${item.id}`);
    }
  };
  // Routed through the shared helper (Checkpoint 5.7.1) so the
  // all_day-checked-first rule has ONE source of truth with Today rather than
  // two hand-maintained chains that can drift. This surface was already
  // correct; sharing keeps it that way.
  const timeLabel = eventTimeLabel(item, "ALL-DAY");
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      className="min-h-[40px] flex-row items-baseline gap-3 px-4 py-3"
      accessibilityRole="button"
    >
      <Text
        className="w-24 shrink-0 text-xs text-neutral-500 dark:text-neutral-400"
        numberOfLines={1}
      >
        {timeLabel}
      </Text>
      <View className="flex-1">
        <Text className="text-base text-black dark:text-white" numberOfLines={2}>
          {item.title}
        </Text>
        {item.location ? (
          <Text className="text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
            {item.location}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function AgendaItemRow({ item }: { item: AgendaItem }) {
  if (isTaskOrOccurrence(item)) return <AgendaTaskRow item={item} />;
  return <AgendaEventRow item={item} />;
}
