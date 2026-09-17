import type {
  DailyReviewChecklist,
  DailyReviewContent,
  DailyReviewContext,
  Review,
  ReviewContextProject,
  ReviewPriorityRef,
  TodayEventItem,
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
  buttonClasses,
  useTheme,
} from "@/components/ui";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import {
  ReviewStepList,
  activeStepIndex,
  deriveSteps,
  type ReviewStepView,
} from "@/components/reviews/review-step-list";
import {
  isCurrentPeriod,
  savedChecklist,
  savedPriorities,
} from "@/components/reviews/review-content";
import { formatHeaderDate } from "@/utils/local-date";
import {
  useCompleteReview,
  useDailyReviewContext,
  useLatestReview,
  useSaveReview,
  useSkipReview,
  useStartReview,
} from "@/queries/reviews";

// ---- Formatting helpers (formatHeaderDate/parseLocalDate now live in
// @/utils/local-date, shared with weekly.tsx and the tab screens) ----

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

// raw_text when present; otherwise an honest per-status label.
function inboxPreviewLabel(item: DailyReviewContext["inbox_attention"]["items"][number]): string {
  if (item.raw_text) return item.raw_text;
  if (item.status === "needs_confirm") return "Needs confirmation";
  if (item.status === "failed") return "Parse failed";
  return "Pending capture";
}

// ---- Content v1 contract helpers ----

// Every toggle PATCHes whole content v1 (no server-side merge), so each
// payload always carries every current flag AND the current priority
// selection together -- a reload at any moment restores exactly what was
// shown.
function dailyContent(
  checklist: DailyReviewChecklist,
  selectedPriorities: ReviewPriorityRef[],
): DailyReviewContent {
  return {
    version: REVIEW_CONTENT_VERSION,
    kind: "daily",
    checklist,
    selected_priorities: selectedPriorities,
  };
}
// Resume persistence uses the shared audited helpers (audit D1): non-null
// content is kind-bound server-side, so it is trusted wholesale.


function toggledChecklist(
  checklist: DailyReviewChecklist,
  key: keyof DailyReviewChecklist,
): DailyReviewChecklist {
  const next: DailyReviewChecklist = { ...checklist };
  next[key] = checklist[key] !== true;
  return next;
}

// ---- Priority selection helpers ----

const PRIORITY_CAP = 10;

interface PriorityOption {
  ref: ReviewPriorityRef;
  title: string;
}

// Standalone tasks select themselves ({kind:"task", id}); occurrence rows
// select their materialized occurrence ({kind:"occurrence", id:
// occurrence_id}), matching the frozen ReviewPriorityRef contract. The two
// source sections are disjoint by frozen bucketing semantics, but dedupe is
// cheap insurance against double-rendering a chip.
function priorityOptions(context: DailyReviewContext): PriorityOption[] {
  const seen = new Set<string>();
  const options: PriorityOption[] = [];
  for (const item of [...context.overdue.items, ...context.due_today.items]) {
    const ref: ReviewPriorityRef =
      item.occurrence_id != null
        ? { kind: "occurrence", id: item.occurrence_id }
        : { kind: "task", id: item.id };
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ ref, title: item.title });
  }
  return options;
}

function isSelected(selected: ReviewPriorityRef[], ref: ReviewPriorityRef): boolean {
  return selected.some((item) => item.kind === ref.kind && item.id === ref.id);
}

