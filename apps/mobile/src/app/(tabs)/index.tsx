import type {
  TodayEventItem,
  TodayInboxItem,
  TodayProjectSummary,
  TodayResponse,
  TodayTaskItem,
} from "@personal-os/schema";
import { Link, useRouter, type Href } from "expo-router";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { AcademicTodayCard } from "@/components/academic/academic-today-card";
import { BriefCard } from "@/components/brief/brief-card";
import { HealthTodayCard } from "@/components/health/health-today-card";
import { MailDigestCard } from "@/components/mail/digest-today-card";
import { ReminderNoticeCard } from "@/components/reminder-notice-card";
import { BriefingCard } from "@/components/today/briefing-card";
import { FocusNowCard } from "@/components/today/focus-now-card";
import { useTodayTaskActions } from "@/components/today/use-today-task-actions";
import {
  SuggestedFocusCard,
  type SuggestedFocusState,
} from "@/components/focus/suggested-focus-card";
import {
  AppText,
  Button,
  Card,
  CompletionCircle,
  EmptyState,
  ErrorState,
  Icon,
  ListRow,
  Screen,
  ScreenCentered,
  ScreenFrame,
  ScreenHeader,
  SectionHeader,
  SkeletonScreen,
  StatusChip,
  SwipeableRow,
  enterRise,
  showToast,
  useTheme,
  type ChipTone,
  type IconName,
} from "@/components/ui";
import { UI_TEST_MODE } from "@/config/ui-test-mode";
import { useAskEnabled } from "@/queries/ask";
import {
  focusCandidateCount,
  focusErrorMessage,
  isFocusNotEnoughCandidatesError,
  useSuggestFocus,
} from "@/queries/focus";
import { useToday } from "@/queries/today";
import { askSourceHref } from "@/utils/ask-navigation";
import { eventDetailHref } from "@/utils/event-navigation";
import { eventTimeLabel } from "@/utils/event-time-label";
import { greetingForHour, hourFromInstant, importantThingsLine } from "@/utils/greeting";
import { addLocalDays, formatHeaderDate, parseLocalDate } from "@/utils/local-date";

// The Today command centre (Checkpoint 5.1; rebuilt on the design system in
// Checkpoint 10.3; reorganised actionable-first in Checkpoint 10.6, ADR-076
// §4). Every data path and behaviour from before is kept -- task completion
// with its occurrence fallback, the reviews, the Ask chip and Suggested
// Focus behind the `ask` switch, the self-owned cards (reminders, brief,
// health, mail, academics), the events / upcoming / inbox / projects
// sections. What 10.6 changed is the ORDER and the quick actions: the one
// gradient block is now the deterministic daily briefing (ADR-075 §4), the
// duplicate stat row is gone, Focus Now and the two task sections come
// before the cards, every task row carries a completion circle and swipe
// actions, and every academic row opens an in-app sheet -- whose one host
// this screen mounts at the end.

/**
 * Where the "Ask about today" chip goes (Checkpoint 9.7). `preset=focus`
 * pre-selects that chip on the search screen's Ask mode and pre-fills its
 * question; it never submits. Typed like `(tabs)/_layout.tsx`'s SEARCH_ROUTE:
 * the generated route types know `/search` but not its query string.
 */
export const ASK_ABOUT_TODAY_HREF = "/search?mode=ask&preset=focus" as Href;

const INBOX_ROUTE = "/(tabs)/inbox" as Href;
const PROJECTS_ROUTE = "/(tabs)/projects" as Href;

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

/**
 * The second line of a task row: its due time, project, and the two
 * recurrence facts. Checkpoint 9.4: `due_at` on an occurrence row is already
 * the snoozed instant; "Snoozed" only says WHY it differs from the rule.
 */
