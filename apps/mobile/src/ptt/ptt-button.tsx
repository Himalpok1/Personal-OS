import { Pressable, Text, View } from "react-native";
import { usePttRecorder } from "./use-ptt-recorder";

const LABEL_BY_STATUS: Record<string, string> = {
  idle: "🎙️",
  recording: "⏹",
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
export function PttButton() {
  const ptt = usePttRecorder();
  const busy = ptt.status === "uploading" || ptt.status === "transcribing";

  const onPress = () => {
    if (ptt.status === "idle" || ptt.status === "done") {
      void ptt.startRecording();
    } else if (ptt.status === "recording") {
      void ptt.stopRecording();
    } else if (ptt.status === "failed") {
      ptt.dismiss();
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
    // bottom-40, matching QuickAddFab's rationale -- clears both the tab
    // bar and the Tasks tab's own "New task" button on small screens like
    // the R1 instead of rendering on top of them.
    <View className="absolute bottom-40 left-6 items-start">
      <Pressable
        onPress={onPress}
        disabled={busy}
        className={`h-14 w-14 items-center justify-center rounded-full shadow-lg ${bg}`}
        accessibilityLabel="Push to talk"
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
          {ptt.error ?? "Failed"} (tap to dismiss)
        </Text>
      ) : null}
    </View>
  );
}
