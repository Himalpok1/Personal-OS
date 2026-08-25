import { useState } from "react";
import { randomUUID } from "expo-crypto";
import { Alert, Modal, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { getOutboxStats } from "@/outbox/queue";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { useCapture } from "@/queries/capture";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import {
  FLOATING_BUTTON_BOTTOM,
  FLOATING_BUTTON_BOTTOM_PX,
  FLOATING_BUTTON_SIDE_INSET_PX,
  FLOATING_BUTTON_SIZE,
  FLOATING_BUTTON_SIZE_PX,
} from "@/components/floating-layout";

// Mounted once in the root layout (per decision 5: quick-add is global, not
// embedded on a single tab) so it's reachable from every screen -- Tasks,
// Inbox, Notes, and Projects alike.
// Captures made while the API is unreachable are persisted to the outbox and
// flushed later. Until Checkpoint 5.6 the only place that backlog was visible
// was the Settings screen, so an offline user saw a single transient "Saved
// offline" alert and then nothing at all -- no way to tell whether anything was
// still waiting.
//
// EVENT-DRIVEN, NOT POLLED. This first shipped with settings.tsx's
// `refetchInterval: 5000`, which is fine for a screen you open briefly but not
// for a component mounted over EVERY screen: on the physical Rabbit R1 that
// 5-second SQLite round-trip starved the JS thread badly enough that the app
// stopped responding to taps entirely after a few seconds. Verified on-device
// by bisection -- polling disabled, navigation worked; polling restored, it
// froze again.
//
// Freshness instead comes from invalidation of the ["outbox"] key, which
// already happens on every capture (queries/capture.ts) and on every flush
// (outbox/use-outbox-flush-on-reconnect.ts) -- i.e. at exactly the two moments
// the count can actually change.
function useOutboxBadge(): { pending: number; failed: number } {
  const { data } = useQuery({
    queryKey: ["outbox", "stats"],
    queryFn: getOutboxStats,
  });
  return { pending: data?.pending ?? 0, failed: data?.failed ?? 0 };
}

export function QuickAddFab() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const keyboardHeight = useKeyboardHeight();
  const placeholderColor = usePlaceholderColor();
  const capture = useCapture();
  const outbox = useOutboxBadge();

  // The badge beside the FAB carries pending/failed counts visually, but the
  // FAB itself is the only focusable element here (the badge is
  // pointerEvents="none" and non-accessible) -- so its own accessible name
  // must say what the badge shows, not just "Quick add".
  const fabAccessibilityLabel =
    outbox.failed > 0
      ? `Quick add, ${outbox.failed} ${outbox.failed === 1 ? "capture needs" : "captures need"} attention`
      : outbox.pending > 0
        ? `Quick add, ${outbox.pending} ${outbox.pending === 1 ? "capture" : "captures"} waiting to send`
        : "Quick add";

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    capture.mutate(
      {
        text: trimmed,
        // NOT a platform tag. `source` is an ENTRY-PATH vocabulary
        // (siri|ptt|web|share|assistant), fixed by CaptureSourceSchema and by
        // the inbox_items_source CHECK constraint. "web" denotes the in-app
        // Quick Capture sheet on EVERY platform -- native Android included --
        // and is the correct value here. There is deliberately no "app"
        // member: adding one is a CHECK-constraint change, i.e. a migration.
        // See docs/ARCHITECTURE.md's capture section.
        source: "web",
        client_uuid: randomUUID(),
        captured_at: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      {
        onSuccess: (result) => {
          setText("");
          setOpen(false);
          if (result.status === "queued") {
            // Best-effort: the outbox already persisted it to SQLite and
            // will flush automatically on reconnect (see
            // use-outbox-flush-on-reconnect.ts) -- this alert is purely
            // informational, not a retry affordance.
            Alert.alert(
              "Saved offline",
              "This will be sent automatically once you're back online.",
            );
          }
        },
      },
    );
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        // Mounted globally, above the tab navigator, so it renders on every
        // screen including tab screens with their own bottom tab bar. Offset
        // and size come from components/floating-layout.ts, shared with
        // PttButton and with every scroll container's bottom padding -- see
        // that file for why the old bottom-40 was wrong.
        className={`absolute ${FLOATING_BUTTON_BOTTOM} right-6 ${FLOATING_BUTTON_SIZE} items-center justify-center rounded-full bg-blue-600 shadow-lg active:bg-blue-700`}
        accessibilityLabel={fabAccessibilityLabel}
      >
        <Text className="text-2xl font-bold text-white">+</Text>
      </Pressable>

      {/* Amber for a retryable backlog, red once something has permanently
          failed and needs attention -- matching the two counts the outbox
          itself distinguishes (see outbox/queue.ts's permanent-vs-transient
          classification). pointerEvents none so it can never steal the tap. */}
      {outbox.pending > 0 || outbox.failed > 0 ? (
        <View
          pointerEvents="none"
          // The count is folded into the FAB's own accessibilityLabel above,
          // so this must be structurally excluded rather than merely
          // unlabelled: `pointerEvents` governs touch dispatch, not the
          // accessibility tree, and a bare <Text> stays discoverable on its
          // own. Without these two props a screen reader lands on a
          // context-free "3" next to the button.
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          className={`absolute h-6 min-w-[24px] items-center justify-center rounded-full px-1 ${
            outbox.failed > 0 ? "bg-red-600" : "bg-amber-500"
          }`}
          // Pinned to the button's top-right corner, computed from the shared
          // geometry rather than a hand-tuned offset.
          style={{
            bottom: FLOATING_BUTTON_BOTTOM_PX + FLOATING_BUTTON_SIZE_PX - 12,
            right: FLOATING_BUTTON_SIDE_INSET_PX - 6,
          }}
        >
          <Text className="text-xs font-bold text-white">
            {outbox.failed > 0 ? outbox.failed : outbox.pending}
          </Text>
        </View>
      ) : null}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end bg-black/40" style={{ paddingBottom: keyboardHeight }}>
          {/* The bottom safe-area inset only applies when the keyboard is
              down; with it up, the keyboard already occupies that space. */}
          <SafeAreaView
            edges={keyboardHeight > 0 ? [] : ["bottom"]}
            className="rounded-t-2xl bg-white dark:bg-neutral-900"
          >
            <View className="p-4">
              <Text className="mb-2 text-lg font-semibold text-black dark:text-white">
                Quick capture
              </Text>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Remind me to... / Idea: ... / Meeting tomorrow at..."
                placeholderTextColor={placeholderColor}
                multiline
                autoFocus
                className="min-h-[80px] rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
              />
              {capture.isError ? (
                <Text className="mt-2 text-red-600">
                  Couldn&apos;t save that -- check your connection and try again.
                </Text>
              ) : null}
              <View className="mt-3 flex-row justify-end gap-2">
                <Pressable
                  onPress={() => setOpen(false)}
                  className="min-h-[44px] justify-center rounded-lg px-4 py-2"
                  accessibilityRole="button"
                  accessibilityLabel="Cancel this capture"
                  disabled={capture.isPending}
                >
                  <Text className="text-neutral-500">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={submit}
                  className="min-h-[44px] justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
                  accessibilityRole="button"
                  accessibilityLabel="Capture this note"
                  disabled={capture.isPending || text.trim().length === 0}
                >
                  <Text className="font-semibold text-white">
                    {capture.isPending ? "Saving..." : "Capture"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}
