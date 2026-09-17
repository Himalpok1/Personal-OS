import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, View } from "react-native";
import { FLOATING_BUTTON_BOTTOM, FLOATING_BUTTON_SIZE } from "@/components/floating-layout";
import { AppText, Icon, useTheme, type IconName } from "@/components/ui";
import { usePttRecorder } from "./use-ptt-recorder";

/**
 * The glyph for each recorder status (Checkpoint 10.3: an icon by role, not
 * an emoji). A `null` glyph means the button shows an activity indicator
 * instead -- every in-between state (preparing, stopping, uploading,
 * transcribing) is "busy", and a spinner says so without a fourth glyph.
 */
export const ICON_BY_STATUS: Record<string, IconName | null> = {
  idle: "microphone",
  preparing: null,
  recording: "stop",
  stopping: null,
  uploading: null,
  transcribing: null,
  done: "check",
  failed: "alert",
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

// The idle circle: a raised surface with a strong outline, so it reads as a
// control beside the primary-coloured QuickAddFab without competing with it.
const IDLE_CLASS =
  "border border-outline-strong bg-surface-raised shadow-card dark:border-outline-strong-dark dark:bg-surface-raised-dark dark:shadow-none";

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
        className={`${FLOATING_BUTTON_SIZE} items-center justify-center rounded-full ${IDLE_CLASS}`}
      >
        <Icon name={ICON_BY_STATUS["idle"]!} size="lg" tone="on-surface" />
      </Pressable>
    </View>
  );
}

// The accessible name reflects live state (6.7A, AX5): the glyph and color
// change with status, but a screen reader previously always heard the static
// "Push to talk" -- no way to tell the button was recording, busy or failed.
// Same pattern as QuickAddFab's fabAccessibilityLabel.
export function pttAccessibilityLabel(status: string, canRetry: boolean): string {
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

/**
 * A ring that breathes behind the button while recording. React Native's
 * own `Animated` (opacity loop on the native driver) -- the same mechanism
 * the design system's skeletons use, so no worklet, no babel plugin, runs on
 * web and is inert under vitest. Styled through `style`: `Animated.View` is
 * not one of the components NativeWind's interop wraps.
 */
function RecordingRing({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(0.2)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.2,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: -6,
        left: -6,
        right: -6,
        bottom: -6,
        borderRadius: 999,
        borderWidth: 3,
        borderColor: color,
        opacity,
      }}
    />
  );
}

function PttButtonLive() {
  const ptt = usePttRecorder();
  const { colors } = useTheme();
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

  // Recording and failed both fill with the danger colour -- one is "live",
  // the other "needs you" -- distinguished by the glyph (stop vs alert), the
  // pulsing ring (recording only) and the spoken label, never by colour
  // alone. Done fills green for the one moment it says "sent".
  const fill =
    ptt.status === "recording" || ptt.status === "failed"
      ? "bg-danger active:opacity-90 dark:bg-danger-dark"
      : ptt.status === "done"
        ? "bg-success dark:bg-success-dark"
        : IDLE_CLASS;
  const onFill = ptt.status === "idle" || busy ? "on-surface" : "on-primary";
  const glyph = ICON_BY_STATUS[ptt.status] ?? null;

  return (
    // Offset and size come from components/floating-layout.ts, shared with
    // QuickAddFab and with every scroll container's bottom padding.
    <View className={`absolute ${FLOATING_BUTTON_BOTTOM} left-6 items-start`}>
      <View className={FLOATING_BUTTON_SIZE}>
        {ptt.status === "recording" ? <RecordingRing color={colors.danger} /> : null}
        <Pressable
          onPress={onPress}
          disabled={busy}
          className={`${FLOATING_BUTTON_SIZE} items-center justify-center rounded-full ${fill}`}
          accessibilityRole="button"
          accessibilityLabel={pttAccessibilityLabel(ptt.status, ptt.canRetry)}
          accessibilityState={{ disabled: busy, busy }}
        >
          {glyph === null ? (
            <ActivityIndicator size="small" color={colors[onFill]} />
          ) : (
            <Icon name={glyph} size="lg" tone={onFill} />
          )}
        </Pressable>
      </View>
      {ptt.status === "recording" ? (
        <AppText variant="caption" tone="danger" className="mt-1">
          Recording {(ptt.durationMillis / 1000).toFixed(0)}s -- tap to stop
        </AppText>
      ) : null}
      {ptt.status === "uploading" ? (
        <AppText variant="caption" tone="muted" className="mt-1">
          Uploading...
        </AppText>
      ) : null}
      {ptt.status === "transcribing" ? (
        <AppText variant="caption" tone="muted" className="mt-1">
          Transcribing...
        </AppText>
      ) : null}
      {ptt.status === "failed" ? (
        <AppText variant="caption" tone="danger" className="mt-1 max-w-[140px]">
          {ptt.error ?? "Failed"} ({ptt.canRetry ? "tap to retry" : "tap to dismiss"})
        </AppText>
      ) : null}
    </View>
  );
}
