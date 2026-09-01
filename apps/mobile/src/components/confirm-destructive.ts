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
// SCOPE, STATED HONESTLY
//
// This helper is used by the surfaces Checkpoint 7.6 added. ELEVEN pre-existing
// `Alert.alert` confirmations elsewhere in the app -- Settings' Revoke, the two
// calendar Disconnects, Forget-this-device, the four Archive gates Checkpoint
// 6.5 added, the quick-add discard, and the exact-alarm prompt -- have the same
// problem and are NOT changed here. Rewriting eleven call sites across seven
// files is a cross-cutting change, and this checkpoint is scoped to the mail and
// monitoring surfaces. The finding is recorded in docs/STATUS.md rather than
// half-fixed.

export interface ConfirmDestructiveOptions {
  title: string;
  message: string;
  /** The destructive button's label, e.g. "Disconnect". */
  confirmLabel: string;
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
  const { title, message, confirmLabel, onConfirm } = options;

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
    { text: "Cancel", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}
