// The "Focus Now" card for the Today screen (Checkpoint 10.4, ADR-072;
// explanations, context and quick actions added by Checkpoint 10.6, ADR-075
// §1–§3 / ADR-076 §2–§4): a single, deterministic, ranked list merging
// personal urgent tasks (Today's overdue / due-today buckets) with academic
// priority items (the "Do next" candidates GET /academic/today already
// ranks). Every score and every reason chip is computed by
// packages/core/src/focus-now and focus-now-card-state.ts's focusNowRows --
// this file only lays the result out, the same split every other Today card
// (`academic-today-card.tsx`, `mail/digest-today-card.tsx`) uses.
//
// Owns its own two queries -- `useToday()` / `useAcademicToday()` -- rather
// than taking props, so it degrades exactly like every other self-owned Today
// card: a failed or still-loading source renders nothing, never a stale or
// partial list. Calling the same two hooks the screen and the Academics card
// already call is not a second network round trip; React Query dedupes by
// query key. Renders NOTHING at all (not an empty state) while either query
// is loading or erroring, or once merged there is nothing to show -- the
// AcademicTodayCard convention, restated in focusNowRows's own doc comment.
//
// MEMORY IS A SOFT THIRD SOURCE (Checkpoint 10.7, ADR-077 §5). The two
// memory queries (`useMemoriesForIntelligence` / `useMemorySettings`) never
// gate the list: while either is loading the rows render WITHOUT memory
// reasons and re-render with them once both are in; if either errors, memory
// is simply absent. The one `effectiveNow` stays Today's own `dataUpdatedAt`
// -- never the memory query's, never a clock read. Matching is by typed link
// in core (memory-inputs.ts → focus-now-card-state.ts); the matched memory
// rides on the row so every sheet can say "You said: …".
//
// EVERY ROW EXPLAINS ITSELF. A task row carries a completion circle, swipes
// to Done / Snooze, opens the task on tap, and opens its explanation sheet
// (focus-now-task-sheet.tsx) from the "Why?" button or a long press. An
// academic row opens the in-app assignment sheet (components/academic/
// assignment-sheet.tsx) on tap -- the same explanation, the assignment's
// facts, and only THEN "Open in Canvas" through SourceLink. A merged row
// (a task linked to one of today's assignments, ADR-075 §3) is a task row
// whose sheet also carries the assignment.
//
// Nothing here is AI, and nothing here re-derives an academic score: a task
// is scored fresh, on the same ladder; an assignment's score/reasons are
// copied from the server verbatim. See packages/core/src/focus-now/score.ts.
import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { openAssignmentSheet } from "@/components/academic/assignment-sheet";
import { courseLabel, formatDueLabel } from "@/components/academic/format";
import {
  AppText,
  Card,
  CompletionCircle,
  IconButton,
  ListRow,
  SectionHeader,
  SwipeableRow,
  TrailingChipGroup,
  enterRise,
  showToast,
  type SwipeAction,
} from "@/components/ui";
import { useAcademicToday } from "@/queries/academic";
import { useMemoriesForIntelligence, useMemorySettings } from "@/queries/memory";
import { useToday } from "@/queries/today";
import {
  focusNowExplanation,
  focusNowRows,
  type FocusNowAcademicRow,
  type FocusNowRow,
  type FocusNowTaskRow,
} from "./focus-now-card-state";
import { focusNowReasonChips } from "./focus-now-reason-chip";
import { FocusNowTaskSheetHost, openFocusNowTaskSheet } from "./focus-now-task-sheet";
import { memoryIntelligenceInput } from "./memory-inputs";
import { canSnoozeTodayTask } from "./today-task-actions-state";
import { useTodayTaskActions } from "./use-today-task-actions";

/** The second line of a task row: its due label, then its project or its linked course. */
export function focusNowTaskSubtitle(row: FocusNowTaskRow): string {
  const linked = row.linkedPriorityItem;
  const context =
    row.task.project_name ??
    (linked === null
      ? null
      : courseLabel(linked.assignment.course_code, linked.assignment.course_name));
  return [formatDueLabel(row.task.due_at), context]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" · ");
}

