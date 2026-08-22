import { Text, View } from "react-native";
import type {
  DailyReviewChecklist,
  DailyReviewContext,
  WeeklyReviewChecklist,
  WeeklyReviewContext,
} from "@personal-os/schema";

// ---- Pure step derivation (unit-tested in review-step-list.test.ts) ----
//
// The step order is the frozen content-v1 checklist contract from
// packages/schema/src/reviews.ts; titles are display strings for exactly
// those keys. Done flags are read from review.content.checklist, where every
// key is optional -- absent means not done.

export interface ReviewStepView {
  key: string;
  title: string;
  done: boolean;
}

const DAILY_STEP_TITLES = [
  { key: "inbox", title: "Inbox" },
  { key: "overdue", title: "Overdue" },
  { key: "priorities", title: "Priorities" },
  { key: "calendar", title: "Calendar" },
  { key: "projects", title: "Projects" },
  { key: "next_actions", title: "Next actions" },
  { key: "summary", title: "Summary" },
] as const satisfies readonly { key: keyof DailyReviewChecklist; title: string }[];

const WEEKLY_STEP_TITLES = [
  { key: "inbox", title: "Inbox" },
  { key: "overdue", title: "Overdue" },
  { key: "active_projects", title: "Active projects" },
  { key: "paused_projects", title: "Paused projects" },
  { key: "stalled_projects", title: "Stalled projects" },
  { key: "missing_next_actions", title: "Missing next actions" },
  { key: "upcoming_week", title: "Upcoming week" },
  { key: "recently_completed", title: "Recently completed" },
  { key: "summary", title: "Summary" },
] as const satisfies readonly { key: keyof WeeklyReviewChecklist; title: string }[];

export function deriveSteps(
  // The context pins which period's sections the screen is showing; the step
  // set itself is fixed per kind, so only kind and the saved checklist drive
  // the output.
  _context: DailyReviewContext,
  kind: "daily",
  checklist?: DailyReviewChecklist | null,
): ReviewStepView[];
export function deriveSteps(
  _context: WeeklyReviewContext,
  kind: "weekly",
  checklist?: WeeklyReviewChecklist | null,
): ReviewStepView[];
export function deriveSteps(
  _context: DailyReviewContext | WeeklyReviewContext,
  kind: "daily" | "weekly",
  checklist?: DailyReviewChecklist | WeeklyReviewChecklist | null,
): ReviewStepView[] {
  return kind === "daily"
    ? DAILY_STEP_TITLES.map((step) => ({
        key: step.key,
        title: step.title,
        done: (checklist as DailyReviewChecklist | null | undefined)?.[step.key] === true,
      }))
    : WEEKLY_STEP_TITLES.map((step) => ({
        key: step.key,
        title: step.title,
        done: (checklist as WeeklyReviewChecklist | null | undefined)?.[step.key] === true,
      }));
}

// First unfinished step drives the accent circle. When everything is checked
// (or there are no steps at all) it lands on the last step / -1 respectively.
export function activeStepIndex(steps: ReviewStepView[]): number {
  const firstNotDone = steps.findIndex((step) => !step.done);
  if (firstNotDone !== -1) {
    return firstNotDone;
  }
  return steps.length - 1;
}

// ---- Presentational component (no data fetching; taps live on screens) ----

export function ReviewStepList(props: {
  steps: ReviewStepView[];
  activeIndex: number | null;
  compact?: boolean;
}) {
  const { steps, activeIndex, compact = false } = props;

  return (
    <View>
      {steps.map((step, index) => {
        const isActive = activeIndex === index;
        const circleSize = compact ? "h-6 w-6" : "h-7 w-7";
        const circleBase = `items-center justify-center rounded-full ${circleSize}`;
        const circleTone = step.done
          ? "bg-green-600"
          : isActive
            ? "bg-blue-600"
            : "border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-black";
        const glyph = step.done ? "✓" : String(index + 1);
        const glyphClass =
          step.done || isActive
            ? compact
              ? "text-[10px] font-semibold text-white"
              : "text-xs font-semibold text-white"
            : compact
              ? "text-[10px] font-semibold text-neutral-500 dark:text-neutral-400"
              : "text-xs font-semibold text-neutral-500 dark:text-neutral-400";
        const titleClass = isActive
          ? compact
            ? "flex-1 text-sm font-bold text-black dark:text-white"
            : "flex-1 text-base font-bold text-black dark:text-white"
          : compact
            ? `flex-1 text-xs ${
                step.done ? "text-neutral-500 dark:text-neutral-400" : "text-black dark:text-white"
              }`
            : `flex-1 text-sm ${
                step.done ? "text-neutral-500 dark:text-neutral-400" : "text-black dark:text-white"
              }`;

        return (
          // min-h-[40px] keeps every row a valid future touch target even in
          // compact mode; screens wrap rows in their own Pressable to handle
          // taps, this list stays display-only.
          <View
            key={step.key}
            className={`min-h-[40px] flex-row items-center gap-3 ${compact ? "py-1" : "py-2"}`}
          >
            <View className={`${circleBase} ${circleTone}`}>
              <Text className={glyphClass}>{glyph}</Text>
            </View>
            <Text className={titleClass}>{step.title}</Text>
          </View>
        );
      })}
    </View>
  );
}