function taskRowSubtitle(item: TodayTaskItem): string | undefined {
  const parts = [
    item.due_at ? formatTime(item.due_at) : null,
    item.project_name,
    item.rrule ? "Repeats" : null,
    item.snoozed_until ? "Snoozed" : null,
  ].filter((part): part is string => typeof part === "string" && part.length > 0);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

const PROJECT_STATUS_CHIP: Record<
  TodayProjectSummary["status"],
  { tone: ChipTone; label: string }
> = {
  active: { tone: "success", label: "Active" },
  paused: { tone: "neutral", label: "Paused" },
  completed: { tone: "info", label: "Completed" },
};

// Completion rule (Checkpoint 9.3): a row that carries `occurrence_id` IS
// the materialized occurrence of a recurring task, so it completes that
// occurrence directly; a one-off goes through the task endpoint with the
// 409 -> occurrence fallback. Both live in components/today/
// use-today-task-actions.ts since Checkpoint 10.6, shared with the Focus Now
// rows and their sheet, so Today never runs a second copy of the rule.
function TaskRow({ item, last }: { item: TodayTaskItem; last: boolean }) {
  const router = useRouter();
  const actions = useTodayTaskActions();
  const [error, setError] = useState<string | null>(null);

  const onComplete = () => {
    setError(null);
    actions.complete(item, {
      onSuccess: () => showToast({ message: "Completed", tone: "success" }),
      onError: setError,
    });
  };

  return (
    <View>
      <SwipeableRow
        rightActions={[
          {
            key: "done",
            label: "Done",
            icon: "check",
            tone: "success",
            haptic: "success",
            onPress: onComplete,
          },
        ]}
      >
        <ListRow
          title={item.title}
          subtitle={taskRowSubtitle(item)}
          // The completion circle (Checkpoint 10.6) stops its tap propagating
          // so the row's own onPress (navigate) does not also fire, and the
          // row is marked containsControl so it drops its button role -- the
          // same two rules the hand-rolled circle kept before it.
          leading={
            <CompletionCircle
              state={actions.pending ? "pending" : "open"}
              onPress={onComplete}
              accessibilityLabel={`Complete ${item.title}`}
            />
          }
          onPress={() => router.push(`/tasks/${item.id}`)}
          accessibilityLabel={item.title}
          containsControl
          entering={enterRise}
          chevron
          last={last || error !== null}
        />
      </SwipeableRow>
      {/* A completion failure reads as its own inert row under the task, so
          the divider logic stays ListRow's and the message keeps its tone. */}
      {error ? (
        <ListRow
          title={error}
          titleTone="danger"
          icon="alert-circle-outline"
          iconTone="danger"
          accessibilityLabel={`${item.title}: ${error}`}
          last={last}
        />
      ) : null}
    </View>
  );
}

function TaskSection({
  title,
  tone,
  icon,
  section,
  emptyTitle,
  emptyTone,
  action,
}: {
  title: string;
  tone: "danger" | "info";
  icon: IconName;
  section: TodayResponse["overdue"];
  emptyTitle: string;
  emptyTone: "neutral" | "success";
  action?: { label: string; onPress: () => void; accessibilityLabel?: string };
}) {
  return (
    <View>
      <SectionHeader title={title} count={section.total} tone={tone} icon={icon} action={action} />
      <Card padding="none">
        {section.items.length === 0 ? (
          <EmptyState
            icon={emptyTone === "success" ? "check-circle-outline" : "calendar-check-outline"}
            title={emptyTitle}
            tone={emptyTone}
          />
        ) : (
          section.items.map((item, index) => (
            <TaskRow
              key={item.occurrence_id ?? item.id}
              item={item}
              last={index === section.items.length - 1}
            />
          ))
        )}
      </Card>
    </View>
  );
}

/**
 * Whether the row being rendered is the last in its card (ListRow drops its
 * divider on the last row). Carried by context because `EventRow`'s
 * one-prop signature is pinned by __tests__/new-event-screen.test.ts
 * (Checkpoint 9.5), which is outside this screen's own guards.
 */
const LastRowContext = createContext(false);

function EventRow({ event }: { event: TodayEventItem }) {
  const router = useRouter();
  const last = useContext(LastRowContext);
  // all_day is decided inside eventTimeLabel, which returns before any
  // instant is formatted -- see utils/event-time-label.ts. Previously this
  // chain fell through to occurs_at, which for a recurring all-day instance
  // is ADR-042's local-noon anchor, and rendered "12:00".
  const timeRange = eventTimeLabel(event, "All day");
  // A recurring instance carries its occurs_at (Checkpoint 9.5, mirroring
  // components/agenda/agenda-rows.tsx) so the detail screen can offer the
  // occurrence modal for exactly this instance rather than the series.
  return (
    <ListRow
      title={event.title}
      subtitle={event.location ?? undefined}
      // w-24 (96px) at caption size for the time column: the widest real
      // value is a range like "14:30–15:00" (11 chars, ~80px at 12px), and
      // components/agenda/agenda-rows.tsx draws the same column the same way
      // so one event never gets two row heights.
      leading={
        <AppText variant="caption" tone="secondary" numberOfLines={1} className="w-24 shrink-0">
          {timeRange}
        </AppText>
      }
      onPress={() => router.push(eventDetailHref(event.id, event.occurs_at) as Href)}
      accessibilityLabel={`${event.title}, ${timeRange}`}
      chevron
      last={last}
    />
  );
}

// Search and Settings, as on every other tab's navigator bar ((tabs)/_layout.tsx
// -- the same reasoning keeps them off the tab bar). `as Href` for the same
// generated-route-types reason SEARCH_ROUTE records there.
const SEARCH_ROUTE = "/search" as Href;

function TodayHeaderActions() {
  return (
    <>
      <Link href={SEARCH_ROUTE} asChild>
        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Search"
          className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
        >
          <Icon name="magnify" size="lg" tone="on-surface" />
        </Pressable>
      </Link>
      <Link href="/settings" asChild>
        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
        >
          <Icon name="cog-outline" size="lg" tone="on-surface" />
        </Pressable>
      </Link>
    </>
  );
}

function EventsSection({ events }: { events: TodayEventItem[] }) {
  const timed = events.filter((e) => !e.all_day).sort((a, b) => eventStartMs(a) - eventStartMs(b));
  const allDay = events.filter((e) => e.all_day);
  return (
    <View>
      <SectionHeader
        title="Today's events"
        count={events.length}
        icon="calendar-blank-outline"
        // The calendar tab's "+" remains the primary entry point for events;
        // this keeps a new event one tap from the screen the owner lands on
        // (Checkpoint 9.5), beside the events it will join. Link-wrapped so
        // the route is a real href on web (__tests__/new-event-screen.test.ts).
        trailing={
          <Link href="/events/new" asChild>
            <Pressable
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="New event"
              className="min-h-[44px] flex-row items-center gap-0.5 active:opacity-70"
            >
              <Icon name="plus" size="sm" tone="primary" />
              <AppText variant="label" tone="primary">
                Event
              </AppText>
            </Pressable>
          </Link>
        }
      />
      <Card padding="none">
        {events.length === 0 ? (
          <EmptyState size="compact" icon="calendar-blank-outline" title="No events today" />
        ) : (
          <>
            {timed.map((event, index) => (
              <LastRowContext.Provider
                key={event.id}
                value={allDay.length === 0 && index === timed.length - 1}
              >
                <EventRow event={event} />
              </LastRowContext.Provider>
            ))}
            {allDay.length > 0 ? (
              <AppText variant="overline" tone="muted" className="px-4 pb-1 pt-3">
                All-day
              </AppText>
            ) : null}
            {allDay.map((event, index) => (
              <LastRowContext.Provider key={event.id} value={index === allDay.length - 1}>
                <EventRow event={event} />
              </LastRowContext.Provider>
            ))}
          </>
        )}
      </Card>
    </View>
  );
}

function UpcomingSection({ data }: { data: TodayResponse }) {
  const router = useRouter();
  const days = data.upcoming.days.filter((day) => day.total > 0);
  // Fully-empty horizon means no section at all -- not an empty-state block.
  if (days.length === 0) return null;
  return (
    <View>
      <SectionHeader title="Upcoming" icon="calendar-arrow-right" />
      <Card padding="none" className="pb-2">
        {days.map((day) => (
          <View key={day.date}>
            <AppText variant="overline" tone="muted" className="px-4 pb-1 pt-3">
              {upcomingDayLabel(day.date, data.local_date)}
            </AppText>
            {/* Checkpoint 10.6 (ADR-076 §4): every upcoming row opens its
                task or event, the way the rows above it already do. */}
            {day.tasks.map((task, index) => (
              <ListRow
                key={`${day.date}-task-${task.id}`}
                title={task.title}
                subtitle={task.project_name ?? undefined}
                icon="checkbox-blank-circle-outline"
                onPress={() => router.push(`/tasks/${task.id}`)}
                accessibilityLabel={`Open task: ${task.title}`}
                chevron
                last={index === day.tasks.length - 1 && day.events.length === 0}
              />
            ))}
            {day.events.map((event, index) => (
              <ListRow
                key={`${day.date}-event-${event.id}`}
                title={event.title}
                subtitle={eventTimeLabel(event, "All day")}
                icon="calendar-blank-outline"
                iconTone="info"
                onPress={() => router.push(eventDetailHref(event.id, event.occurs_at) as Href)}
                accessibilityLabel={`Open event: ${event.title}`}
                chevron
                last={index === day.events.length - 1}
              />
            ))}
          </View>
        ))}
      </Card>
    </View>
  );
}

function InboxSection({ data }: { data: TodayResponse }) {
  const router = useRouter();
  const waiting = data.summary.inbox_attention_total;
  if (waiting === 0) return null;
  return (
    <View>
      <SectionHeader
        title="Inbox needs attention"
        count={waiting}
        tone="warning"
        icon="inbox-arrow-down-outline"
        action={{
          label: "Open inbox",
          onPress: () => router.push(INBOX_ROUTE),
          accessibilityLabel: "Open inbox",
        }}
      />
      <Card
        onPress={() => router.push(INBOX_ROUTE)}
        accessibilityLabel={`Inbox, ${waiting} waiting. Opens the inbox.`}
      >
        <AppText variant="label" tone="secondary" className="pb-1">
          {waiting} waiting
        </AppText>
        {data.inbox.items.slice(0, 5).map((item) => (
          <AppText key={item.id} variant="body" numberOfLines={1} className="py-0.5">
            · {inboxPreviewLabel(item)}
          </AppText>
        ))}
      </Card>
    </View>
  );
}

function ProjectCard({ project }: { project: TodayProjectSummary }) {
  const router = useRouter();
  const { colors } = useTheme();
  const status = PROJECT_STATUS_CHIP[project.status];
  return (
    <Card
      onPress={() => router.push(`/projects/${project.id}`)}
      accessibilityLabel={`${project.name}, ${status.label}${project.stalled ? ", stalled" : ""}`}
      className="mb-3"
    >
      <View className="flex-row items-center gap-2">
        {/* The project's own colour is user-chosen data, so it is the one
            place a raw colour reaches a style; the fallback is the palette's. */}
        <View
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: project.color ?? colors["on-surface-muted"] }}
        />
        <AppText variant="body-strong" numberOfLines={1} className="flex-1">
          {project.name}
        </AppText>
        {project.stalled ? <StatusChip tone="warning" label="Stalled" /> : null}
        <StatusChip tone={status.tone} label={status.label} />
      </View>
      <AppText variant="label" tone="secondary" numberOfLines={1} className="mt-2 font-normal">
        {project.next_action ? `Next: ${project.next_action.title}` : "No next action"}
      </AppText>
      <AppText variant="caption" tone="muted" className="mt-1">
        {project.open_task_count} open · {project.done_task_count} done ·{" "}
        {project.overdue_task_count} overdue
      </AppText>
      {project.target_date ? (
        <AppText variant="caption" tone="muted" className="mt-0.5">
          Target {formatHeaderDate(project.target_date)}
        </AppText>
      ) : null}
    </Card>
  );
}