function toggleRef(selected: ReviewPriorityRef[], ref: ReviewPriorityRef): ReviewPriorityRef[] {
  return isSelected(selected, ref)
    ? selected.filter((item) => !(item.kind === ref.kind && item.id === ref.id))
    : [...selected, ref];
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
      accessibilityLabel={`Open event: ${title}`}
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

// ---- Step bodies (daily context sections) ----

type InboxSection = DailyReviewContext["inbox_attention"];

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

type BoundedTasksSection = DailyReviewContext["overdue"];

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

function PrioritiesBody({
  options,
  selected,
  disabled,
  onToggle,
}: {
  options: PriorityOption[];
  selected: ReviewPriorityRef[];
  disabled: boolean;
  onToggle: (ref: ReviewPriorityRef) => void;
}) {
  if (options.length === 0) {
    return <EmptyText>No overdue or due-today tasks to prioritize.</EmptyText>;
  }
  return (
    <View>
      <AppText variant="caption" tone="muted" className="py-1">
        {selected.length}/{PRIORITY_CAP} selected
      </AppText>
      <View className="flex-row flex-wrap gap-2 pt-1">
        {options.map(({ ref, title }) => {
          const checked = isSelected(selected, ref);
          // Cap enforcement lives in the UI only: once n/10 is reached the
          // remaining unselected chips disable instead of silently dropping.
          const chipDisabled = !checked && disabled;
          // A small tonal / outline Button by class (the design system's own
          // `buttonClasses`), kept a Pressable because it is a CHECKBOX to a
          // screen reader, which Button cannot express. max-w tightened so 3
          // chips fit per row on the Rabbit's 480px width.
          const classes = buttonClasses(checked ? "tonal" : "outline", "sm", false);
          return (
            <Pressable
              key={`${ref.kind}:${ref.id}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked, disabled: chipDisabled }}
              accessibilityLabel={title}
              onPress={() => onToggle(ref)}
              disabled={chipDisabled}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              className={`${classes.container} ${chipDisabled ? "opacity-50" : ""}`}
            >
              {checked ? <Icon name="check" size="sm" tone="on-primary-container" /> : null}
              <AppText
                variant="label"
                tone="inherit"
                className={`max-w-[130px] ${classes.label} ${checked ? "font-semibold" : ""}`}
                numberOfLines={1}
              >
                {title}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function CalendarBody({ events }: { events: TodayEventItem[] }) {
  if (events.length === 0) return <EmptyText>No events today.</EmptyText>;
  const timed = events.filter((event) => !event.all_day);
  const allDay = events.filter((event) => event.all_day);
  return (
    <View>
      {timed.map((event) => (
        <AgendaRow
          key={`${event.id}-${event.occurs_at ?? event.starts_at ?? event.id}`}
          href={`/events/${event.id}`}
          title={event.title}
          time={formatTime(event.occurs_at ?? event.starts_at ?? "")}
        />
      ))}
      {allDay.length > 0 ? <SectionTitle>All-day</SectionTitle> : null}
      {allDay.map((event) => (
        <AgendaRow
          key={`${event.id}-${event.occurs_at ?? event.starts_at ?? event.id}`}
          href={`/events/${event.id}`}
          title={event.title}
          time={null}
        />
      ))}
    </View>
  );
}

function ProjectsBody({
  projects,
  emptyLabel,
}: {
  projects: DailyReviewContext["active_projects"];
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
  section: DailyReviewContext["projects_without_next_action"];
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

function DailyFlow({ review, context }: { review: Review; context: DailyReviewContext }) {
  const placeholderColor = usePlaceholderColor();
  const [checklist, setChecklist] = useState<DailyReviewChecklist>(() => savedChecklist(review));
  const [selected, setSelected] = useState<ReviewPriorityRef[]>(() => savedPriorities(review));
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
  const router = useRouter();

  const steps = deriveSteps(context, "daily", checklist);
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
  const latest = useRef({ checklist, selected });
  latest.current = { checklist, selected };
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  const queueContentSave = () => {
    saveChain.current = saveChain.current
      .then(() =>
        saveContent.mutateAsync({
          id: review.id,
          patch: { content: dailyContent(latest.current.checklist, latest.current.selected) },
        }),
      )
      // Swallowed here only so one failure cannot break the chain for every
      // later save; the failure itself is surfaced through saveContent.isError.
      .catch(() => undefined);
  };

  const toggleStep = (key: keyof DailyReviewChecklist) => {
    const next = toggledChecklist(checklist, key);
    setChecklist(next);
    latest.current = { ...latest.current, checklist: next };
    queueContentSave();
  };

  const togglePriority = (ref: ReviewPriorityRef) => {
    const next = toggleRef(selected, ref);
    setSelected(next);
    latest.current = { ...latest.current, selected: next };
    queueContentSave();
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
      case "priorities":
        return (
          <PrioritiesBody
            options={priorityOptions(context)}
            selected={selected}
            disabled={selected.length >= PRIORITY_CAP}
            onToggle={togglePriority}
          />
        );
      case "calendar":
        return <CalendarBody events={context.events_today.items} />;
      case "projects":
        return (
          <ProjectsBody projects={context.active_projects} emptyLabel="No active projects." />
        );
      case "next_actions":
        return <MissingNextActionsBody section={context.projects_without_next_action} />;
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
              placeholder="How did today go?"
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
            onToggle={() => toggleStep(step.key as keyof DailyReviewChecklist)}
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
          onPress={() => complete.mutate({ id: review.id }, { onSuccess: () => router.back() })}
          disabled={complete.isPending || skip.isPending}
          variant="primary"
          icon="check"
          block
        />
        <Button
          label="Skip today"
          onPress={() => skip.mutate({ id: review.id }, { onSuccess: () => router.back() })}
          disabled={complete.isPending || skip.isPending}
          variant="outline"
          block
        />
      </View>
    </View>
  );
}

function DailyTerminal({ review, context }: { review: Review; context: DailyReviewContext }) {
  const completed = review.status === "completed";
  const steps = deriveSteps(context, "daily", savedChecklist(review));
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
          Daily review
        </AppText>
        <AppText variant="headline" className="mt-1">
          {formatHeaderDate(periodStart)}
        </AppText>
        <AppText variant="body" tone="secondary" className="mt-2">
          Close out the day: clear the inbox and overdue work, pick tomorrow&apos;s priorities,
          check today&apos;s calendar and projects, then jot how it went. Your progress saves as you
          go.
        </AppText>
        {failed ? (
          <AppText variant="body" tone="danger" className="mt-3" accessibilityRole="alert">
            Couldn&apos;t start the review — try again.
          </AppText>
        ) : null}
        <Button
          label={starting ? "Starting…" : "Start daily review"}
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

export default function DailyReviewScreen() {
  const keyboardHeight = useKeyboardHeight();
  const context = useDailyReviewContext();
  const latest = useLatestReview("daily");
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
          <DailyFlow key={review.id} review={review} context={data} />
        ) : review &&
          (review.status === "completed" || review.status === "skipped") &&
          review.period_start === data.period_start ? (
          // Terminal reviews of the CURRENT period render read-only with no
          // reopen; older terminal reviews fall through to the start gate.
          <DailyTerminal key={review.id} review={review} context={data} />
        ) : (
          <StartGate
            periodStart={data.period_start}
            starting={start.isPending}
            failed={start.isError}
            onStart={() => start.mutate("daily")}
          />
        )}
      </ScrollView>
    </ScreenFrame>
  );
}
