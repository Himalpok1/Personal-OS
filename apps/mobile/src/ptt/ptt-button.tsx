import { Pressable, Text, View } from "react-native";
import { FLOATING_BUTTON_BOTTOM, FLOATING_BUTTON_SIZE } from "@/components/floating-layout";
import { usePttRecorder } from "./use-ptt-recorder";

const LABEL_BY_STATUS: Record<string, string> = {
  idle: "🎙️",
  preparing: "…",
  recording: "⏹",
  stopping: "…",
  uploading: "…",
  transcribing: "…",
  done: "✓",
  failed: "!",
};

// Mounted next to QuickAddFab in the root layout -- a second, equally
// global entry point into the same capture pipeline, per Checkpoint 4's
// scope. Deliberately has zero dependency on the Rabbit side button (see
// use-ptt-recorder.ts); a plain tap is the entire interaction, so the app
// works identically on a normal Android phone with no hardware wheel/button
// at all.
export function PttButton({ layoutOnly = false }: { layoutOnly?: boolean } = {}) {
  // Deliberately a component split, not a flag threaded through the hook:
  // usePttRecorder calls useAudioRecorder at mount, which instantiates a native
  // expo-audio recorder. The UI-test build ships no expo-audio config plugin
  // and therefore no RECORD_AUDIO permission, so layout-only mode must never
  // reach that hook at all -- only then is the button genuinely inert.
  if (layoutOnly) return <PttButtonLayoutOnly />;
  return <PttButtonLive />;
}

// Real geometry and idle styling, no recorder, no permission, no-op on tap --
// so FAB/PTT clearance can be verified on hardware without granting the
// layout-verification build a microphone.
function PttButtonLayoutOnly() {
  return (
    <View className={`absolute ${FLOATING_BUTTON_BOTTOM} left-6 items-start`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Push to talk (layout only)"
        accessibilityState={{ disabled: true }}
        disabled
        className={`${FLOATING_BUTTON_SIZE} items-center justify-center rounded-full bg-neutral-700 shadow-lg`}
      >
        <Text className="text-2xl">{LABEL_BY_STATUS["idle"]}</Text>
      </Pressable>
    </View>
  );
}

// The accessible name reflects live state (6.7A, AX5): the glyph and color
// change with status, but a screen reader previously always heard the static
// "Push to talk" -- no way to tell the button was recording, busy or failed.
// Same pattern as QuickAddFab's fabAccessibilityLabel.
function pttAccessibilityLabel(status: string, canRetry: boolean): string {
  switch (status) {
    case "recording":
      return "Push to talk, recording. Tap to stop.";
    case "preparing":
    case "stopping":
    case "uploading":
    case "transcribing":
      return "Push to talk, busy.";
    case "done":
      return "Push to talk, capture sent. Tap to record again.";
    case "failed":
      return canRetry
        ? "Push to talk, failed. Tap to retry."
        : "Push to talk, failed. Tap to dismiss.";
    default:
      return "Push to talk";
  }
}

function PttButtonLive() {
  const ptt = usePttRecorder();
  const busy =
    ptt.status === "preparing" ||
    ptt.status === "stopping" ||
    ptt.status === "uploading" ||
    ptt.status === "transcribing";

  const onPress = () => {
    if (ptt.status === "idle" || ptt.status === "done") {
      void ptt.startRecording();
    } else if (ptt.status === "recording") {
      void ptt.stopRecording();
    } else if (ptt.status === "failed") {
      if (ptt.canRetry) void ptt.retryUpload();
      else ptt.dismiss();
    }
  };

  const bg =
    ptt.status === "recording"
      ? "bg-red-600 active:bg-red-700"
      : ptt.status === "failed"
        ? "bg-red-500 active:bg-red-600"
        : ptt.status === "done"
          ? "bg-green-600"
          : "bg-neutral-700 active:bg-neutral-800";

  return (
    // Offset and size come from components/floating-layout.ts, shared with
    // QuickAddFab and with every scroll container's bottom padding.
    <View className={`absolute ${FLOATING_BUTTON_BOTTOM} left-6 items-start`}>
      <Pressable
        onPress={onPress}
        disabled={busy}
        className={`${FLOATING_BUTTON_SIZE} items-center justify-center rounded-full shadow-lg ${bg}`}
        accessibilityRole="button"
        accessibilityLabel={pttAccessibilityLabel(ptt.status, ptt.canRetry)}
      >
        <Text className="text-2xl">{LABEL_BY_STATUS[ptt.status]}</Text>
      </Pressable>
      {ptt.status === "recording" ? (
        <Text className="mt-1 text-xs text-red-600">
          Recording {(ptt.durationMillis / 1000).toFixed(0)}s -- tap to stop
        </Text>
      ) : null}
      {ptt.status === "uploading" ? (
        <Text className="mt-1 text-xs text-neutral-500">Uploading...</Text>
      ) : null}
      {ptt.status === "transcribing" ? (
        <Text className="mt-1 text-xs text-neutral-500">Transcribing...</Text>
      ) : null}
      {ptt.status === "failed" ? (
        <Text className="mt-1 max-w-[140px] text-xs text-red-600">
          {ptt.error ?? "Failed"} ({ptt.canRetry ? "tap to retry" : "tap to dismiss"})
        </Text>
      ) : null}
    </View>
  );
}