function ProjectsSection({ data }: { data: TodayResponse }) {
  const router = useRouter();
  const projects = data.projects.items;
  return (
    <View>
      <SectionHeader
        title="Active projects"
        count={data.projects.active_count}
        icon="folder-outline"
        // The stat row that used to carry the Projects navigation is gone
        // (ADR-076 §4); the section header is the way in now.
        action={{
          label: "All projects",
          onPress: () => router.push(PROJECTS_ROUTE),
          accessibilityLabel: "All projects",
        }}
      />
      {projects.length === 0 ? (
        <Card padding="none">
          <EmptyState icon="folder-outline" title="No active projects" />
        </Card>
      ) : (
        projects.map((project) => <ProjectCard key={project.id} project={project} />)
      )}
    </View>
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
      <Card padding="sm" className="flex-row items-center justify-between gap-3 pl-4">
        <AppText variant="body-strong" className="flex-1">
          {title}
        </AppText>
        <Button
          label="Start"
          accessibilityLabel={`Start ${title.toLowerCase()}`}
          onPress={() => router.push(href)}
          variant="tonal"
          size="sm"
        />
      </Card>
    );
  }
  if (info.status === "in_progress") {
    return (
      <Card
        padding="sm"
        onPress={() => router.push(href)}
        accessibilityLabel={resumeTitle}
        className="flex-row items-center gap-3 pl-4"
      >
        <Icon name="progress-check" size="md" tone="primary" />
        <AppText variant="body-strong" tone="primary" className="flex-1">
          {resumeTitle}
        </AppText>
        <Icon name="chevron-right" size="md" tone="primary" />
      </Card>
    );
  }
  return (
    <View className="min-h-[40px] flex-row items-center px-1">
      {info.status === "completed" ? (
        <StatusChip tone="success" icon="check" label={doneTitle} size="md" />
      ) : (
        <StatusChip tone="neutral" label={skippedTitle} size="md" />
      )}
    </View>
  );
}

