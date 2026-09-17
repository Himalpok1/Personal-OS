// The Focus Now TASK sheet (Checkpoint 10.6, ADR-075 §1, ADR-076 §3): the
// "why is this here?" explanation for a personal task row, the assignment
// detail when the row was merged with a Canvas assignment (ADR-075 §3), and
// the quick actions -- Open task, Mark done, the three snooze targets -- run
// through the same mutations Today's own rows use (use-today-task-actions.ts).
//
// Same shape as components/academic/assignment-sheet.tsx and for the same
// reason: the rows that open it are hookless (walked by the tree-walking
// tests), so `openFocusNowTaskSheet()` writes to a module store and ONE
// `FocusNowTaskSheetHost` -- mounted by the Focus Now card, its only opener
// -- reads it and draws the `BottomSheet`. A completion failure is shown
// INSIDE the sheet as an inert danger row (never a toast: an error needs
// reading -- docs/MOBILE-DESIGN-SYSTEM.md → Toasts), so a swipe or circle
// that fails re-opens the sheet with the message.
//
// `FocusNowTaskSheetHost` is the leaf; `FocusNowTaskSheetContent` is
// hookless and is what the tests render.
import type { SnoozeChoice } from "@personal-os/core/task-snooze";
import { useRouter, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { View } from "react-native";
import { AssignmentDetail, OpenInCanvasRow } from "@/components/academic/assignment-sheet";
import { AppText, BottomSheet, ListRow, SheetRow, showToast } from "@/components/ui";
import { focusNowExplanation, type FocusNowTaskRow } from "./focus-now-card-state";
import { FocusNowExplanationBlock } from "./focus-now-explanation";
import { SNOOZE_CHOICES, canSnoozeTodayTask } from "./today-task-actions-state";
import { useTodayTaskActions } from "./use-today-task-actions";

export interface FocusNowTaskSheetState {
  visible: boolean;
  row: FocusNowTaskRow | null;
  /** A classified failure line from the last action on this row, shown inline. */
  error: string | null;
}

// --- the store -------------------------------------------------------------

type Listener = () => void;

const CLOSED: FocusNowTaskSheetState = { visible: false, row: null, error: null };
let state: FocusNowTaskSheetState = CLOSED;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Open (or re-open) the sheet for a task row, optionally with a failure line to show. */
export function openFocusNowTaskSheet(row: FocusNowTaskRow, error: string | null = null): void {
  state = { visible: true, row, error };
  emit();
}

export function closeFocusNowTaskSheet(): void {
  if (!state.visible) return;
  state = { ...state, visible: false };
  emit();
}

/** Replace the failure line on the open sheet (an action that failed from inside it). */
export function setFocusNowTaskSheetError(error: string | null): void {
  state = { ...state, error };
  emit();
}

export function getFocusNowTaskSheet(): FocusNowTaskSheetState {
  return state;
}

export function subscribeFocusNowTaskSheet(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only. */
export function resetFocusNowTaskSheetForTests(): void {
  state = CLOSED;
  emit();
}

// --- the content -----------------------------------------------------------

export interface FocusNowTaskSheetContentProps {
  row: FocusNowTaskRow;
  error: string | null;
  pending: boolean;
  onOpenTask: () => void;
  onComplete: () => void;
  onSnooze: (choice: SnoozeChoice) => void;
}

export function FocusNowTaskSheetContent({
  row,
  error,
  pending,
  onOpenTask,
  onComplete,
  onSnooze,
}: FocusNowTaskSheetContentProps) {
  const linked = row.linkedPriorityItem;
  const snoozable = canSnoozeTodayTask(row.task);
  return (
    <View className="gap-3 pb-2" testID="focus-now-task-sheet-content">
      <FocusNowExplanationBlock explanation={focusNowExplanation(row)} />

      {linked ? (
        <View>
          <AppText variant="overline" tone="muted" className="pb-1">
            Linked assignment
          </AppText>
          <AppText variant="body-strong" numberOfLines={2}>
            {linked.assignment.title}
          </AppText>
          <AssignmentDetail assignment={linked.assignment} />
        </View>
      ) : null}

      {error ? (
        <ListRow
          title={error}
          titleTone="danger"
          icon="alert-circle-outline"
          iconTone="danger"
          accessibilityLabel={`${row.task.title}: ${error}`}
          inset
          last
        />
      ) : null}

      <View>
        <SheetRow
          icon="open-in-app"
          label="Open task"
          onPress={onOpenTask}
          accessibilityLabel={`Open task: ${row.task.title}`}
          testID="focus-now-sheet-open-task"
        />
        <SheetRow
          icon="check-circle-outline"
          label="Mark done"
          tone="success"
          onPress={onComplete}
          accessibilityLabel={`Complete ${row.task.title}`}
          disabled={pending}
          last={!snoozable && linked === null}
          testID="focus-now-sheet-complete"
        />
        {snoozable ? (
          <>
            <AppText variant="overline" tone="muted" className="pb-1 pt-3">
              Snooze
            </AppText>
            {SNOOZE_CHOICES.map((option, index) => (
              <SheetRow
                key={option.choice}
                icon="alarm-snooze"
                label={option.label}
                tone="warning"
                onPress={() => onSnooze(option.choice)}
                accessibilityLabel={`Snooze ${row.task.title}: ${option.label}`}
                disabled={pending}
                last={index === SNOOZE_CHOICES.length - 1 && linked === null}
                testID={`focus-now-sheet-snooze-${option.choice}`}
              />
            ))}
          </>
        ) : null}
        {linked ? <OpenInCanvasRow assignment={linked.assignment} /> : null}
      </View>
    </View>
  );
}

// --- the host --------------------------------------------------------------

/** Mounted ONCE, by the Focus Now card. The leaf. */
export function FocusNowTaskSheetHost() {
  const router = useRouter();
  const current = useSyncExternalStore(
    subscribeFocusNowTaskSheet,
    getFocusNowTaskSheet,
    getFocusNowTaskSheet,
  );
  const actions = useTodayTaskActions();
  const row = current.row;

  return (
    <BottomSheet
      open={current.visible}
      onClose={closeFocusNowTaskSheet}
      title={row?.task.title}
      testID="focus-now-task-sheet"
    >
      {row ? (
        <FocusNowTaskSheetContent
          row={row}
          error={current.error}
          pending={actions.pending}
          onOpenTask={() => {
            closeFocusNowTaskSheet();
            router.push(`/tasks/${row.task.id}` as Href);
          }}
          onComplete={() => {
            setFocusNowTaskSheetError(null);
            actions.complete(row.task, {
              onSuccess: () => {
                closeFocusNowTaskSheet();
                showToast({ message: "Completed", tone: "success" });
              },
              onError: setFocusNowTaskSheetError,
            });
          }}
          onSnooze={(choice) => {
            setFocusNowTaskSheetError(null);
            actions.snooze(row.task, choice, {
              onSuccess: () => {
                closeFocusNowTaskSheet();
                showToast({ message: "Snoozed", tone: "info" });
              },
              onError: setFocusNowTaskSheetError,
            });
          }}
        />
      ) : null}
    </BottomSheet>
  );
}
