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
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
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
      <Text className="py-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
        {selected.length}/{PRIORITY_CAP} selected
      </Text>
      <View className="flex-row flex-wrap gap-2 pt-1">
        {options.map(({ ref, title }) => {
          const checked = isSelected(selected, ref);
          // Cap enforcement lives in the UI only: once n/10 is reached the
          // remaining unselected chips disable instead of silently dropping.
          const chipDisabled = !checked && disabled;
          return (
            <Pressable
              key={`${ref.kind}:${ref.id}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked, disabled: chipDisabled }}
              onPress={() => onToggle(ref)}
              disabled={chipDisabled}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              // min-h-[44px] + centering brings the ~36px visual chip up to
              // the >=44px effective touch target; max-w tightened so 3
              // chips fit per row on the Rabbit's 480px width (448 usable -
              // 2*8px gaps, /3 ~= 144px, minus the chip's own px-3 padding).
              className={`min-h-[44px] items-center justify-center rounded-full border px-3 ${
                checked
                  ? "border-blue-600 bg-blue-600 active:bg-blue-700"
                  : chipDisabled
                    ? "border-neutral-200 bg-white opacity-50 dark:border-neutral-800 dark:bg-black"
                    : "border-neutral-300 bg-white active:bg-neutral-100 dark:border-neutral-700 dark:bg-black dark:active:bg-neutral-900"
              }`}
            >
              <Text
                className={`max-w-[130px] text-sm ${checked ? "font-medium text-white" : "text-black dark:text-white"}`}
                numberOfLines={1}
              >
                {checked ? "✓ " : ""}
                {title}
              </Text>
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

function DailyFlow({ review, context }: { review: Review; context: DailyReviewContext }) {
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
              placeholder="How did today go?"
              placeholderTextColor="#888"
              className="min-h-[96px] rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
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
          <Text className="text-sm text-red-600 dark:text-red-400">
            Saving failed — check your connection and try again.
          </Text>
        ) : null}
        {saveContent.isPending || saveSummary.isPending ? (
          <Text className="text-xs text-neutral-500 dark:text-neutral-400">Saving…</Text>
        ) : null}
        <Pressable
          onPress={() => complete.mutate({ id: review.id }, { onSuccess: () => router.back() })}
          disabled={complete.isPending || skip.isPending}
          className="min-h-[44px] items-center justify-center rounded-lg bg-green-600 active:bg-green-700 disabled:opacity-50"
        >
          <Text className="font-semibold text-white">Complete review</Text>
        </Pressable>
        <Pressable
          onPress={() => skip.mutate({ id: review.id }, { onSuccess: () => router.back() })}
          disabled={complete.isPending || skip.isPending}
          className="min-h-[44px] items-center justify-center rounded-lg border border-neutral-300 active:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:active:bg-neutral-900"
        >
          <Text className="font-medium text-black dark:text-white">Skip today</Text>
        </Pressable>
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
      <Text className="text-base text-black dark:text-white">{formatHeaderDate(periodStart)}</Text>
      <Text className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        Close out the day: clear the inbox and overdue work, pick tomorrow&apos;s priorities,
        check today&apos;s calendar and projects, then jot how it went. Your progress saves as
        you go.
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
          {starting ? "Starting…" : "Start daily review"}
        </Text>
      </Pressable>
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
  );
}
