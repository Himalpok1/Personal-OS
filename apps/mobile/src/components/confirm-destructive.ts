import { Alert, Platform } from "react-native";

// A confirmation that actually asks on every platform this app ships to.
//
// ===========================================================================
// `Alert.alert` IS AN EMPTY NO-OP ON REACT-NATIVE-WEB.
// ===========================================================================
//
// Verified in the installed react-native-web@0.21.2:
//
//   class Alert { static alert() {} }
//
// It takes the arguments and does nothing. No dialog appears, and -- the part
// that matters -- the confirm callback is never invoked, so the action silently
// does not happen. On the web target a destructive button wired straight to
// `Alert.alert` is not "unconfirmed"; it is INERT.
//
// This app ships web (docs/ARCHITECTURE.md: one universal Expo codebase for
// iOS, Android and web), so a confirmation written the obvious way is a button
// that does nothing on a real, shipped target.
//
// ---------------------------------------------------------------------------
// SCOPE
//
// Introduced by Checkpoint 7.6 for the surfaces it added, and extended by
// Checkpoint 7.7 -- the hardening checkpoint -- to every DESTRUCTIVE
// confirmation in the app. Two `Alert.alert` call sites deliberately remain and
// are not defects:
//
//   * `notifications/exact-alarm.ts` returns early unless `Platform.OS ===
//     "android"`, so its prompt cannot run on web at all.
//   * `components/quick-add-fab.tsx` shows a one-button INFORMATIONAL notice
//     ("Saved offline"). Nothing is lost when it does not appear -- the capture
//     is already queued -- and routing it through a blocking `window.confirm`
//     would be worse than silence. It wants a toast, which is a UI addition
//     this checkpoint is not making.

export interface ConfirmDestructiveOptions {
  title: string;
  message: string;
  /** The destructive button's label, e.g. "Disconnect". */
  confirmLabel: string;
  /** Defaults to "Cancel"; some dialogs word it as the safe choice ("Keep it"). */
  cancelLabel?: string;
  onConfirm: () => void;
}

/**
 * Asks the user to confirm, then runs `onConfirm` only if they agree.
 *
 * Native uses `Alert.alert` so the platform dialog and its styling are
 * unchanged. Web uses `window.confirm`, which is synchronous and blocking but
 * is the only confirmation primitive available without adding a modal component
 * and a dependency -- and a blocking prompt that works beats a styled one that
 * silently does nothing.
 */
export function confirmDestructive(options: ConfirmDestructiveOptions): void {
  const { title, message, confirmLabel, cancelLabel = "Cancel", onConfirm } = options;

  if (Platform.OS === "web") {
    // `globalThis.confirm` rather than a bare `confirm`, so this module does not
    // assume a DOM: in a test or SSR context the guard below simply declines
    // rather than throwing.
    const ask = (globalThis as { confirm?: (m?: string) => boolean }).confirm;
    if (typeof ask !== "function") return;
    if (ask(`${title}\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: cancelLabel, style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}
