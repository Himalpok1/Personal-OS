// The completion circle (Checkpoint 10.6): the icon-only control that marks
// a task or occurrence done, sitting in a `ListRow`'s `leading` slot.
//
// It replaces the circle Today and Agenda each drew by hand (the project
// screen's own circle is unchanged, a recorded 10.6 leftover): the same three states (`open` ring, `pending` slice while the
// mutation is in flight, `done` filled check), the same two glyphs Today
// used, the same 44px target, and the same two rules that let it live inside
// a pressable row -- the tap stops propagating so the row's own `onPress`
// (navigate) does not also fire, and the row must be marked
// `containsControl` so it drops its button role (no `<button>` inside a
// `<button>` on web).
//
// On the tap that completes it fires the success haptic, decided by the pure
// `completionHaptic` (never on a pending or already-done circle), and the
// glyph springs to 120% and back when the state lands on `done` --
// `CompletionGlyph` is the animated leaf; the control itself is hookless so
// the tree-walking tests can invoke it and treat the glyph as a host.
import { useEffect, useRef } from "react";
import { Pressable, type GestureResponderEvent } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from "react-native-reanimated";
import { triggerHaptic, type HapticKind } from "./haptics";
import { Icon, type IconName, type IconSize } from "./icon";
import { SPRING, useMotionEnabled } from "./motion";
import type { ColorRole } from "./theme";

export type CompletionState = "open" | "pending" | "done";
export type CompletionTone = "primary" | "success";
export type CompletionSize = "md" | "lg";

/** The glyph per state -- the two Today used, plus the filled check. */
export function completionCircleIcon(state: CompletionState): IconName {
  switch (state) {
    case "open":
      return "checkbox-blank-circle-outline";
    case "pending":
      return "circle-slice-8";
    case "done":
      return "check-circle";
  }
}

/**
 * The glyph's colour role. The open ring is `on-surface-variant`, not
 * `outline-strong`: it is the control's only visual boundary and must clear
 * 3:1 (the 10.3 review).
 */
export function completionCircleTone(state: CompletionState, tone: CompletionTone): ColorRole {
  if (state === "open") return "on-surface-variant";
  return tone;
}

/** The haptic a tap fires: success on the tap that completes, nothing otherwise. */
export function completionHaptic(state: CompletionState): HapticKind | null {
  return state === "open" ? "success" : null;
}

const GLYPH_SIZE: Record<CompletionSize, IconSize> = { md: "lg", lg: "xl" };

export interface CompletionCircleProps {
  state: CompletionState;
  /** The filled colour once done (and the pending slice). */
  tone?: CompletionTone;
  size?: CompletionSize;
  onPress: () => void;
  /** "Complete <title>" / "Reopen <title>" -- the control is icon-only, so this is its whole name. */
  accessibilityLabel: string;
  testID?: string;
}

export function CompletionCircle({
  state,
  tone = "primary",
  size = "md",
  onPress,
  accessibilityLabel,
  testID,
}: CompletionCircleProps) {
  const pending = state === "pending";
  return (
    <Pressable
      onPress={(event: GestureResponderEvent) => {
        // The row this sits in has its own onPress (navigate). On native the
        // responder already grants to this inner view; under react-native-web
        // Pressable maps to bubbling DOM events, so the guard is load-bearing
        // there (the day-cell precedent).
        event.stopPropagation();
        if (pending) return;
        const kind = completionHaptic(state);
        if (kind) triggerHaptic(kind);
        onPress();
      }}
      // Without this the pending state only drew the slice -- the circle
      // stayed tappable and rapid taps fired concurrent mutations (6.7A, A1).
      disabled={pending}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: pending, busy: pending, checked: state === "done" }}
      className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
      testID={testID}
    >
      <CompletionGlyph state={state} tone={tone} size={size} />
    </Pressable>
  );
}

/**
 * The animated leaf: springs to 120% and back on the transition INTO
 * `done` (never on mount, so a list of finished items does not bounce as it
 * appears). Uses a React ref and effect, so tests list it as a host type.
 */
export function CompletionGlyph({
  state,
  tone,
  size,
}: {
  state: CompletionState;
  tone: CompletionTone;
  size: CompletionSize;
}) {
  const motion = useMotionEnabled("cheap");
  const scale = useSharedValue(1);
  const previous = useRef(state);
  useEffect(() => {
    const landed = state === "done" && previous.current !== "done";
    previous.current = state;
    if (landed && motion) {
      scale.set(withSequence(withSpring(1.2, SPRING.settle), withSpring(1, SPRING.settle)));
    }
  }, [motion, scale, state]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <Animated.View style={animatedStyle} pointerEvents="none">
      <Icon
        name={completionCircleIcon(state)}
        size={GLYPH_SIZE[size]}
        tone={completionCircleTone(state, tone)}
      />
    </Animated.View>
  );
}
