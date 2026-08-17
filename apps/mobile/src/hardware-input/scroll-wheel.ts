import { useEffect, useRef } from "react";
import { DeviceEventEmitter } from "react-native";

export type ScrollDirection = "up" | "down";

interface HardwareScrollWheelEvent {
  direction: ScrollDirection;
  timestamp: number;
}

// The Rabbit R1's scroll wheel is a high-resolution encoder: a single
// perceptible finger-rotation fires 8-12 raw KEYCODE_DPAD_UP/DOWN events,
// ~50-140ms apart (confirmed via direct `adb getevent` capture against the
// actual unit during Phase 3 planning, and re-confirmed through this exact
// hook during the Checkpoint 3 hardware spike). Coalescing that burst into
// one logical "scroll" call is this hook's whole job -- callers never see
// the raw per-event noise.
const COALESCE_WINDOW_MS = 200;

// A no-op on every device without this hardware: "HardwareScrollWheelEvent"
// is only ever emitted by the native bridge (see
// plugins/withHardwareInputBridge.ts) for these exact key codes, which
// never fire on a normal phone -- this hook simply never calls back there.
// Screens use this hook directly; nothing outside apps/mobile/src/hardware-input
// should ever check Platform/device model or reference Rabbit-specific
// concepts itself.
export function useScrollWheel(onScroll: (direction: ScrollDirection) => void): void {
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  useEffect(() => {
    let pendingDirection: ScrollDirection | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (pendingDirection) onScrollRef.current(pendingDirection);
      pendingDirection = null;
      timer = null;
    };

    const subscription = DeviceEventEmitter.addListener(
      "HardwareScrollWheelEvent",
      (event: HardwareScrollWheelEvent) => {
        if (pendingDirection && pendingDirection !== event.direction) {
          // Direction reversed mid-burst -- flush what settled before the
          // reversal rather than merging two opposite gestures into one.
          flush();
        }
        pendingDirection = event.direction;
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, COALESCE_WINDOW_MS);
      },
    );

    return () => {
      subscription.remove();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
