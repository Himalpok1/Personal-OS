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
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { textFieldClass } from "@/components/ask/text-field";
import {
  PROJECT_STALLED_PRESENTATION,
  projectStatusPresentation,
} from "@/components/projects/status-presentation";
import {
  AppText,
  Button,
  Card,
  ErrorState,
  Icon,
  ScreenCentered,
  ScreenFrame,
  SectionHeader,
  SkeletonCard,
  StatusChip,
  useTheme,
} from "@/components/ui";
import { usePlaceholderColor } from "@/components/placeholder-color";
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
    <AppText variant="label" tone="secondary" className="py-1 font-normal">
      {children}
    </AppText>
  );
}

function MoreNote({ hidden }: { hidden: number }) {
  return (
    <AppText variant="caption" tone="muted" className="py-0.5">
      +{hidden} more
    </AppText>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <SectionHeader title={children} spacing="none" className="pb-1 pt-2" />;
}

// Read-only task row linking to its detail route. The id is always the task's
// own id -- occurrence representations keep their parent's id.
function TaskRow({ id, title, dueAt }: { id: string; title: string; dueAt: string | null }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/tasks/${id}`)}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`Open task: ${title}`}
      className="min-h-[40px] flex-row items-center justify-between py-1 active:opacity-70"
    >
      <AppText variant="label" className="flex-1 font-normal" numberOfLines={1}>
        · {title}
      </AppText>
      {dueAt ? (
        <AppText variant="caption" tone="danger" className="ml-2 shrink-0">
          {formatShortTimestamp(dueAt)}
        </AppText>
      ) : null}
    </Pressable>
  );
}

function ProjectCard({ project }: { project: ReviewContextProject }) {
  const router = useRouter();
  const { colors } = useTheme();
  const status = projectStatusPresentation(project.status);
  return (
    <Card
      padding="sm"
      elevation="flat"
      onPress={() => router.push(`/projects/${project.id}`)}
      accessibilityLabel={`Open project: ${project.name}`}
      className="mb-2"
    >
      <View className="flex-row items-center gap-2">
        <View
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: project.color ?? colors["on-surface-muted"] }}
        />
        <AppText variant="body-strong" className="flex-1" numberOfLines={1}>
          {project.name}
        </AppText>
        {project.stalled ? (
          <StatusChip
            label={PROJECT_STALLED_PRESENTATION.label}
            tone={PROJECT_STALLED_PRESENTATION.tone}
          />
        ) : null}
        <StatusChip label={status.label} tone={status.tone} />
      </View>
      <AppText
        variant="label"
        tone={project.next_action ? "secondary" : "warning"}
        className={`mt-1.5 ${project.next_action ? "font-normal" : "font-semibold"}`}
        numberOfLines={1}
      >
        {project.next_action ? `Next: ${project.next_action.title}` : "No next action"}
      </AppText>
      {project.target_date ? (
        <AppText variant="caption" tone="muted" className="mt-1">
          Target {formatHeaderDate(project.target_date)}
        </AppText>
      ) : null}
    </Card>
  );
}

function MissingNextActionRow({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/projects/${id}`)}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`Open project: ${name}`}
      className="min-h-[40px] flex-row items-center justify-between py-1 active:opacity-70"
    >
      <AppText variant="label" className="flex-1 font-normal" numberOfLines={1}>
        · {name}
      </AppText>
      <StatusChip label="No next action" tone="warning" className="ml-2 shrink-0" />
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
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`Open: ${title}`}
      className="min-h-[40px] flex-row items-baseline gap-2 py-1 active:opacity-70"
    >
      <AppText variant="caption" tone="muted" className="w-11 shrink-0 text-right">
        {time ?? ""}
      </AppText>
      <AppText variant="label" className="flex-1 font-normal" numberOfLines={1}>
        · {title}
      </AppText>
    </Pressable>
  );
}

function CompletedRow({ item }: { item: ReviewRecentlyCompletedItem }) {
  return (
    <View className="min-h-[40px] flex-row items-center gap-2 py-1">
      <Icon
        name={item.kind === "occurrence" ? "repeat" : "check-circle-outline"}
        size="sm"
        tone="success"
      />
      <View className="flex-1">
        <AppText variant="label" className="font-normal" numberOfLines={1}>
          {item.title}
        </AppText>
        <AppText variant="caption" tone="muted">
          {formatShortTimestamp(item.completed_at)}
        </AppText>
      </View>
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
        <AppText
          key={item.id}
          variant="label"
          tone="secondary"
          className="py-0.5 font-normal"
          numberOfLines={1}
        >
          · {inboxPreviewLabel(item)}
        </AppText>
      ))}
      <Link href="/(tabs)/inbox" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open inbox"
          className="mt-1 min-h-[44px] flex-row items-center gap-1 active:opacity-70"
        >
          <AppText variant="label" tone="primary">
            Open inbox
          </AppText>
          <Icon name="chevron-right" size="sm" tone="primary" />
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
    <Card padding="none" className="mx-4 mt-3">
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: step.done }}
        accessibilityLabel={`${step.title}: ${step.done ? "done" : "mark done"}`}
        onPress={onToggle}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        className="min-h-[52px] flex-row items-center justify-between gap-2 px-4 pt-3 active:opacity-70"
      >
        <AppText
          variant="title"
          tone={step.done ? "muted" : "default"}
          className={`flex-1 ${step.done ? "line-through" : ""}`}
        >
          {step.title}
        </AppText>
        <StatusChip
          label={step.done ? "Done" : "Mark done"}
          tone={step.done ? "success" : "neutral"}
          icon={step.done ? "check" : undefined}
          size="md"
        />
      </Pressable>
      <View className="px-4 pb-3">{children}</View>
    </Card>
  );
}