/**
 * The two review entry points (Checkpoint 10.6, ADR-076 §4): when BOTH are
 * idle they collapse into one card with two rows, since two full-width
 * "Start" banners 8px apart cost a screenful on the Rabbit R1 for the same
 * two taps; once either is in progress or settled, each keeps its own
 * banner so its state reads as before.
 */
function ReviewsBlock({ reviews }: { reviews: TodayResponse["reviews"] }) {
  const router = useRouter();
  if (reviews.daily.status === null && reviews.weekly.status === null) {
    return (
      <Card padding="none" className="mt-3">
        <ListRow
          title="Daily review"
          icon="calendar-check-outline"
          iconTone="primary"
          onPress={() => router.push("/reviews/daily")}
          accessibilityLabel="Start daily review"
          chevron
          inset
        />
        <ListRow
          title="Weekly review"
          icon="calendar-week"
          iconTone="primary"
          onPress={() => router.push("/reviews/weekly")}
          accessibilityLabel="Start weekly review"
          chevron
          inset
          last
        />
      </Card>
    );
  }
  return (
    <View className="mt-3 gap-2">
      <ReviewBanner
        title="Daily review"
        resumeTitle="Resume daily review"
        doneTitle="Daily review completed"
        skippedTitle="Daily review skipped"
        href="/reviews/daily"
        info={reviews.daily}
      />
      <ReviewBanner
        title="Weekly review"
        resumeTitle="Resume weekly review"
        doneTitle="Weekly review completed"
        skippedTitle="Weekly review skipped"
        href="/reviews/weekly"
        info={reviews.weekly}
      />
    </View>
  );
}

