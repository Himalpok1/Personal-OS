// The approval sheet (Checkpoint 10.8, ADR-078 §6/§8): the ONE place an
// action request is approved or cancelled. Before the two buttons the owner
// reads, in order, WHAT KIND of action it is (capability, reversibility and
// risk -- three chips from the registry), WHY it was proposed (the
// client-authored reason and its source chip -- never a model's words, §6),
// and WHAT WILL CHANGE (rows derived from the frozen input, no raw ids).
// Approve executes synchronously on the server and returns the terminal row;
// a `failed` row keeps the sheet open with the friendly line for its
// `error_class` as an inert danger row (never a toast: an error needs
// reading -- docs/MOBILE-DESIGN-SYSTEM.md → Toasts). Cancel runs nothing and
// so confirms nothing.
//
// STATE LIVES IN A MODULE STORE, the `openAssignmentSheet()` pattern: the
// rows that open it (the Action Center list, the Today card, the assignment
// sheet's own proposals) are hookless or are mutation callbacks, so
// `openActionApprovalSheet()` is a plain function and ONE
// `ActionApprovalSheetHost`, mounted once at the root beside
// `MemorySuggestionSheetHost` (app/_layout.tsx), draws the `BottomSheet`.
// src/__tests__/actions-trust-line.test.ts pins that no screen mounts one.
//
// `ActionApprovalSheetHost` is the leaf (hooks); `ActionRequestSummary` and
// `ActionApprovalSheetContent` are hookless and are what the tests render
// -- and what /actions/[id] reuses for its own Why / What-will-change blocks.
import type { ActionRequestItem } from "@personal-os/schema";
import { useSyncExternalStore } from "react";
import { View } from "react-native";
import {
  AppText,
  BottomSheet,
  Button,
  ListRow,
  StatusChip,
  showToast,
  triggerHaptic,
} from "@/components/ui";
import { useApproveAction, useCancelAction } from "@/queries/actions";
import {
  actionChipStrip,
  actionDefinitionFor,
  actionErrorLabel,
  actionReasonText,
  actionSourceChip,
  whatWillChangeRows,
  whatWillChangeSpoken,
} from "./action-approval-sheet-state";

export interface ActionApprovalSheetState {
  /** Whether the sheet is up. The item is kept through the exit animation. */
  visible: boolean;
  item: ActionRequestItem | null;
  /** A failure line from the last approve/cancel on this item, shown inline. */
  error: string | null;
}

// --- the store -------------------------------------------------------------

type Listener = () => void;

const CLOSED: ActionApprovalSheetState = { visible: false, item: null, error: null };
let state: ActionApprovalSheetState = CLOSED;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Open the sheet for a request, replacing whatever it showed. */
export function openActionApprovalSheet(item: ActionRequestItem): void {
  state = { visible: true, item, error: null };
  emit();
}

/** Close the sheet. The item stays for the exit animation and is replaced by the next open. */
export function closeActionApprovalSheet(): void {
  if (!state.visible) return;
  state = { ...state, visible: false };
  emit();
}

/** Replace the item on the open sheet (the terminal row an approve returned) and its failure line. */
export function setActionApprovalSheetResult(
  item: ActionRequestItem | null,
  error: string | null,
): void {
  state = { ...state, item: item ?? state.item, error };
  emit();
}

export function getActionApprovalSheet(): ActionApprovalSheetState {
  return state;
}