function FocusNowTaskRowView({ row, last }: { row: FocusNowTaskRow; last: boolean }) {
  const router = useRouter();
  const actions = useTodayTaskActions();
  const { task } = row;
  const chips = focusNowReasonChips(row.reasons);
  const openSheet = () => openFocusNowTaskSheet(row);

  const complete = () =>
    actions.complete(task, {
      onSuccess: () => showToast({ message: "Completed", tone: "success" }),
      // An error needs reading: it re-opens the sheet with the line inline.
      onError: (message) => openFocusNowTaskSheet(row, message),
    });

  const rightActions: SwipeAction[] = [
    {
      key: "done",
      label: "Done",
      icon: "check",
      tone: "success",
      haptic: "success",
      onPress: complete,
    },
  ];
  const leftActions: SwipeAction[] = canSnoozeTodayTask(task)
    ? [
        {
          key: "snooze",
          label: "Snooze",
          icon: "alarm-snooze",
          tone: "warning",
          haptic: "light",
          onPress: openSheet,
        },
      ]
    : [];

  return (
    <SwipeableRow rightActions={rightActions} leftActions={leftActions}>
      <ListRow
        title={task.title}
        subtitle={focusNowTaskSubtitle(row)}
        leading={
          <CompletionCircle
            state={actions.pending ? "pending" : "open"}
            tone="success"
            onPress={complete}
            accessibilityLabel={`Complete ${task.title}`}
          />
        }
        trailing={
          <View className="flex-row items-center gap-1">
            {chips.length > 0 ? <TrailingChipGroup chips={chips} /> : null}
            <IconButton
              icon="information-outline"
              tone="on-surface-variant"
              onPress={openSheet}
              accessibilityLabel={`Why is ${task.title} here?`}
              testID={`focus-now-why-${task.id}`}
            />
          </View>
        }
        onPress={() => router.push(`/tasks/${task.id}` as Href)}
        onLongPress={openSheet}
        accessibilityLabel={`${task.title}, ${formatDueLabel(task.due_at)}`}
        // The circle and the Why button are their own buttons, so the row
        // must not be one too (nested <button>s are invalid on web).
        containsControl
        entering={enterRise}
        inset
        last={last}
      />
    </SwipeableRow>
  );
}

function FocusNowAcademicRowView({ row, last }: { row: FocusNowAcademicRow; last: boolean }) {
  const { assignment } = row.priorityItem;
  const course = courseLabel(assignment.course_code, assignment.course_name);
  const due = formatDueLabel(assignment.due_at);
  return (
    <ListRow
      title={assignment.title}
      subtitle={`${course} · ${due}`}
      trailingChips={focusNowReasonChips(row.reasons)}
      // The tap opens the in-app sheet; the ONLY way out to Canvas is the
      // sheet's own SourceLink row (academic-open-url.test.ts).
      onPress={() => openAssignmentSheet({ assignment, explanation: focusNowExplanation(row) })}
      accessibilityLabel={`${assignment.title}, ${course}, due ${due}`}
      entering={enterRise}
      inset
      chevron
      last={last}
    />
  );
}

function FocusNowRowView({ row, last }: { row: FocusNowRow; last: boolean }) {
  return row.kind === "task" ? (
    <FocusNowTaskRowView row={row} last={last} />
  ) : (
    <FocusNowAcademicRowView row={row} last={last} />
  );
}

export function FocusNowCard() {
  const today = useToday();
  const academic = useAcademicToday();
  const memories = useMemoriesForIntelligence();
  const memorySettings = useMemorySettings();

  // Nothing while either source is loading, and nothing on either error --
  // the AcademicTodayCard convention: a slow or failing source must never
  // block, blank or error the command centre's busiest card.
  if (today.data === undefined || today.isError) return null;
  if (academic.data === undefined || academic.isError) return null;

  // Memory never gates: loading ⇒ rows without memory reasons (re-rendered
  // when it lands); errored or switched off ⇒ absent (memory-inputs.ts).
  const memory = memoryIntelligenceInput(memories, memorySettings);
  const rows = focusNowRows(today.data, academic.data, new Date(today.dataUpdatedAt), memory);
  if (rows === null) return null;

  return (
    <Card className="mb-3" accessibilityRole="summary">
      <SectionHeader title="Focus Now" icon="target" spacing="none" />
      <AppText variant="caption" tone="muted" className="pb-2">
        What needs you first, across tasks and coursework. Tap a row to see why.
      </AppText>
      {rows.map((row, index) => (
        <FocusNowRowView key={`${row.kind}:${row.id}`} row={row} last={index === rows.length - 1} />
      ))}
      {/* The task sheet's one host: this card is its only opener. The
          assignment sheet's host is mounted by the screen, since the
          Academics card opens it too. */}
      <FocusNowTaskSheetHost />
    </Card>
  );
}
