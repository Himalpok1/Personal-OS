import { View } from "react-native";
import { AppText, Icon } from "@/components/ui";
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
//
// Checkpoint 10.3: the step disc and title draw from the design tokens -- a
// done step is a `success-container` disc with a check, the active step a
// `primary` disc, the rest an outlined disc. There is no stepper primitive in
// components/ui/, so the token classes are written here, the same way the
// primitives write them.

const DISC_DONE = "bg-success-container dark:bg-success-container-dark";
const DISC_ACTIVE = "bg-primary dark:bg-primary-dark";
const DISC_IDLE =
  "border border-outline-strong bg-surface dark:border-outline-strong-dark dark:bg-surface-dark";
const GLYPH_ACTIVE = "text-on-primary dark:text-on-primary-dark";

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
        const circleTone = step.done ? DISC_DONE : isActive ? DISC_ACTIVE : DISC_IDLE;

        return (
          // min-h-[40px] keeps every row a valid future touch target even in
          // compact mode; screens wrap rows in their own Pressable to handle
          // taps, this list stays display-only.
          <View
            key={step.key}
            className={`min-h-[40px] flex-row items-center gap-3 ${compact ? "py-1" : "py-2"}`}
          >
            <View
              className={`items-center justify-center rounded-full ${circleSize} ${circleTone}`}
            >
              {step.done ? (
                <Icon name="check" size={compact ? "xs" : "sm"} tone="on-success-container" />
              ) : (
                <AppText
                  variant="caption"
                  tone={isActive ? "inherit" : "muted"}
                  className={`font-semibold ${compact ? "text-[10px]" : ""} ${
                    isActive ? GLYPH_ACTIVE : ""
                  }`}
                >
                  {String(index + 1)}
                </AppText>
              )}
            </View>
            <AppText
              variant={compact ? "label" : "body"}
              tone={isActive ? "default" : step.done ? "muted" : "default"}
              className={`flex-1 ${isActive ? "font-bold" : compact ? "font-normal" : ""}`}
            >
              {step.title}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}