export function subscribeActionApprovalSheet(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: back to closed with no item. */
export function resetActionApprovalSheetForTests(): void {
  state = CLOSED;
  emit();
}

// --- the content -----------------------------------------------------------

/**
 * The chip strip, the Why block and the What-will-change block. Hookless;
 * shared by the sheet and the detail screen so the two never disagree.
 */
export function ActionRequestSummary({
  item,
  testID,
}: {
  item: ActionRequestItem;
  testID?: string;
}) {
  const definition = actionDefinitionFor(item);
  const chips = actionChipStrip(definition);
  const source = actionSourceChip(item.source);
  const reason = actionReasonText(item);
  const rows = whatWillChangeRows(item);
  return (
    <View className="gap-3" testID={testID}>
      <View
        className="flex-row flex-wrap gap-1.5"
        accessible
        accessibilityLabel={chips.map((chip) => chip.label).join(", ")}
        testID="action-chip-strip"
      >
        {chips.map((chip) => (
          <StatusChip key={chip.label} label={chip.label} tone={chip.tone} icon={chip.icon} />
        ))}
      </View>

      <View
        accessible
        accessibilityLabel={`Why: ${reason}. Source: ${source.label}`}
        testID="action-why"
      >
        <AppText variant="overline" tone="muted" className="pb-1">
          Why
        </AppText>
        <View className="flex-row items-start gap-2">
          <AppText variant="body-strong" className="flex-1" numberOfLines={3}>
            {reason}
          </AppText>
          <StatusChip label={source.label} tone={source.tone} />
        </View>
      </View>

      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`What will change. ${whatWillChangeSpoken(rows)}`}
        testID="action-what-will-change"
      >
        <AppText variant="overline" tone="muted" className="pb-1">
          What will change
        </AppText>
        {rows.map((row) => (
          <View key={row.label} className="flex-row items-start justify-between gap-3 py-1">
            <AppText variant="label" tone="secondary" className="font-normal">
              {row.label}
            </AppText>
            <AppText variant="body" className="flex-1 text-right" numberOfLines={3}>
              {row.value}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

export interface ActionApprovalSheetContentProps {
  item: ActionRequestItem;
  error: string | null;
  pending: boolean;
  onApprove: () => void;
  onCancel: () => void;
}

/** Everything inside the sheet frame. Hookless. */
export function ActionApprovalSheetContent({
  item,
  error,
  pending,
  onApprove,
  onCancel,
}: ActionApprovalSheetContentProps) {
  const definition = actionDefinitionFor(item);
  const actionable = item.status === "pending";
  return (
    <View className="gap-3 pb-2" testID="action-approval-sheet-content">
      <AppText variant="caption" tone="secondary">
        {definition.description}
      </AppText>
      <ActionRequestSummary item={item} />

      {error ? (
        <ListRow
          title={error}
          titleTone="danger"
          icon="alert-circle-outline"
          iconTone="danger"
          accessibilityLabel={`${item.input_summary}: ${error}`}
          inset
          last
          testID="action-approval-error"
        />
      ) : null}

      {actionable ? (
        <View className="gap-2 pt-1">
          <Button
            label="Approve"
            onPress={onApprove}
            busy={pending}
            variant="primary"
            icon="check"
            block
            accessibilityLabel={`Approve: ${item.input_summary}`}
            testID="action-approve"
          />
          <Button
            label="Cancel"
            onPress={onCancel}
            disabled={pending}
            variant="outline"
            haptic={false}
            block
            accessibilityLabel={`Cancel: ${item.input_summary}`}
            testID="action-cancel"
          />
        </View>
      ) : null}
    </View>
  );
}

// --- the host --------------------------------------------------------------

/** The line for a failed approve/cancel call itself (not a `failed` row -- those name their class). */
export const ACTION_CALL_FAILED = "Couldn't reach Personal OS. Try again.";
/** The row was already answered (or expired) before this tap landed. */
export const ACTION_NOT_PENDING = "This request is no longer waiting for you.";

function callFailureLine(error: unknown): string {
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return code === "action_not_pending" ? ACTION_NOT_PENDING : ACTION_CALL_FAILED;
}

/** Mounted ONCE, at the root. The leaf. */
export function ActionApprovalSheetHost() {
  const current = useSyncExternalStore(
    subscribeActionApprovalSheet,
    getActionApprovalSheet,
    getActionApprovalSheet,
  );
  const approve = useApproveAction();
  const cancel = useCancelAction();
  const item = current.item;
  const pending = approve.isPending || cancel.isPending;

  const onApprove = () => {
    if (!item) return;
    setActionApprovalSheetResult(null, null);
    approve.mutate(item.id, {
      onSuccess: (result) => {
        if (result.status === "completed") {
          triggerHaptic("success");
          closeActionApprovalSheet();
          showToast({ message: result.result_summary ?? "Done", tone: "success" });
          return;
        }
        // `failed` (or any other terminal state): stay open, say why.
        setActionApprovalSheetResult(result, actionErrorLabel(result.error_class));
      },
      onError: (error) => setActionApprovalSheetResult(null, callFailureLine(error)),
    });
  };

  const onCancel = () => {
    if (!item) return;
    setActionApprovalSheetResult(null, null);
    cancel.mutate(item.id, {
      onSuccess: () => {
        closeActionApprovalSheet();
        showToast({ message: "Cancelled", tone: "neutral" });
      },
      onError: (error) => setActionApprovalSheetResult(null, callFailureLine(error)),
    });
  };

  return (
    <BottomSheet
      open={current.visible}
      onClose={closeActionApprovalSheet}
      title={item ? actionDefinitionFor(item).name : undefined}
      testID="action-approval-sheet"
    >
      {item ? (
        <ActionApprovalSheetContent
          item={item}
          error={current.error}
          pending={pending}
          onApprove={onApprove}
          onCancel={onCancel}
        />
      ) : null}
    </BottomSheet>
  );
}
