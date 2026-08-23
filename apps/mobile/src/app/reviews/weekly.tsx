import type {
  Review,
  ReviewContextProject,
  ReviewRecentlyCompletedItem,
  WeeklyReviewChecklist,
  WeeklyReviewContent,
  WeeklyReviewContext,
} from "@personal-os/schema";
import { REVIEW_CONTENT_VERSION } from "@personal-os/schema";
import { Link, useRouter, type Href } from "expo-router";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import {
  isCurrentPeriod,
  savedChecklist,
} from "@/components/reviews/review-content";
import {
  ReviewStepList,
  activeStepIndex,
  deriveSteps,
  type ReviewStepView,
} from "@/components/reviews/review-step-list";
import { formatHeaderDate, parseLocalDate } from "@/utils/local-date";
import {
  useCompleteReview,
  useLatestReview,
  useSaveReview,
  useSkipReview,
  useStartReview,
  useWeeklyReviewContext,
} from "@/queries/reviews";

// ---- Formatting helpers (formatHeaderDate/parseLocalDate now live in
// @/utils/local-date, shared with daily.tsx and the tab screens) ----

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatShortTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// upcoming_7d.days[i] is i+1 local days ahead of today by construction, so
// array index 0 is always Tomorrow; later entries render their weekday name.
function upcomingDayLabel(index: number, date: string): string {
  if (index === 0) return "Tomorrow";
  return parseLocalDate(date).toLocaleDateString(undefined, { weekday: "long" });
}

// raw_text when present; otherwise an honest per-status label.
function inboxPreviewLabel(item: WeeklyReviewContext["inbox_attention"]["items"][number]): string {
  if (item.raw_text) return item.raw_text;
  if (item.status === "needs_confirm") return "Needs confirmation";
  if (item.status === "failed") return "Parse failed";
  return "Pending capture";
}

// ---- Content v1 contract helpers ----

// Every toggle PATCHes whole content v1 (no server-side merge), so each
// payload always carries every current flag. selected_priorities stays []
// -- the weekly flow records progress via checklist flags only.
function weeklyContent(checklist: WeeklyReviewChecklist): WeeklyReviewContent {
  return {
    version: REVIEW_CONTENT_VERSION,
    kind: "weekly",
    checklist,
    selected_priorities: [],
  };
}


function toggledChecklist(
  checklist: WeeklyReviewChecklist,
  key: keyof WeeklyReviewChecklist,
): WeeklyReviewChecklist {
  const next: WeeklyReviewChecklist = { ...checklist };
  next[key] = checklist[key] !== true;
  return next;
}

// ---- Small shared pieces ----

function EmptyText({ children }: { children: ReactNode }) {
  return (
    <Text className="py-1 text-sm text-neutral-500 dark:text-neutral-400">{children}</Text>
  );
}

function MoreNote({ hidden }: { hidden: number }) {
  return (
    <Text className="py-0.5 text-xs text-neutral-500 dark:text-neutral-400">+{hidden} more</Text>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text className="pb-1 pt-2 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
      {children}
    </Text>
  );
}

// Read-only task row linking to its detail route. The id is always the task's
// own id -- occurrence representations keep their parent's id.
function TaskRow({ id, title, dueAt }: { id: string; title: string; dueAt: string | null }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/tasks/${id}`)}
      className="min-h-[40px] flex-row items-center justify-between py-1"
    >
      <Text className="flex-1 text-sm text-black dark:text-white" numberOfLines={1}>
        · {title}
      </Text>
      {dueAt ? (
        <Text className="ml-2 shrink-0 text-xs text-red-600 dark:text-red-400">
          {formatShortTimestamp(dueAt)}
        </Text>
      ) : null}
    </Pressable>
  );
}

const PROJECT_STATUS_CHIP: Record<ReviewContextProject["status"], string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  paused: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
};

function ProjectCard({ project }: { project: ReviewContextProject }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/projects/${project.id}`)}
      className="mb-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
    >
      <View className="flex-row items-center gap-2">
        <View
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: project.color ?? "#999999" }}
        />
        <Text
          className="flex-1 text-sm font-medium text-black dark:text-white"
          numberOfLines={1}
        >
          {project.name}
        </Text>
        {project.stalled ? (
          <View className="rounded bg-amber-100 px-2 py-0.5 dark:bg-amber-900">
            <Text className="text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">
              Stalled
            </Text>
          </View>
        ) : null}
        <View className={`rounded px-2 py-0.5 ${PROJECT_STATUS_CHIP[project.status]}`}>
          <Text className="text-[10px] uppercase">{project.status}</Text>
        </View>
      </View>
      <Text
        className={
          project.next_action
            ? "mt-1.5 text-sm text-neutral-700 dark:text-neutral-300"
            : "mt-1.5 text-sm font-semibold text-amber-700 dark:text-amber-400"
        }
        numberOfLines={1}
      >
        {project.next_action ? `Next: ${project.next_action.title}` : "No next action"}
      </Text>
      {project.target_date ? (
        <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Target {formatHeaderDate(project.target_date)}
        </Text>
      ) : null}
    </Pressable>
  );
}

