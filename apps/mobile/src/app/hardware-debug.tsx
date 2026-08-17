// Not part of primary navigation -- reachable directly at /hardware-debug.
// Built for the Checkpoint 3 Rabbit R1 hardware spike (verifying the
// scroll-wheel bridge and the KEY_POWER dispatchKeyEvent question through
// the real native bridge, not just raw `adb getevent` output) and kept
// afterward as a standing diagnostic for any future hardware-input work.
import { useEffect, useState } from "react";
import { DeviceEventEmitter, SafeAreaView, ScrollView, Text, View } from "react-native";
import { useScrollWheel, type ScrollDirection } from "@/hardware-input";

interface RawEvent {
  label: string;
  detail: string;
  at: string;
}

export default function HardwareDebugScreen() {
  const [rawCount, setRawCount] = useState(0);
  const [coalescedCount, setCoalescedCount] = useState(0);
  const [lastCoalesced, setLastCoalesced] = useState<ScrollDirection | null>(null);
  const [sideButtonEvents, setSideButtonEvents] = useState<RawEvent[]>([]);
  const [log, setLog] = useState<RawEvent[]>([]);

  // The real, coalesced hook every screen would actually use.
  useScrollWheel((direction) => {
    setCoalescedCount((n) => n + 1);
    setLastCoalesced(direction);
  });

  // Raw listeners, for comparison against the coalesced count above and to
  // observe the side button directly -- debug-only, bypassing the
  // hardware-input abstraction on purpose.
  useEffect(() => {
    const scroll = DeviceEventEmitter.addListener(
      "HardwareScrollWheelEvent",
      (event: { direction: ScrollDirection; timestamp: number }) => {
        setRawCount((n) => n + 1);
        setLog((entries) =>
          [
            {
              label: "scroll (raw)",
              detail: event.direction,
              at: new Date().toLocaleTimeString(),
            },
            ...entries,
          ].slice(0, 20),
        );
      },
    );

    const sideButton = DeviceEventEmitter.addListener(
      "HardwareSideButtonEvent",
      (event: { action: "down" | "up"; timestamp: number }) => {
        const entry = { label: "side button", detail: event.action, at: new Date().toLocaleTimeString() };
        setSideButtonEvents((entries) => [entry, ...entries].slice(0, 20));
        setLog((entries) => [entry, ...entries].slice(0, 20));
      },
    );

    return () => {
      scroll.remove();
      sideButton.remove();
    };
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <ScrollView className="flex-1 px-4 py-4">
        <Text className="mb-4 text-xl font-bold text-black dark:text-white">Hardware spike</Text>

        <View className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
          <Text className="font-bold text-black dark:text-white">Scroll wheel</Text>
          <Text className="text-black dark:text-white">Raw KEYCODE_DPAD events: {rawCount}</Text>
          <Text className="text-black dark:text-white">
            Coalesced scroll calls: {coalescedCount} (last: {lastCoalesced ?? "none yet"})
          </Text>
        </View>

        <View className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
          <Text className="font-bold text-black dark:text-white">Side button (KEY_POWER)</Text>
          <Text className="text-black dark:text-white">
            {sideButtonEvents.length === 0
              ? "No HardwareSideButtonEvent received yet -- press the side button now"
              : `${sideButtonEvents.length} event(s) received -- dispatchKeyEvent IS reached`}
          </Text>
        </View>

        <Text className="mb-2 font-bold text-black dark:text-white">Event log</Text>
        {log.map((entry, index) => (
          <Text key={index} className="text-xs text-neutral-500">
            {entry.at} — {entry.label}: {entry.detail}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