export default function TodayScreen() {
  const router = useRouter();
  const { data, dataUpdatedAt, isLoading, isError, isRefetching, refetch } = useToday();
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
      <ScreenFrame>
        <SkeletonScreen />
      </ScreenFrame>
    );
  }

  if (isError || !data) {
    return (
      <ScreenCentered>
        <ErrorState
          size="screen"
          message="Couldn't load today."
          onRetry={() => void refetch()}
          retryLabel="Retry"
          retryAccessibilityLabel="Retry loading today"
        />
      </ScreenCentered>
    );
  }

  // The greeting's hour comes from the instant Today was FETCHED
  // (`dataUpdatedAt`), never from a clock read in render (react-hooks/purity);
  // it moves forward on every refetch, including pull-to-refresh.
  const greeting = greetingForHour(hourFromInstant(dataUpdatedAt));

  // ADR-076 §4 -- the order, actionable-first: header → briefing → reminder
  // notice → Focus Now (→ Suggested Focus) → Overdue → Due today → Events →
  // Brief → Health → Mail → Academics → reviews → Upcoming → Inbox → Projects.
  return (
    <Screen safeTop refreshing={isRefetching} onRefresh={() => void refetch()}>
      <ScreenHeader
        eyebrow={formatHeaderDate(data.local_date)}
        title={greeting}
        subtitle={importantThingsLine(data.summary)}
        // Today hides the navigator bar (see (tabs)/_layout.tsx) so the
        // greeting IS the title; Search and Settings therefore live here,
        // gated exactly as the tab bar's HeaderActions are.
        actions={UI_TEST_MODE ? undefined : <TodayHeaderActions />}
      />

      {/* The ONE gradient on Today: the deterministic daily briefing
          (Checkpoint 10.6, ADR-075 §4) -- the same overdue / due-today /
          events counts the old hero drew, now as a headline over the four
          sections core composes from this screen's own responses. */}
      <BriefingCard>
        {/* Checkpoint 9.7 ("Ask about today"). Rendered ONLY while the "ask"
            task route exists -- the same switch that hides the Ask mode on
            the search screen -- so an owner who never opted in never sees
            it. The route param only pre-selects the "focus" chip and
            pre-fills its question; nothing is sent until they tap Ask. The
            pill is composed here: no primitive exists for a pressable on a
            gradient (white-alpha is scheme-invariant, like ProgressBar's
            `onGradient` track). It stays inside the one hero block, which
            is now the briefing (ADR-076 §4). */}
        {askEnabled ? (
          <Pressable
            testID="today-ask-chip"
            onPress={() => router.push(ASK_ABOUT_TODAY_HREF)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Ask about today"
            className="mt-4 min-h-[44px] flex-row items-center gap-1.5 self-start rounded-full border border-white/30 bg-white/20 px-4 py-2 active:opacity-80"
          >
            <AppText variant="label" tone="on-gradient">
              Ask about today
            </AppText>
            <AppText variant="label" tone="on-gradient-muted">
              ›
            </AppText>
          </Pressable>
        ) : null}
      </BriefingCard>

      <View className="mt-3">
        {/* Checkpoint 8.4 Lane 6. Renders NOTHING unless reminders genuinely
            cannot fire on this device. Informational only -- it never promotes
            a device or flips a setting (ADR-019/036); it names the reason and
            points at the screen that can fix it. Placed first because "your
            reminders are not running" outranks anything below it. */}
        <ReminderNoticeCard />

        {/* Checkpoint 10.4 (ADR-072; explanations and quick actions 10.6,
            ADR-075): the one merged, ranked "what should I focus on right
            now" card, over Today's own overdue/due-today tasks and the
            Academics card's own ranked "Do next" candidates. Owns its own
            two queries (already fetched for this screen) and derives nothing
            server-side -- see components/today/focus-now-card.tsx. */}
        <FocusNowCard />
      </View>

      {/* Checkpoint 9.8. Gated on the same switch as the Ask chip, right
          after Focus Now (ADR-076 §4). SuggestedFocusCard enforces
          FOCUS_MIN_CANDIDATES itself too, so this is belt-and-braces,
          matching the existing `askEnabled ? (...) : null` idiom rather than
          duplicating the threshold check here. */}
      {askEnabled ? (
        <SuggestedFocusCard
          candidateCount={focusCandidateCount(data.summary)}
          state={focusState}
          onSuggest={requestFocusSuggestion}
          onSelectSource={(source) => router.push(askSourceHref(source))}
        />
      ) : null}

      <TaskSection
        title="Overdue"
        tone="danger"
        icon="alert-circle-outline"
        section={data.overdue}
        emptyTitle="Nothing overdue"
        emptyTone="success"
      />

      <TaskSection
        title="Due today"
        tone="info"
        icon="calendar-today"
        section={data.due_today}
        emptyTitle="Nothing due today"
        emptyTone="neutral"
        action={{
          label: "All tasks",
          onPress: () => router.push("/tasks"),
          accessibilityLabel: "All tasks",
        }}
      />

      <EventsSection events={data.events_today.items} />

      <View className="mt-6">
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

        {/* Checkpoint 10.2 (ADR-070), succeeding 10.1's Canvas card in the same
            slot -- like the two cards above, it owns its own GET /academic/today
            query, so a Canvas outage or a not-yet-connected institution can
            never make Today fail to load. It renders nothing at all when there
            is no active connection or nothing to show, the same posture
            HealthTodayCard documents, and derives nothing: the overdue /
            due-today / due-this-week buckets and the ranked priorities are the
            server's own. */}
        <AcademicTodayCard />
      </View>

      <ReviewsBlock reviews={data.reviews} />

      <UpcomingSection data={data} />
      <InboxSection data={data} />
      <ProjectsSection data={data} />
    </Screen>
  );
}
