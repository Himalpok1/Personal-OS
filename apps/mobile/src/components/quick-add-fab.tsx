import { useState } from "react";
import { randomUUID } from "expo-crypto";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCapture } from "@/queries/capture";

// Mounted once in the root layout (per decision 5: quick-add is global, not
// embedded on a single tab) so it's reachable from every screen -- Tasks,
// Inbox, Notes, and Projects alike.
export function QuickAddFab() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const capture = useCapture();

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    capture.mutate(
      {
        text: trimmed,
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
            Alert.alert("Saved offline", "This will be sent automatically once you're back online.");
          }
        },
      },
    );
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        // bottom-40 (not bottom-6) -- this button is mounted globally,
        // above the tab navigator, so it renders on every screen including
        // tab screens with their own bottom tab bar. On the R1's 640px-tall
        // screen the tab bar alone takes up close to a fifth of the height,
        // and the Tasks tab additionally has its own flow-positioned "New
        // task" button sitting just above that tab bar -- bottom-40 clears
        // both, verified live on the physical device.
        className="absolute bottom-40 right-6 h-14 w-14 items-center justify-center rounded-full bg-blue-600 shadow-lg active:bg-blue-700"
        accessibilityLabel="Quick add"
      >
        <Text className="text-2xl font-bold text-white">+</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <View className="flex-1 justify-end bg-black/40">
            <SafeAreaView edges={["bottom"]} className="rounded-t-2xl bg-white dark:bg-neutral-900">
              <View className="p-4">
                <Text className="mb-2 text-lg font-semibold text-black dark:text-white">
                  Quick capture
                </Text>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder="Remind me to... / Idea: ... / Meeting tomorrow at..."
                  placeholderTextColor="#888"
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
                    className="rounded-lg px-4 py-2"
                    disabled={capture.isPending}
                  >
                    <Text className="text-neutral-500">Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={submit}
                    className="rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
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
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
