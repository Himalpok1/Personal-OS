import type {
  TodayEventItem,
  TodayInboxItem,
  TodayProjectSummary,
  TodayResponse,
  TodayTaskItem,
} from "@personal-os/schema";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { BriefCard } from "@/components/brief/brief-card";
import { CanvasUpcomingAssignmentsCard } from "@/components/canvas/upcoming-assignments-card";
import { HealthTodayCard } from "@/components/health/health-today-card";
import { MailDigestCard } from "@/components/mail/digest-today-card";
import { ReminderNoticeCard } from "@/components/reminder-notice-card";
import {
  SuggestedFocusCard,
  type SuggestedFocusState,
} from "@/components/focus/suggested-focus-card";
import { FLOATING_CLEARANCE } from "@/components/floating-layout";
import { classifyTaskActionError, completionTarget } from "@/components/task-actions-state";
import { useAskEnabled } from "@/queries/ask";
import {
  focusCandidateCount,
  focusErrorMessage,
  isFocusNotEnoughCandidatesError,
  useSuggestFocus,
} from "@/queries/focus";
import { useCompleteOccurrence } from "@/queries/occurrences";
import { useCompleteTask } from "@/queries/tasks";
import { useToday } from "@/queries/today";
import { askSourceHref } from "@/utils/ask-navigation";
import { eventDetailHref } from "@/utils/event-navigation";
import { eventTimeLabel } from "@/utils/event-time-label";
import { addLocalDays, formatHeaderDate, parseLocalDate } from "@/utils/local-date";

/**
 * Where the "Ask about today" chip goes (Checkpoint 9.7). `preset=focus`
 * pre-selects that chip on the search screen's Ask mode and pre-fills its
 * question; it never submits. Typed like `(tabs)/_layout.tsx`'s SEARCH_ROUTE:
 * the generated route types know `/search` but not its query string.
 */
export const ASK_ABOUT_TODAY_HREF = "/search?mode=ask&preset=focus" as Href;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function eventStartMs(event: TodayEventItem): number {
  const iso = event.occurs_at ?? event.starts_at;
  return iso === null ? Number.MAX_SAFE_INTEGER : Date.parse(iso);
}

function upcomingDayLabel(date: string, todayLocalDate: string): string {
  if (date === addLocalDays(todayLocalDate, 1)) return "Tomorrow";
  return parseLocalDate(date).toLocaleDateString(undefined, { weekday: "long" });
}

// raw_text when the capture has one; otherwise an honest per-status label.
function inboxPreviewLabel(item: TodayInboxItem): string {
  if (item.raw_text) return item.raw_text;
  if (item.status === "needs_confirm") return "Needs confirmation";
  if (item.status === "failed") return "Parse failed";
  return "Pending capture";
}

const PROJECT_STATUS_CHIP: Record<TodayProjectSummary["status"], string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  paused: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
};

// Completing from Today must refresh this read model plus everything the
// completion can move. The task/occurrence hooks already invalidate their
// own domains ("tasks" / ["occurrences", "tasks"]); this adds "today" so
// the command center refetches too.
function useInvalidateAfterCompletion() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["today"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["occurrences"] });
  };
}

