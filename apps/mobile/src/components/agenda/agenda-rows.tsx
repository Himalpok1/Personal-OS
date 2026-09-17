// Row-level presentational pieces for the Agenda screen. Mirrors the row
// conventions established in (tabs)/index.tsx (the Today command center)
// exactly -- same completion-circle pattern, same two-line title, same
// one-line time column -- but is its own file (index.tsx is owned by another
// agent) so small duplications of tiny formatting helpers below are
// deliberate, not missed reuse.
//
// Checkpoint 10.3: rows compose the design system's ListRow, Button and Icon.
// The three controls of a task row (complete, open, skip / +1 day) stay
// SIBLINGS rather than nesting inside one pressable: under react-native-web
// a nested Pressable's tap bubbles to the row's own onPress, which is the
// rule every list row in this app records.
//
// Checkpoint 10.6 (ADR-076 §2): the hand-rolled completion circle is the
// design system's `CompletionCircle` -- the same `open` / `pending` states,
// the same 44px target, the same disabled-while-pending rule -- and it sits
// in the ListRow's `leading` slot under `containsControl`, exactly as Today's
// rows do. The circle stops its own tap's propagation, so the row's onPress
// (open the task) does not also fire; the Skip / +1 day button stays a
// sibling. Every mutation, label and fallback is unchanged.
import { ApiClientError } from "@personal-os/api-client";
import type { AgendaItem, AgendaTaskItem, AgendaOccurrenceItem, AgendaEventItem } from "@personal-os/schema";
import { useRouter, type Href } from "expo-router";
import { View } from "react-native";
import {
  AppText,
  Button,
  CompletionCircle,
  ListRow,
  SectionHeader as UiSectionHeader,
  type SectionTone,
} from "@/components/ui";
import { eventDetailHref } from "@/utils/event-navigation";
import { eventTimeLabel } from "@/utils/event-time-label";
import { useCompleteOccurrence, useSkipOccurrence } from "@/queries/occurrences";
import { useCompleteTask, useUpdateTask } from "@/queries/tasks";
import { useInvalidateAgenda } from "@/queries/agenda";
import { addOneDayPreservingWallClock } from "./agenda-grouping";

const SECTION_TONE: Record<"red" | "blue" | "neutral", SectionTone> = {
  red: "danger",
  blue: "info",
  neutral: "default",
};

export function SectionHeader({
  title,
  tone,
}: {
  title: string;
  tone: "red" | "blue" | "neutral";
}) {
  return <UiSectionHeader title={title} tone={SECTION_TONE[tone]} />;
}

// The hairline between rows on one card, the same one ListRow draws; the
// task row is three sibling controls in a View, so it draws its own.
const ROW_DIVIDER_CLASS = "border-b border-outline/70 dark:border-outline-dark";

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
export function AgendaTaskRow({
  item,
  last = false,
}: {
  item: AgendaTaskItem | AgendaOccurrenceItem;
  last?: boolean;
}) {
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

  // One muted line under the title: the due time, the project, and whether
  // it repeats -- the same three facts the pre-10.3 row showed as separate
  // fragments, as a single one-line `meta` so the row height stays put.
  const meta = [
    item.due_at ? formatTime(item.due_at) : null,
    item.project_name,
    isRecurring ? "Repeats" : null,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" · ");

  return (
    <View className={`flex-row items-center gap-1 pl-3 pr-2 ${last ? "" : ROW_DIVIDER_CLASS}`}>
      <ListRow
        leading={
          // `pending` previously only drew the indicator dot; all three action
          // controls in this row stayed tappable mid-flight (6.7A, A2). The
          // circle disables itself in that state.
          <CompletionCircle
            state={pending ? "pending" : "open"}
            tone="success"
            onPress={onComplete}
            accessibilityLabel={`Complete ${item.title}`}
          />
        }
        title={item.title}
        meta={meta.length > 0 ? meta : undefined}
        onPress={() => router.push(`/tasks/${item.id}`)}
        accessibilityLabel={`Open task: ${item.title}`}
        containsControl
        inset
        last
        className="flex-1"
      />
      {isOccurrence ? (
        <Button
          label="Skip"
          onPress={onSkip}
          variant="ghost"
          size="sm"
          disabled={pending}
          accessibilityLabel={`Skip ${item.title}`}
        />
      ) : item.due_at ? (
        <Button
          label="+1 day"
          onPress={onPlusOneDay}
          variant="ghost"
          size="sm"
          disabled={pending}
          accessibilityLabel={`Move ${item.title} to tomorrow`}
        />
      ) : null}
    </View>
  );
}

export function AgendaEventRow({ item, last = false }: { item: AgendaEventItem; last?: boolean }) {
  const router = useRouter();
  // One href rule shared with Today (utils/event-navigation.ts).
  const onPress = () => router.push(eventDetailHref(item.id, item.occurs_at) as Href);
  // Routed through the shared helper (Checkpoint 5.7.1) so the
  // all_day-checked-first rule has ONE source of truth with Today rather than
  // two hand-maintained chains that can drift. This surface was already
  // correct; sharing keeps it that way.
  const timeLabel = eventTimeLabel(item, "ALL-DAY");
  return (
    <ListRow
      leading={
        // w-24, matching (tabs)/index.tsx: the widest real value is a range
        // like "14:30–15:00" (11 chars at caption size, ~80px), so 96px leaves
        // margin. Narrower risks a two-line wrap here, which would misalign
        // the row.
        <AppText variant="caption" tone="muted" numberOfLines={1} className="w-24 shrink-0">
          {timeLabel}
        </AppText>
      }
      title={item.title}
      // `meta`, not `subtitle`: the location stays the one line it has
      // always been.
      meta={item.location ?? undefined}
      onPress={onPress}
      accessibilityLabel={`Open event: ${item.title}`}
      last={last}
    />
  );
}

export function AgendaItemRow({ item, last = false }: { item: AgendaItem; last?: boolean }) {
  if (isTaskOrOccurrence(item)) return <AgendaTaskRow item={item} last={last} />;
  return <AgendaEventRow item={item} last={last} />;
}
