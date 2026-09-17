// Toasts (Checkpoint 10.6): a transient line of feedback -- "Task completed",
// "Saved offline", "Archived" with an Undo -- that slides up above the
// floating buttons and leaves on its own.
//
// The store is module-level on purpose. A mutation's `onSuccess` lives in a
// query hook or a hookless component with no access to context, so
// `showToast()` is a plain function: it writes one record into a tiny
// external store and `ToastHost` (mounted once in app/_layout.tsx) reads it
// through `useSyncExternalStore`. Only one toast is ever visible -- the
// latest wins and its predecessor's timer is dropped -- because two stacked
// lines on the Rabbit R1's 640px would cover the row the owner just acted on.
//
// The host is the animated leaf (it uses a React hook); `ToastCard` is
// hookless and `toastClasses` is pure, so both are tested by tree-walk, and
// the store's own functions are tested directly.
import { useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  FLOATING_BUTTON_BOTTOM_PX,
  FLOATING_BUTTON_SIDE_INSET_PX,
  FLOATING_BUTTON_SIZE_PX,
} from "../floating-layout";
import { enterRise, exitFade } from "./motion";
import { AppText } from "./text";

export type ToastTone = "neutral" | "success" | "warning" | "danger" | "info";

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  action?: ToastAction;
  /** How long it stays. Defaults to 4 s, or 6 s when there is an action to reach. */
  durationMs?: number;
}

export interface ToastRecord {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  durationMs: number;
}

export const TOAST_DURATION_MS = 4000;
export const TOAST_DURATION_WITH_ACTION_MS = 6000;

/** Pure: the duration a toast gets when the caller sets none. */
export function toastDuration(options: Pick<ToastOptions, "action" | "durationMs">): number {
  if (options.durationMs !== undefined) return options.durationMs;
  return options.action ? TOAST_DURATION_WITH_ACTION_MS : TOAST_DURATION_MS;
}

// --- the store -------------------------------------------------------------

type Listener = () => void;

let current: ToastRecord | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Show a toast, replacing any visible one. Returns its id. */
export function showToast(options: ToastOptions): number {
  clearTimer();
  const record: ToastRecord = {
    id: nextId++,
    message: options.message,
    tone: options.tone ?? "neutral",
    action: options.action,
    durationMs: toastDuration(options),
  };
  current = record;
  emit();
  if (record.durationMs > 0) {
    timer = setTimeout(() => dismissToast(record.id), record.durationMs);
  }
  return record.id;
}

/** Dismiss the visible toast -- or only the one with `id`, if it is still the visible one. */
export function dismissToast(id?: number): void {
  if (current === null) return;
  if (id !== undefined && current.id !== id) return;
  clearTimer();
  current = null;
  emit();
}

export function getToast(): ToastRecord | null {
  return current;
}

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: forget every toast, timer and listener. */
export function resetToastStore(): void {
  clearTimer();
  current = null;
  nextId = 1;
  listeners.clear();
}

// --- the rendering ---------------------------------------------------------

const CONTAINER_CLASS: Record<ToastTone, string> = {
  // The neutral toast is the inverse surface: on-surface as the panel, the
  // surface colour as its text -- the same pinned pair, reversed.
  neutral: "bg-on-surface dark:bg-on-surface-dark",
  success: "bg-success-container dark:bg-success-container-dark",
  warning: "bg-warning-container dark:bg-warning-container-dark",
  danger: "bg-danger-container dark:bg-danger-container-dark",
  info: "bg-info-container dark:bg-info-container-dark",
};

const TEXT_CLASS: Record<ToastTone, string> = {
  neutral: "text-surface dark:text-surface-dark",
  success: "text-on-success-container dark:text-on-success-container-dark",
  warning: "text-on-warning-container dark:text-on-warning-container-dark",
  danger: "text-on-danger-container dark:text-on-danger-container-dark",
  info: "text-on-info-container dark:text-on-info-container-dark",
};

/** Pure helper so the tone vocabulary can be pinned without rendering. */
export function toastClasses(tone: ToastTone): { container: string; text: string } {
  return {
    container: `flex-row items-center gap-3 rounded-inner py-2 pl-4 pr-2 shadow-card-raised ${CONTAINER_CLASS[tone]}`,
    text: TEXT_CLASS[tone],
  };
}

/** The hookless toast surface: message, optional 44px action. */
export function ToastCard({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const classes = toastClasses(toast.tone);
  return (
    <View
      className={classes.container}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      testID="toast"
    >
      <AppText
        variant="body-strong"
        tone="inherit"
        className={`flex-1 py-1.5 ${classes.text}`}
        numberOfLines={2}
      >
        {toast.message}
      </AppText>
      {toast.action ? (
        <Pressable
          onPress={() => {
            toast.action?.onPress();
            onDismiss();
          }}
          accessibilityRole="button"
          accessibilityLabel={toast.action.label}
          hitSlop={4}
          className="min-h-[44px] items-center justify-center rounded-inner px-3 active:opacity-70"
          testID="toast-action"
        >
          <AppText
            variant="label"
            tone="inherit"
            className={`${classes.text} font-bold underline`}
            numberOfLines={1}
          >
            {toast.action.label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Mounted once at the root. Sits just above the two floating buttons,
 * inset like the capture follow-through banner, and lets touches through
 * everywhere but the card itself.
 */
export function ToastHost() {
  const toast = useSyncExternalStore(subscribeToast, getToast, getToast);
  const insets = useSafeAreaInsets();
  if (toast === null) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: FLOATING_BUTTON_SIDE_INSET_PX,
        right: FLOATING_BUTTON_SIDE_INSET_PX,
        bottom: insets.bottom + FLOATING_BUTTON_BOTTOM_PX + FLOATING_BUTTON_SIZE_PX + 12,
      }}
      testID="toast-host"
    >
      <Animated.View key={toast.id} entering={enterRise} exiting={exitFade}>
        <ToastCard toast={toast} onDismiss={() => dismissToast(toast.id)} />
      </Animated.View>
    </View>
  );
}