function WeeklyFlow({ review, context }: { review: Review; context: WeeklyReviewContext }) {
  const placeholderColor = usePlaceholderColor();
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
      <Card padding="sm" className="mx-4 mt-3">
        <ReviewStepList steps={steps} activeIndex={activeIndex} compact />
      </Card>

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
              placeholderTextColor={placeholderColor}
              textAlignVertical="top"
              accessibilityLabel="Summary"
              className={textFieldClass({ multiline: true, extra: "min-h-[96px]" })}
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
          <AppText variant="body" tone="danger" accessibilityRole="alert">
            Saving failed — check your connection and try again.
          </AppText>
        ) : null}
        {saveContent.isPending || saveSummary.isPending ? (
          <AppText variant="caption" tone="muted">
            Saving…
          </AppText>
        ) : null}
        <Button
          label="Complete review"
          onPress={() => complete.mutate({ id: review.id })}
          disabled={complete.isPending || skip.isPending}
          variant="primary"
          icon="check"
          block
        />
        <Button
          label="Skip this week"
          onPress={() => skip.mutate({ id: review.id })}
          disabled={complete.isPending || skip.isPending}
          variant="outline"
          block
        />
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
      <Card padding="sm" className="mx-4 mt-4 flex-row items-center gap-3">
        <Icon
          name={completed ? "check-circle-outline" : "skip-next-circle-outline"}
          size="lg"
          tone={completed ? "success" : "on-surface-variant"}
        />
        <View className="flex-1">
          <AppText variant="title" tone={completed ? "success" : "secondary"}>
            {completed ? "Completed" : "Skipped"}
          </AppText>
          <AppText variant="caption" tone="muted" className="mt-0.5">
            {completed ? "Completed at" : "Skipped at"} {formatShortTimestamp(settledAt)}
          </AppText>
        </View>
      </Card>
      <Card padding="sm" className="mx-4 mt-3">
        <ReviewStepList steps={steps} activeIndex={null} compact />
      </Card>
      {review.summary ? (
        <View className="px-4 pt-3">
          <SectionTitle>Summary</SectionTitle>
          <AppText variant="body">{review.summary}</AppText>
        </View>
      ) : null}
      <AppText variant="caption" tone="muted" className="px-4 pt-4">
        This review is closed and read-only.
      </AppText>
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
    <View className="px-4 pb-8 pt-6">
      <Card>
        <AppText variant="overline" tone="muted">
          Weekly review
        </AppText>
        <AppText variant="headline" className="mt-1">
          Week of {formatHeaderDate(periodStart)}
        </AppText>
        <AppText variant="body" tone="secondary" className="mt-2">
          Close out the week: clear the inbox and overdue work, check every project has a next
          action, and look at what is coming. Your progress saves as you go.
        </AppText>
        {failed ? (
          <AppText variant="body" tone="danger" className="mt-3" accessibilityRole="alert">
            Couldn&apos;t start the review — try again.
          </AppText>
        ) : null}
        <Button
          label={starting ? "Starting…" : "Start weekly review"}
          onPress={onStart}
          disabled={starting}
          variant="primary"
          icon="play-outline"
          block
          className="mt-4"
        />
      </Card>
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
      <ScreenFrame>
        <View className="px-4 pt-4">
          <SkeletonCard lines={4} />
        </View>
      </ScreenFrame>
    );
  }

  if (context.isError || latest.isError || !context.data) {
    return (
      <ScreenCentered>
        <ErrorState
          message="Couldn't load the review."
          onRetry={() => {
            void context.refetch();
            void latest.refetch();
          }}
          retryAccessibilityLabel="Retry loading the review"
        />
      </ScreenCentered>
    );
  }

  const data = context.data;
  const review = latest.data ?? null;

  return (
    <ScreenFrame>
      <ScrollView
        className="flex-1"
        // Extra room so lower controls can be scrolled clear of the IME --
        // see components/use-keyboard-height.ts for why insets alone don't do it.
        contentContainerStyle={{ paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight }}
        keyboardShouldPersistTaps="handled"
      >
        {review && review.status === "in_progress" && isCurrentPeriod(review, data.period_start) ? (
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
    </ScreenFrame>
  );
}