function MissingNextActionRow({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/projects/${id}`)}
      className="min-h-[40px] flex-row items-center justify-between py-1"
    >
      <Text className="flex-1 text-sm text-black dark:text-white" numberOfLines={1}>
        · {name}
      </Text>
      <Text className="ml-2 shrink-0 text-xs font-semibold uppercase text-amber-700 dark:text-amber-400">
        No next action
      </Text>
    </Pressable>
  );
}

function AgendaRow({
  href,
  title,
  time,
}: {
  href: Href;
  title: string;
  time: string | null;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(href)}
      className="min-h-[40px] flex-row items-baseline gap-2 py-1"
    >
      <Text className="w-11 shrink-0 text-right text-xs text-neutral-500 dark:text-neutral-400">
        {time ?? ""}
      </Text>
      <Text className="flex-1 text-sm text-black dark:text-white" numberOfLines={1}>
        · {title}
      </Text>
    </Pressable>
  );
}

function CompletedRow({ item }: { item: ReviewRecentlyCompletedItem }) {
  return (
    <View className="min-h-[40px] justify-center py-1">
      <Text className="text-sm text-black dark:text-white" numberOfLines={1}>
        {item.kind === "occurrence" ? `⟲ ${item.title}` : item.title}
      </Text>
      <Text className="text-xs text-neutral-500 dark:text-neutral-400">
        {formatShortTimestamp(item.completed_at)}
      </Text>
    </View>
  );
}

// ---- Step bodies (weekly context sections) ----

type InboxSection = WeeklyReviewContext["inbox_attention"];

function InboxBody({ inbox }: { inbox: InboxSection }) {
  return (
    <View>
      <EmptyText>
        {inbox.pending_count} pending · {inbox.needs_confirm_count} need confirmation ·{" "}
        {inbox.failed_count} failed
      </EmptyText>
      {inbox.items.map((item) => (
        <Text
          key={item.id}
          className="py-0.5 text-sm text-neutral-700 dark:text-neutral-300"
          numberOfLines={1}
        >
          · {inboxPreviewLabel(item)}
        </Text>
      ))}
      <Link href="/(tabs)/inbox" asChild>
        <Pressable className="mt-1 min-h-[40px] flex-row items-center">
          <Text className="text-sm font-medium text-blue-600 dark:text-blue-400">
            Open inbox →
          </Text>
        </Pressable>
      </Link>
    </View>
  );
}

type BoundedTasksSection = WeeklyReviewContext["overdue"];

function OverdueBody({ overdue }: { overdue: BoundedTasksSection }) {
  if (overdue.items.length === 0) return <EmptyText>Nothing overdue.</EmptyText>;
  return (
    <View>
      {overdue.items.map((item) => (
        <TaskRow
          key={item.occurrence_id ?? item.id}
          id={item.id}
          title={item.title}
          dueAt={item.due_at}
        />
      ))}
      {overdue.total > overdue.items.length ? (
        <MoreNote hidden={overdue.total - overdue.items.length} />
      ) : null}
    </View>
  );
}

function ProjectsBody({
  projects,
  emptyLabel,
}: {
  projects: WeeklyReviewContext["active_projects"];
  emptyLabel: string;
}) {
  if (projects.items.length === 0) return <EmptyText>{emptyLabel}</EmptyText>;
  return (
    <View>
      {projects.items.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
      {projects.total > projects.items.length ? (
        <MoreNote hidden={projects.total - projects.items.length} />
      ) : null}
    </View>
  );
}

function MissingNextActionsBody({
  section,
}: {
  section: WeeklyReviewContext["projects_without_next_action"];
}) {
  if (section.items.length === 0) {
    return <EmptyText>Every project has a next action.</EmptyText>;
  }
  return (
    <View>
      {section.items.map((project) => (
        <MissingNextActionRow key={project.id} id={project.id} name={project.name} />
      ))}
      {section.total > section.items.length ? (
        <MoreNote hidden={section.total - section.items.length} />
      ) : null}
    </View>
  );
}

function UpcomingWeekBody({ days }: { days: WeeklyReviewContext["upcoming_7d"]["days"] }) {
  // Labels are computed against the original array index BEFORE empty days
  // are dropped, so "Tomorrow" only ever labels index 0.
  const visible = days
    .map((day, index) => ({ day, label: upcomingDayLabel(index, day.date) }))
    .filter(({ day }) => day.total > 0);
  if (visible.length === 0) {
    return <EmptyText>Nothing scheduled for the next 7 days.</EmptyText>;
  }
  return (
    <View>
      {visible.map(({ day, label }) => {
        const rendered = day.tasks.length + day.events.length;
        return (
          <View key={day.date}>
            <SectionTitle>{label}</SectionTitle>
            {day.tasks.map((task) => (
              <AgendaRow
                key={task.occurrence_id ?? task.id}
                href={`/tasks/${task.id}`}
                title={task.title}
                time={task.due_at ? formatTime(task.due_at) : null}
              />
            ))}
            {day.events.map((event) => (
              <AgendaRow
                key={`${event.id}-${event.occurs_at ?? event.starts_at ?? event.id}`}
                href={`/events/${event.id}`}
                title={event.title}
                time={event.all_day ? null : formatTime(event.occurs_at ?? event.starts_at ?? "")}
              />
            ))}
            {day.total > rendered ? <MoreNote hidden={day.total - rendered} /> : null}
          </View>
        );
      })}
    </View>
  );
}

function RecentlyCompletedBody({
  section,
}: {
  section: WeeklyReviewContext["recently_completed"];
}) {
  if (section.items.length === 0) return <EmptyText>Nothing completed yet this week.</EmptyText>;
  return (
    <View>
      {section.items.map((item) => (
        <CompletedRow
          key={item.kind === "occurrence" ? item.occurrence_id : item.id}
          item={item}
        />
      ))}
      {section.total > section.items.length ? (
        <MoreNote hidden={section.total - section.items.length} />
      ) : null}
    </View>
  );
}

// ---- Engine pieces: gate / flow / terminal ----

function StepSection({
  step,
  onToggle,
  children,
}: {
  step: ReviewStepView;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <View className="mt-3">
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: step.done }}
        onPress={onToggle}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        className="min-h-[44px] flex-row items-center justify-between px-4"
      >
        <Text
          className={`flex-1 pr-2 text-base font-semibold ${
            step.done
              ? "text-neutral-500 line-through dark:text-neutral-400"
              : "text-black dark:text-white"
          }`}
        >
          {step.title}
        </Text>
        <View
          className={
            step.done
              ? "rounded-full bg-green-100 px-3 py-1 dark:bg-green-950"
              : "rounded-full border border-neutral-300 px-3 py-1 dark:border-neutral-700"
          }
        >
          <Text
            className={`text-xs font-semibold ${
              step.done
                ? "text-green-700 dark:text-green-300"
                : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            {step.done ? "Done ✓" : "Mark done"}
          </Text>
        </View>
      </Pressable>
      <View className="px-4">{children}</View>
    </View>
  );
}

function WeeklyFlow({ review, context }: { review: Review; context: WeeklyReviewContext }) {
  const [checklist, setChecklist] = useState<WeeklyReviewChecklist>(() => savedChecklist(review));
  const [summaryText, setSummaryText] = useState(() => review.summary ?? "");
  // Two SEPARATE mutation instances, deliberately. TanStack Query resets a
  // mutation's error state on each new call, so a single shared instance would
  // let an unrelated later save clear an earlier failure's flag: fail a
  // checklist toggle (never persisted), then blur the summary field and have
  // that summary PATCH succeed, and the "Saving failed" banner silently
  // disappears while the toggle is still unsaved -- on next mount it reverts
  // from server truth. That is the exact silent-revert failure this design
  // exists to prevent, so content and summary track their errors independently.
  const saveContent = useSaveReview();
  const saveSummary = useSaveReview();
  const complete = useCompleteReview();
  const skip = useSkipReview();

  const steps = deriveSteps(context, "weekly", checklist);
  const activeIndex = activeStepIndex(steps);

  // Incremental-save engine.
  //
  // Saves are SERIALIZED through a promise chain, and each request body is
  // built at SEND time from the latest state. Both properties are load-bearing,
  // because the PATCH body is the WHOLE content object: with concurrent
  // requests a slower earlier one can land after a newer one and overwrite it
  // with a stale snapshot -- silently, even when both "succeed" -- so a
  // priority selection could be reverted server-side with nothing shown to the
  // user. Serialized + built-at-send-time means the request in flight always
  // carries the newest complete intent, and the last to land is the newest.
  //
  // Deliberately NOT a per-toggle rollback-on-error. That was implemented first
  // and is unsound here: with two rapid toggles of the same key that both fail,
  // the guarded revert can settle on a value that was never persisted, leaving
  // the screen disagreeing with the server and unable to self-heal (this
  // component is keyed by review.id, so nothing re-seeds local state). Keeping
  // the user's intent on screen and surfacing an explicit Retry is simpler and
  // more honest -- a review checkbox that silently unchecks itself is a worse
  // failure than one that says it has not saved yet.
  const latest = useRef({ checklist });
  latest.current = { checklist };
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  const toggleStep = (key: keyof WeeklyReviewChecklist) => {
    const next = toggledChecklist(checklist, key);
    setChecklist(next);
    latest.current = { checklist: next };
    saveChain.current = saveChain.current
      .then(() =>
        saveContent.mutateAsync({
          id: review.id,
          patch: { content: weeklyContent(latest.current.checklist) },
        }),
      )
      // Swallowed here only so one failure cannot break the chain for every
      // later save; the failure itself is surfaced through saveContent.isError.
      .catch(() => undefined);
  };

  const commitSummary = () => {
    const next = summaryText.trim().length > 0 ? summaryText.trim() : null;
    if (next === review.summary) return;
    saveChain.current = saveChain.current
      .then(() => saveSummary.mutateAsync({ id: review.id, patch: { summary: next } }))
      .catch(() => undefined);
  };

  const renderBody = (key: string) => {
    switch (key) {
      case "inbox":
        return <InboxBody inbox={context.inbox_attention} />;
      case "overdue":
        return <OverdueBody overdue={context.overdue} />;
      case "active_projects":
        return (
          <ProjectsBody projects={context.active_projects} emptyLabel="No active projects." />
        );
      case "paused_projects":
        return (
          <ProjectsBody projects={context.paused_projects} emptyLabel="No paused projects." />
        );
      case "stalled_projects":
        return (
          <ProjectsBody projects={context.stalled_projects} emptyLabel="No stalled projects." />
        );
      case "missing_next_actions":
        return <MissingNextActionsBody section={context.projects_without_next_action} />;
      case "upcoming_week":
        return <UpcomingWeekBody days={context.upcoming_7d.days} />;
      case "recently_completed":
        return <RecentlyCompletedBody section={context.recently_completed} />;
      default:
        return null;
    }
  };

  return (
    <View>
      {/* Progress overview; taps live on the per-step headers below */}
      <View className="mx-4 mt-3 rounded-xl border border-neutral-200 p-2 dark:border-neutral-800">
        <ReviewStepList steps={steps} activeIndex={activeIndex} compact />
      </View>

      {steps.map((step) =>
        step.key === "summary" ? (
          <StepSection
            key={step.key}
            step={step}
            onToggle={() => toggleStep("summary")}
          >
            <TextInput
              value={summaryText}
              onChangeText={setSummaryText}
              onBlur={commitSummary}
              multiline
              placeholder="How did the week go?"
              placeholderTextColor="#888"
              className="min-h-[96px] rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
            />
          </StepSection>
        ) : (
          <StepSection
            key={step.key}
            step={step}
            onToggle={() => toggleStep(step.key as keyof WeeklyReviewChecklist)}
          >
            {renderBody(step.key)}
          </StepSection>
        ),
      )}

      <View className="mt-6 gap-3 px-4 pb-8">
        {saveContent.isError || saveSummary.isError || complete.isError || skip.isError ? (
          <Text className="text-sm text-red-600 dark:text-red-400">
            Saving failed — check your connection and try again.
          </Text>
        ) : null}
        {saveContent.isPending || saveSummary.isPending ? (
          <Text className="text-xs text-neutral-500 dark:text-neutral-400">Saving…</Text>
        ) : null}
        <Pressable
          onPress={() => complete.mutate({ id: review.id })}
          disabled={complete.isPending || skip.isPending}
          className="min-h-[44px] items-center justify-center rounded-lg bg-green-600 active:bg-green-700 disabled:opacity-50"
        >
          <Text className="font-semibold text-white">Complete review</Text>
        </Pressable>
        <Pressable
          onPress={() => skip.mutate({ id: review.id })}
          disabled={complete.isPending || skip.isPending}
          className="min-h-[44px] items-center justify-center rounded-lg border border-neutral-300 active:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:active:bg-neutral-900"
        >
          <Text className="font-medium text-black dark:text-white">Skip this week</Text>
        </Pressable>
      </View>
    </View>
  );
}

function WeeklyTerminal({ review, context }: { review: Review; context: WeeklyReviewContext }) {
  const completed = review.status === "completed";
  const steps = deriveSteps(context, "weekly", savedChecklist(review));
  const settledAt = review.completed_at ?? review.updated_at;
  return (
    <View className="pb-8">
      <View
        className={`mx-4 mt-4 rounded-xl border p-3 ${
          completed
            ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
            : "border-neutral-300 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900"
        }`}
      >
        <Text
          className={`text-base font-semibold ${
            completed ? "text-green-700 dark:text-green-300" : "text-neutral-700 dark:text-neutral-300"
          }`}
        >
          {completed ? "Completed" : "Skipped"}
        </Text>
        <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          {completed ? "Completed at" : "Skipped at"} {formatShortTimestamp(settledAt)}
        </Text>
      </View>
      <View className="mx-4 mt-3 rounded-xl border border-neutral-200 p-2 dark:border-neutral-800">
        <ReviewStepList steps={steps} activeIndex={null} compact />
      </View>
      {review.summary ? (
        <View className="px-4 pt-3">
          <SectionTitle>Summary</SectionTitle>
          <Text className="text-sm text-black dark:text-white">{review.summary}</Text>
        </View>
      ) : null}
      <Text className="px-4 pt-4 text-xs text-neutral-500 dark:text-neutral-400">
        This review is closed and read-only.
      </Text>
    </View>
  );
}

function StartGate({
  periodStart,
  starting,
  failed,
  onStart,
}: {
  periodStart: string;
  starting: boolean;
  failed: boolean;
  onStart: () => void;
}) {
  return (
    <View className="px-4 pt-6 pb-8">
      <Text className="text-base text-black dark:text-white">
        Week of {formatHeaderDate(periodStart)}
      </Text>
      <Text className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        Close out the week: clear the inbox and overdue work, check every project has a next
        action, and look at what is coming. Your progress saves as you go.
      </Text>
      {failed ? (
        <Text className="mt-3 text-sm text-red-600 dark:text-red-400">
          Couldn&apos;t start the review — try again.
        </Text>
      ) : null}
      <Pressable
        onPress={onStart}
        disabled={starting}
        className="mt-4 min-h-[44px] items-center justify-center rounded-lg bg-blue-600 active:bg-blue-700 disabled:opacity-50"
      >
        <Text className="font-semibold text-white">
          {starting ? "Starting…" : "Start weekly review"}
        </Text>
      </Pressable>
    </View>
  );
}

export default function WeeklyReviewScreen() {
  const keyboardHeight = useKeyboardHeight();
  const context = useWeeklyReviewContext();
  const latest = useLatestReview("weekly");
  const start = useStartReview();

  if (context.isLoading || latest.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Text className="text-neutral-500 dark:text-neutral-400">Loading…</Text>
      </View>
    );
  }

  if (context.isError || latest.isError || !context.data) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white dark:bg-black">
        <Text className="text-red-600 dark:text-red-400">Couldn&apos;t load the review.</Text>
        <Pressable
          onPress={() => {
            void context.refetch();
            void latest.refetch();
          }}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 active:bg-blue-700"
        >
          <Text className="font-semibold text-white">Retry</Text>
        </Pressable>
      </View>
    );
  }

  const data = context.data;
  const review = latest.data ?? null;

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      // Extra room so lower controls can be scrolled clear of the IME --
      // see components/use-keyboard-height.ts for why insets alone don't do it.
      contentContainerStyle={{ paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight }}
      keyboardShouldPersistTaps="handled"
    >
      {review &&
      review.status === "in_progress" &&
      isCurrentPeriod(review, data.period_start) ? (
        // Keyed so resuming a different review re-initializes local state.
        <WeeklyFlow key={review.id} review={review} context={data} />
      ) : review &&
        (review.status === "completed" || review.status === "skipped") &&
        review.period_start === data.period_start ? (
        // Terminal reviews of the CURRENT period render read-only with no
        // reopen; older terminal reviews fall through to the start gate.
        <WeeklyTerminal key={review.id} review={review} context={data} />
      ) : (
        <StartGate
          periodStart={data.period_start}
          starting={start.isPending}
          failed={start.isError}
          onStart={() => start.mutate("weekly")}
        />
      )}
    </ScrollView>
  );
}