// Completion rule (Checkpoint 9.3): a row that carries `occurrence_id` IS
// the materialized occurrence of a recurring task, so it completes that
// occurrence directly -- one round trip, instead of the old
// POST /tasks/:id/complete -> 409 -> POST /occurrences/:id/complete detour.
// A row without one is a one-off task and goes through the task endpoint;
// the recurring 409s that path can still return are classified in
// components/task-actions-state.ts (use the named occurrence, or explain
// that none is generated yet).
function TaskRow({ item }: { item: TodayTaskItem }) {
  const router = useRouter();
  const complete = useCompleteTask();
  const completeOccurrence = useCompleteOccurrence();
  const invalidate = useInvalidateAfterCompletion();
  const [error, setError] = useState<string | null>(null);

  const showFailure = (err: unknown) => {
    const failure = classifyTaskActionError(err);
    if (failure.kind === "message") setError(failure.message);
  };

  const onComplete = () => {
    setError(null);
    const target = completionTarget(item);
    if (target.kind === "occurrence") {
      completeOccurrence.mutate(target.occurrenceId, {
        onSuccess: invalidate,
        onError: showFailure,
      });
      return;
    }
    complete.mutate(target.taskId, {
      onSuccess: invalidate,
      onError: (err) => {
        const failure = classifyTaskActionError(err);
        if (failure.kind === "use_occurrence") {
          completeOccurrence.mutate(failure.occurrenceId, {
            onSuccess: invalidate,
            onError: showFailure,
          });
          return;
        }
        setError(failure.message);
      },
    });
  };

  return (
    <Pressable
      onPress={() => router.push(`/tasks/${item.id}`)}
      className="flex-row items-center gap-3 px-4 py-3"
    >
      <Pressable
        onPress={(e) => {
          // Stop the tap from also triggering the row's onPress (navigate to
          // task detail) -- both handlers are on nested Pressables. Same
          // precedent as components/calendar/day-cell.tsx. On native the touch
          // responder already grants to the inner view, but Pressable maps to
          // bubbling DOM events under react-native-web, where this app also
          // ships, so the guard is load-bearing there.
          e.stopPropagation();
          onComplete();
        }}
        hitSlop={8}
        accessibilityLabel={`Complete ${item.title}`}
        accessibilityRole="button"
        // Without this the pending flags only drew the indicator dot -- the
        // circle stayed tappable and rapid taps fired concurrent completion
        // mutations (including the 409 -> occurrence fallback) (6.7A, A1).
        disabled={complete.isPending || completeOccurrence.isPending}
        className="h-8 w-8 items-center justify-center rounded-full border-2 border-neutral-400 dark:border-neutral-600"
      >
        {complete.isPending || completeOccurrence.isPending ? (
          <View className="h-2 w-2 rounded-full bg-neutral-400" />
        ) : null}
      </Pressable>
      <View className="flex-1">
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
          {item.rrule ? (
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">⟲</Text>
          ) : null}
          {/* Checkpoint 9.4: `due_at` on an occurrence row is already the
              snoozed instant; this only says WHY it differs from the rule. */}
          {item.snoozed_until ? (
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">snoozed</Text>
          ) : null}
        </View>
        {error ? (
          <Text className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function SectionHeader({ title, tone }: { title: string; tone: "red" | "blue" | "neutral" }) {
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

function EventRow({ event }: { event: TodayEventItem }) {
  const router = useRouter();
  // all_day is decided inside eventTimeLabel, which returns before any
  // instant is formatted -- see utils/event-time-label.ts. Previously this
  // chain fell through to occurs_at, which for a recurring all-day instance
  // is ADR-042's local-noon anchor, and rendered "12:00".
  const timeRange = eventTimeLabel(event, "All day");
  // A recurring instance carries its occurs_at (Checkpoint 9.5, mirroring
  // components/agenda/agenda-rows.tsx) so the detail screen can offer the
  // occurrence modal for exactly this instance rather than the series.
  return (
    <Pressable
      onPress={() => router.push(eventDetailHref(event.id, event.occurs_at) as Href)}
      className="flex-row items-baseline gap-3 px-4 py-3"
    >
      {/* w-24, matching components/agenda/agenda-rows.tsx: the widest real
          value is a range like "14:30–15:00" (11 chars at text-xs, ~80px),
          so 96px leaves margin. Narrower risks a two-line wrap here, which
          would misalign the row -- this Text has no numberOfLines. */}
      <Text
        className="w-24 shrink-0 text-xs text-neutral-500 dark:text-neutral-400"
        numberOfLines={1}
      >
        {timeRange}
      </Text>
      <View className="flex-1">
        {/* numberOfLines={2} matches components/agenda/agenda-rows.tsx for the
            same field -- otherwise one long event title truncates on Today but
            wraps on Agenda, giving the same event two different row heights. */}
        <Text className="text-base text-black dark:text-white" numberOfLines={2}>
          {event.title}
        </Text>
        {event.location ? (
          <Text className="text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
            {event.location}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function EventsSection({ events }: { events: TodayEventItem[] }) {
  const timed = events.filter((e) => !e.all_day).sort((a, b) => eventStartMs(a) - eventStartMs(b));
  const allDay = events.filter((e) => e.all_day);
  return (
    <View>
      <SectionHeader title="Today's events" tone="neutral" />
      {events.length === 0 ? (
        <Text className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">
          No events today.
        </Text>
      ) : (
        <>
          {timed.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
          {allDay.length > 0 ? (
            <Text className="px-4 pt-2 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
              All-day
            </Text>
          ) : null}
          {allDay.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </>
      )}
    </View>
  );
}

function UpcomingSection({ data }: { data: TodayResponse }) {
  const days = data.upcoming.days.filter((day) => day.total > 0);
  // Fully-empty horizon means no section at all -- not an empty-state block.
  if (days.length === 0) return null;
  return (
    <View>
      <SectionHeader title="Upcoming" tone="neutral" />
      {days.map((day) => (
        <View key={day.date}>
          <Text className="px-4 pt-3 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
            {upcomingDayLabel(day.date, data.local_date)}
          </Text>
          {day.tasks.map((task) => (
            <Text
              key={`${day.date}-task-${task.id}`}
              className="px-4 py-1 text-sm text-neutral-700 dark:text-neutral-300"
              numberOfLines={1}
            >
              · {task.title}
            </Text>
          ))}
          {day.events.map((event) => (
            <Text
              key={`${day.date}-event-${event.id}`}
              className="px-4 py-1 text-sm text-neutral-500 dark:text-neutral-400"
              numberOfLines={1}
            >
              · {event.title}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function InboxSection({ data }: { data: TodayResponse }) {
  if (data.summary.inbox_attention_total === 0) return null;
  return (
    <Link href="/(tabs)/inbox" asChild>
      <Pressable className="px-4 pt-5">
        <SectionHeader title="Inbox needs attention" tone="neutral" />
        <Text className="pb-1 text-sm text-neutral-500 dark:text-neutral-400">
          {data.summary.inbox_attention_total} waiting
        </Text>
        {data.inbox.items.slice(0, 5).map((item) => (
          <Text
            key={item.id}
            className="py-0.5 text-sm text-neutral-700 dark:text-neutral-300"
            numberOfLines={1}
          >
            · {inboxPreviewLabel(item)}
          </Text>
        ))}
      </Pressable>
    </Link>
  );
}

function ProjectCard({ project }: { project: TodayProjectSummary }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/projects/${project.id}`)}
      className="mx-4 mb-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <View className="flex-row items-center gap-2">
        <View
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: project.color ?? "#999999" }}
        />
        <Text className="flex-1 text-base font-medium text-black dark:text-white" numberOfLines={1}>
          {project.name}
        </Text>
        {project.stalled ? (
          <View className="rounded bg-amber-100 px-2 py-0.5 dark:bg-amber-900">
            <Text className="text-[10px] uppercase text-amber-700 dark:text-amber-300">
              Stalled
            </Text>
          </View>
        ) : null}
        <View className={`rounded px-2 py-0.5 ${PROJECT_STATUS_CHIP[project.status]}`}>
          <Text className="text-[10px] uppercase">{project.status}</Text>
        </View>
      </View>
      <Text className="mt-2 text-sm text-neutral-700 dark:text-neutral-300" numberOfLines={1}>
        {project.next_action ? `Next: ${project.next_action.title}` : "No next action"}
      </Text>
      <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        {project.open_task_count} open · {project.done_task_count} done ·{" "}
        {project.overdue_task_count} overdue
      </Text>
      {project.target_date ? (
        <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Target {formatHeaderDate(project.target_date)}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ProjectsSection({ projects }: { projects: TodayProjectSummary[] }) {
  return (
    <View>
      <SectionHeader title="Active projects" tone="neutral" />
      {projects.length === 0 ? (
        <Text className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">
          No active projects.
        </Text>
      ) : (
        projects.map((project) => <ProjectCard key={project.id} project={project} />)
      )}
    </View>
  );
}

function Chip({
  label,
  count,
  danger,
  onPress,
}: {
  label: string;
  count: number;
  danger?: boolean;
  onPress?: () => void;
}) {
  const dangerClass =
    "border-red-300 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400";
  const neutralClass = "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900";
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <View
        className={`min-h-[44px] items-center justify-center rounded-full border px-3 py-2 ${
          danger && count > 0 ? dangerClass : neutralClass
        }`}
      >
        <Text
          className={`text-sm ${
            danger && count > 0 ? "text-red-600 dark:text-red-400" : "text-black dark:text-white"
          }`}
        >
          {label} {count}
        </Text>
      </View>
    </Pressable>
  );
}

type ReviewRollup = TodayResponse["reviews"]["daily"];

// Entry banner for the daily/weekly review. status null offers Start;
// in_progress resumes; settled states render subtle and read-only.
function ReviewBanner({
  title,
  resumeTitle,
  doneTitle,
  skippedTitle,
  href,
  info,
}: {
  title: string;
  resumeTitle: string;
  doneTitle: string;
  skippedTitle: string;
  href: Href;
  info: ReviewRollup;
}) {
  const router = useRouter();
  if (info.status === null) {
    return (
      <View className="min-h-[44px] flex-row items-center justify-between rounded-xl border border-neutral-200 px-4 dark:border-neutral-800">
        <Text className="text-sm font-medium text-black dark:text-white">{title}</Text>
        <Pressable
          onPress={() => router.push(href)}
          hitSlop={8}
          accessibilityRole="button"
          className="rounded-lg bg-blue-600 px-3 py-2 active:bg-blue-700"
        >
          <Text className="text-sm font-semibold text-white">Start</Text>
        </Pressable>
      </View>
    );
  }
  if (info.status === "in_progress") {
    return (
      <Pressable
        onPress={() => router.push(href)}
        accessibilityRole="button"
        className="min-h-[44px] flex-row items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 active:bg-blue-100 dark:border-blue-900 dark:bg-blue-950 dark:active:bg-blue-900"
      >
        <Text className="text-sm font-medium text-blue-700 dark:text-blue-300">{resumeTitle}</Text>
        <Text className="text-sm font-semibold text-blue-700 dark:text-blue-300">→</Text>
      </Pressable>
    );
  }
  return (
    <View
      className={
        info.status === "completed"
          ? "min-h-[40px] flex-row items-center rounded-xl bg-green-50 px-4 py-2 dark:bg-green-950"
          : "min-h-[40px] flex-row items-center rounded-xl px-4 py-2"
      }
    >
      <Text
        className={
          info.status === "completed"
            ? "text-xs font-medium uppercase text-green-700 dark:text-green-300"
            : "text-xs font-medium uppercase text-neutral-500 dark:text-neutral-400"
        }
      >
        {info.status === "completed" ? doneTitle : skippedTitle}
      </Text>
    </View>
  );
}

export default function TodayScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useToday();
  // Shares the search screen's query key, so enabling Cloud Ask in Settings
  // shows the chip here without a restart -- and Today never waits on it.
  const askEnabled = useAskEnabled().enabled;

  // Checkpoint 9.8 ("Suggested Focus"). The mutation object IS the state
  // machine, mirroring how the search screen derives AskState directly from
  // its own mutation rather than a parallel useState -- mutate() is called
  // ONLY from the card's own button tap, never here and never on mount (see
  // suggested-focus-card.test.tsx and queries/focus.test.ts for the proof).
  //
  // focusRequestInFlightRef guards a rapid double-tap on "Suggest again" /
  // "Try again" / "Check again" (9.8 adversarial review): `isPending` is
  // REACT STATE and does not become visible to a second tap until the next
  // render, so it cannot by itself stop two `.mutate()` calls fired within
  // the same frame. A ref updates synchronously and is checked before
  // `.mutate()` ever runs, closing that window without adding local
  // `useState` to the hookless SuggestedFocusCard (which this app's test
  // harness cannot support -- see cloud-ask-card.tsx's module comment).
  const suggestFocus = useSuggestFocus();
  const focusRequestInFlightRef = useRef(false);
  const requestFocusSuggestion = useCallback(() => {
    if (focusRequestInFlightRef.current) return;
    focusRequestInFlightRef.current = true;
    suggestFocus.mutate(undefined, {
      onSettled: () => {
        focusRequestInFlightRef.current = false;
      },
    });
  }, [suggestFocus]);
  const focusState: SuggestedFocusState = suggestFocus.isPending
    ? { kind: "loading" }
    : isFocusNotEnoughCandidatesError(suggestFocus.error)
      ? { kind: "not_enough_candidates" }
      : suggestFocus.isError
        ? { kind: "error", message: focusErrorMessage(suggestFocus.error) }
        : suggestFocus.data
          ? { kind: "ready", response: suggestFocus.data }
          : { kind: "idle" };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Text className="text-neutral-500">Loading…</Text>
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white dark:bg-black">
        <Text className="text-red-600">Couldn&apos;t load today.</Text>
        <Pressable
          onPress={() => void refetch()}
          accessibilityRole="button"
          accessibilityLabel="Retry loading today"
          hitSlop={8}
          className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
        >
          <Text className="font-semibold text-white">Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName={FLOATING_CLEARANCE}
    >
      <View className="flex-row items-end justify-between px-4 pt-4">
        <View className="flex-1">
          <Text className="text-2xl font-bold text-black dark:text-white">Today</Text>
          <Text className="text-sm text-neutral-500 dark:text-neutral-400">
            {formatHeaderDate(data.local_date)}
          </Text>
        </View>
        {/* Header actions, one row: the calendar tab's "+" remains the
            primary entry point; this makes a new event one tap from the
            screen the owner lands on (Checkpoint 9.5). */}
        <View className="flex-row items-center gap-4">
          <Link href="/events/new" asChild>
            <Pressable
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="New event"
              className="min-h-[44px] items-center justify-center"
            >
              <Text className="text-sm text-blue-600 dark:text-blue-400">+ Event</Text>
            </Pressable>
          </Link>
          <Link href="/tasks" asChild>
            <Pressable hitSlop={8} className="min-h-[44px] items-center justify-center">
              <Text className="text-sm text-blue-600 dark:text-blue-400">All tasks</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      <View className="mt-3 flex-row flex-wrap gap-2 px-4">
        <Chip label="Overdue" count={data.summary.overdue_total} danger />
        <Chip label="Due today" count={data.summary.due_today_total} />
        <Chip
          label="Inbox"
          count={data.summary.inbox_attention_total}
          onPress={() => router.push("/(tabs)/inbox")}
        />
        <Chip
          label="Projects"
          count={data.summary.active_project_count}
          onPress={() => router.push("/(tabs)/projects")}
        />
        {/* Checkpoint 9.7 ("Ask about today"). Rendered ONLY while the "ask"
            task route exists -- the same switch that hides the Ask mode on
            the search screen -- so an owner who never opted in never sees
            it. The route param only pre-selects the "focus" chip and
            pre-fills its question; nothing is sent until they tap Ask. */}
        {askEnabled ? (
          <Pressable
            testID="today-ask-chip"
            onPress={() => router.push(ASK_ABOUT_TODAY_HREF)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Ask about today"
          >
            <View className="min-h-[44px] items-center justify-center rounded-full border border-blue-300 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-950">
              <Text className="text-sm text-blue-700 dark:text-blue-300">Ask about today</Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      {/* Checkpoint 9.8. Gated on the same switch as the Ask chip, right
          after it. SuggestedFocusCard enforces FOCUS_MIN_CANDIDATES itself
          too, so this is belt-and-braces, matching the existing
          `askEnabled ? (...) : null` idiom rather than duplicating the
          threshold check here. */}
      {askEnabled ? (
        <SuggestedFocusCard
          candidateCount={focusCandidateCount(data.summary)}
          state={focusState}
          onSuggest={requestFocusSuggestion}
          onSelectSource={(source) => router.push(askSourceHref(source))}
        />
      ) : null}

      <View className="mt-3 gap-2 px-4">
        <ReviewBanner
          title="Daily review"
          resumeTitle="Resume daily review"
          doneTitle="✓ Daily review completed"
          skippedTitle="Daily review skipped"
          href="/reviews/daily"
          info={data.reviews.daily}
        />
        <ReviewBanner
          title="Weekly review"
          resumeTitle="Resume weekly review"
          doneTitle="✓ Weekly review completed"
          skippedTitle="Weekly review skipped"
          href="/reviews/weekly"
          info={data.reviews.weekly}
        />
      </View>

      {/* Checkpoint 8.4 Lane 6. Renders NOTHING unless reminders genuinely
          cannot fire on this device. Informational only -- it never promotes
          a device or flips a setting (ADR-019/036); it names the reason and
          points at the screen that can fix it. Placed above the Brief because
          "your reminders are not running" outranks anything below it. */}
      <ReminderNoticeCard />

      {/* Checkpoint 5.5: manual/on-demand Daily Brief (ADR-041). The card
          owns its own GET /briefs/current query -- Today only carries brief
          metadata, and rendering Today never triggers a model call. */}
      <BriefCard />

      {/* Checkpoint 6.4. Like BriefCard, this owns its own query rather than
          riding on /today's response -- Today must never wait on, or fail
          because of, a Google Health sync. It renders null when there is no
          connection, and shows only metrics that actually have a value today,
          so a missing metric is never mistaken for a zero. */}
      <HealthTodayCard />

      {/* Checkpoint 7.6 -- the ONE new Today card. Same posture as the two
          above: it owns its own GET /mail-digests/current query, so a mail
          outage can never make Today fail to load, and rendering Today never
          triggers a model call. Its prose is clamped, because a model-authored
          digest has no length bound and Today is the busiest screen on a
          480x640 device. */}
      <MailDigestCard />

      {/* Checkpoint 10.1 (ADR-068) -- like the two cards above, it owns its
          own GET /canvas-assignments/upcoming query, so a Canvas outage or a
          not-yet-connected institution can never make Today fail to load. It
          renders nothing at all when there is no connection or nothing due
          soon, the same posture HealthTodayCard documents. */}
      <CanvasUpcomingAssignmentsCard />

      <View>
        <SectionHeader title={`Overdue · ${data.overdue.total}`} tone="red" />
        {data.overdue.items.length === 0 ? (
          <Text className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">
            Nothing overdue.
          </Text>
        ) : (
          data.overdue.items.map((item) => (
            <TaskRow key={item.occurrence_id ?? item.id} item={item} />
          ))
        )}
      </View>

      <View>
        <SectionHeader title={`Due today · ${data.due_today.total}`} tone="blue" />
        {data.due_today.items.length === 0 ? (
          <Text className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">
            Nothing due today.
          </Text>
        ) : (
          data.due_today.items.map((item) => (
            <TaskRow key={item.occurrence_id ?? item.id} item={item} />
          ))
        )}
      </View>

      <EventsSection events={data.events_today.items} />
      <UpcomingSection data={data} />
      <InboxSection data={data} />
      <ProjectsSection projects={data.projects.items} />
    </ScrollView>
  );
}
