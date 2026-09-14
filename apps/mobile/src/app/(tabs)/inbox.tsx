import type { InboxItem } from "@personal-os/schema";
import { FLOATING_CLEARANCE } from "@/components/floating-layout";
import { canConfirmInboxItem, confirmErrorMessage } from "@/components/inbox/confirm-state";
import { parseSummaryHeadline } from "@/components/inbox/parse-summary";
import { useConfirmInboxItem, useInbox } from "@/queries/inbox";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, SafeAreaView, Text, View } from "react-native";

const STATUS_LABEL: Record<InboxItem["status"], string> = {
  pending: "Parsing...",
  parsed: "Parsed",
  needs_confirm: "Needs confirmation",
  confirmed: "Confirmed",
  failed: "Failed",
};

function InboxRow({ item }: { item: InboxItem }) {
  const router = useRouter();
  const confirm = useConfirmInboxItem();
  const canConfirm = canConfirmInboxItem(item);
  const headline = parseSummaryHeadline(item);

  return (
    // The whole row opens /inbox/[id] (Checkpoint 9.3, contract 10). The
    // destination is built from the row's own server-authored id and nothing
    // else -- the text is displayed, never interpreted.
    <Pressable
      onPress={() => router.push(`/inbox/${item.id}` as Href)}
      accessibilityRole="button"
      accessibilityLabel="Open this capture"
      className="border-b border-neutral-200 px-4 py-3 active:bg-neutral-50 dark:border-neutral-800 dark:active:bg-neutral-900"
    >
      <Text className="text-base text-black dark:text-white" numberOfLines={3}>
        {item.raw_text !== null
          ? item.raw_text
          : item.status === "failed"
            ? "Transcription failed"
            : "Transcribing…"}
      </Text>
      <View className="mt-1 flex-row items-center justify-between">
        <Text className="text-xs text-neutral-500">
          {STATUS_LABEL[item.status]}
          {item.entity_type ? ` -> ${item.entity_type}` : ""}
        </Text>
        {canConfirm ? (
          <Pressable
            onPress={() => confirm.mutate({ id: item.id })}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Confirm this capture as parsed"
            className="min-h-[44px] items-center justify-center rounded bg-blue-100 px-2 dark:bg-blue-950"
            disabled={confirm.isPending}
          >
            <Text className="text-xs text-blue-700 dark:text-blue-300">
              {confirm.isPending ? "Confirming..." : "Confirm as parsed"}
            </Text>
          </Pressable>
        ) : null}
        {(item.status === "needs_confirm" || item.status === "failed") && !canConfirm ? (
          // Not "Can't be filed" any more: the detail screen can file it by hand.
          <Text className="text-xs text-amber-700 dark:text-amber-500">Tap to file</Text>
        ) : null}
      </View>
      {confirm.isError ? (
        <Text className="mt-1 text-xs text-red-600 dark:text-red-400">
          {confirmErrorMessage(confirm.error)}
        </Text>
      ) : null}
      {headline !== null ? (
        // A readable line in place of the JSON.stringify(parse_result) this
        // row showed until Checkpoint 9.3.
        <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={2}>
          {headline}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function InboxScreen() {
  // Dismissed (archived) rows are hidden by default and shown on request;
  // the server owns the filter (GET /inbox?include_archived=true).
  const [showDismissed, setShowDismissed] = useState(false);
  const { data, isLoading, isError, refetch } = useInbox(
    showDismissed ? { include_archived: true } : {},
  );

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View className="flex-row items-center justify-end border-b border-neutral-200 px-4 dark:border-neutral-800">
        <Pressable
          onPress={() => setShowDismissed((current) => !current)}
          hitSlop={8}
          accessibilityRole="switch"
          accessibilityState={{ checked: showDismissed }}
          accessibilityLabel="Show dismissed captures"
          className="min-h-[44px] justify-center px-2"
        >
          <Text className="text-xs text-blue-700 dark:text-blue-300">
            {showDismissed ? "Hide dismissed" : "Show dismissed"}
          </Text>
        </Pressable>
      </View>
      {isLoading ? (
        <Text className="p-4 text-neutral-500">Loading...</Text>
      ) : isError ? (
        <View className="flex-1 items-center justify-center gap-3 p-4">
          <Text className="text-red-600">Couldn&apos;t load the inbox.</Text>
          <Pressable
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading the inbox"
            hitSlop={8}
            className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="font-semibold text-white">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <InboxRow item={item} />}
          contentContainerClassName={FLOATING_CLEARANCE}
          ListEmptyComponent={<Text className="p-4 text-neutral-500">Inbox is empty.</Text>}
        />
      )}
    </SafeAreaView>
  );
}
