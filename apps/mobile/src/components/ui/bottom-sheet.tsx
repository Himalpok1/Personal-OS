// A bottom sheet (Checkpoint 10.6): the surface the Quick Capture composer
// has drawn by hand since Phase 2 -- a transparent Modal, a dimmed backdrop,
// a rounded card anchored to the bottom with a drag handle and a title --
// extracted so a context sheet, a picker and the composer share one frame.
//
// Motion: the backdrop fades and the sheet slides up over the `slow`
// duration; on close the same runs in reverse and the Modal is hidden only
// when the exit has finished (Reanimated's callback, run on JS), so the
// sheet never blinks out. Under reduced motion both durations are zero --
// open and closed are the same states, reached instantly. On web the same
// Modal renders (react-native-web ships one) and the slide is a cheap
// transform, so it stays on.
//
// The scrim is `bg-black/40`, the documented raw-colour exception the
// composer already carried; it sits on a class-styled Pressable INSIDE the
// fading animated layer, since an animated node takes no className.
//
// `BottomSheet` is the animated leaf (it holds React state for the exit);
// `SheetFrame` and `SheetRow` are hookless and are what the tests render.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton } from "./button";
import { type IconName } from "./icon";
import { ListRow } from "./list-row";
import { DURATION, useMotionEnabled } from "./motion";
import type { ChipTone } from "./status-chip";
import { AppText } from "./text";

/** The offscreen distance a sheet slides from before its height is measured. */
export const SHEET_FALLBACK_HEIGHT = 600;

/**
 * Pure: the sheet's vertical offset for a progress in [0, 1]. Marked a
 * worklet because the animated style below runs on the UI runtime, where a
 * plain JS function is a "remote function" and calling it synchronously is a
 * fatal native error (`[Worklets] Tried to synchronously call a Remote
 * Function`) -- the versionCode-30 build crashed on launch exactly this way
 * (Checkpoint 10.6). The style worklet still inlines the arithmetic rather
 * than calling out at all; this directive is belt-and-braces for any future
 * caller.
 */
export function sheetTranslateY(progress: number, height: number): number {
  "worklet";
  return (1 - progress) * height;
}

/** Pure: how long each phase takes, given the motion decision. */
export function sheetDurations(motion: boolean): { open: number; close: number } {
  return motion ? { open: DURATION.slow, close: DURATION.base } : { open: 0, close: 0 };
}

export interface SheetFrameProps {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  /** The bottom safe-area inset (or the keyboard height, when it is up). */
  bottomInset?: number;
  /** Hide the close button (the composer draws its own Cancel). */
  hideClose?: boolean;
  testID?: string;
}

/** The hookless sheet surface: handle, optional title row, content. */
export function SheetFrame({
  title,
  onClose,
  children,
  bottomInset = 0,
  hideClose = false,
  testID,
}: SheetFrameProps) {
  return (
    <View
      className="rounded-t-card bg-surface px-4 pt-2 dark:bg-surface-dark"
      style={{ paddingBottom: 16 + bottomInset }}
      accessibilityViewIsModal
      testID={testID}
    >
      {/* The drag handle: a visual cue that this is a sheet (swipe-to-dismiss
          is not wired; the backdrop and the close button dismiss it). */}
      <View className="mb-3 h-1 w-10 self-center rounded-full bg-outline-strong dark:bg-outline-strong-dark" />
      {title || !hideClose ? (
        <View className="mb-2 flex-row items-center justify-between gap-3">
          {title ? (
            <AppText
              variant="title"
              accessibilityRole="header"
              className="flex-1"
              numberOfLines={1}
            >
              {title}
            </AppText>
          ) : (
            <View className="flex-1" />
          )}
          {hideClose ? null : (
            <IconButton
              icon="close"
              onPress={onClose}
              accessibilityLabel="Close"
              tone="on-surface-variant"
            />
          )}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export interface SheetRowProps {
  icon: IconName;
  label: string;
  /** A second line under the label. */
  subtitle?: string;
  tone?: ChipTone;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  last?: boolean;
  testID?: string;
}

/** One action in a sheet: an icon disc and a label, 52px, inset divider. */
export function SheetRow({
  icon,
  label,
  subtitle,
  tone = "neutral",
  onPress,
  accessibilityLabel,
  disabled,
  last = false,
  testID,
}: SheetRowProps) {
  return (
    <ListRow
      title={label}
      subtitle={subtitle}
      icon={icon}
      iconTone={tone}
      titleTone={tone === "danger" ? "danger" : "default"}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      inset
      last={last}
      testID={testID}
    />
  );
}

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Extra bottom padding while the keyboard is up (replaces the safe inset then). */
  keyboardHeight?: number;
  /** Tap on the backdrop closes the sheet. On by default. */
  dismissOnBackdrop?: boolean;
  hideClose?: boolean;
  testID?: string;
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  keyboardHeight = 0,
  dismissOnBackdrop = true,
  hideClose = false,
  testID,
}: BottomSheetProps) {
  const motion = useMotionEnabled("cheap");
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const [height, setHeight] = useState(SHEET_FALLBACK_HEIGHT);
  // The Modal stays mounted through the exit animation: `closing` lags `open`
  // by one close transition, and clears from the timing's own callback.
  const [closing, setClosing] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    const durations = sheetDurations(motion);
    if (open) {
      wasOpen.current = true;
      setClosing(false);
      progress.set(
        withTiming(1, {
          duration: durations.open,
          easing: Easing.out(Easing.cubic),
        }),
      );
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    setClosing(true);
    progress.set(
      withTiming(0, { duration: durations.close, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(setClosing)(false);
      }),
    );
  }, [motion, open, progress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  // Inlined `sheetTranslateY`: a worklet must not call into a JS-thread
  // function (see that helper's comment); `height` is captured by value.
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.get()) * height }],
  }));

  const mounted = open || closing;
  if (!mounted) return null;

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = Math.ceil(event.nativeEvent.layout.height);
    if (measured > 0 && measured !== height) setHeight(measured);
  };

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
      testID={testID}
    >
      <View className="flex-1 justify-end" style={{ paddingBottom: keyboardHeight }}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable
            onPress={dismissOnBackdrop ? onClose : undefined}
            accessibilityRole={dismissOnBackdrop ? "button" : undefined}
            accessibilityLabel={dismissOnBackdrop ? "Close" : undefined}
            className="flex-1 bg-black/40"
            testID={testID ? `${testID}-backdrop` : undefined}
          />
        </Animated.View>
        <Animated.View style={sheetStyle} onLayout={onLayout}>
          <SheetFrame
            title={title}
            onClose={onClose}
            bottomInset={keyboardHeight > 0 ? 0 : insets.bottom}
            hideClose={hideClose}
            testID={testID ? `${testID}-frame` : undefined}
          >
            {children}
          </SheetFrame>
        </Animated.View>
      </View>
    </Modal>
  );
}
