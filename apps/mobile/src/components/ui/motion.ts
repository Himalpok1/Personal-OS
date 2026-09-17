// Motion vocabulary (Checkpoint 10.6).
//
// Three durations, two springs, three entering/layout presets -- the whole
// closed set every animated primitive draws from, so a press on Today and a
// press on Settings settle with the same feel. Nothing here animates by
// itself; it is the numbers the primitives (`PressableScale`,
// `CompletionCircle`, `Toast`, `BottomSheet`, `AnimatedNumber`) share.
//
// THE RULE: MOTION NEVER BLOCKS. A user who has asked the OS for reduced
// motion gets the same END STATE, instantly -- a completed circle is filled,
// a toast is on screen, a sheet is open -- and the same handlers fire at the
// same moments. `useMotionEnabled` is how a primitive asks; Reanimated's own
// animations already honour the system setting (`ReduceMotion.System` is
// every builder's default), so the hook exists for the JS-side choices: which
// component to render, whether to render a plain Text instead of a counter.
import { Platform } from "react-native";
import {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useReducedMotion,
} from "react-native-reanimated";

/** Milliseconds. `fast` for feedback, `base` for enter/exit, `slow` for a sheet. */
export const DURATION = { fast: 150, base: 220, slow: 320 } as const;

/** Spring configs for `withSpring`. `press` snaps; `settle` overshoots a touch and lands. */
export const SPRING = {
  press: { damping: 18, stiffness: 260 },
  settle: { damping: 14, stiffness: 180 },
} as const;

/** The press-scale target: 3% is felt on the Rabbit R1's 480px, never seen as a jump. */
export const PRESS_SCALE = 0.97;

export type MotionCost = "cheap" | "rich";

/**
 * Pure decision: is motion of this cost on, given the OS setting and the
 * platform? Reduced motion turns everything off. On web, `rich` motion --
 * a per-frame spring on a pressable, a counting number -- is turned off
 * too: Reanimated drives it from JS there and the browser is not the daily
 * driver; `cheap` motion (an entering fade, a sheet slide -- CSS-backed on
 * web) stays on.
 */
export function motionEnabled(input: {
  reducedMotion: boolean;
  platformOS: string;
  cost: MotionCost;
}): boolean {
  if (input.reducedMotion) return false;
  if (input.cost === "rich" && input.platformOS === "web") return false;
  return true;
}

/**
 * `motionEnabled` for the current device. Reanimated's `useReducedMotion`
 * reads the OS setting (and `prefers-reduced-motion` on web) once at mount.
 */
export function useMotionEnabled(cost: MotionCost = "rich"): boolean {
  const reducedMotion = useReducedMotion();
  return motionEnabled({ reducedMotion, platformOS: Platform.OS, cost });
}

// Entering / layout presets. Builders, not instances: each consumer's
// `entering={enterRise}` is built by Reanimated per mount, and each honours
// the system reduced-motion setting on its own.

/** Fade in over the base duration. */
export const enterFade = FadeIn.duration(DURATION.base);

/**
 * Fade in while rising -- for a row or card that has just appeared. The
 * BUILT-IN preset only, never `.withInitialValues(...)`: initial values turn
 * a preset into a custom keyframe, and Reanimated's web manager then
 * snapshots the element's position and pins it `position: absolute` after
 * the animation (layoutReanimation/web/componentUtils.ts), which collapses
 * every row of a web list onto one offset. A built-in name stays on the
 * plain CSS-animation path on web.
 */
export const enterRise = FadeInDown.duration(DURATION.base);

/** Fade out over the fast duration -- for a toast or row that is leaving. */
export const exitFade = FadeOut.duration(DURATION.fast);

/** A linear layout transition for a container whose children resize (a clamp toggle). */
export const layoutSettle = LinearTransition.duration(DURATION.base);
