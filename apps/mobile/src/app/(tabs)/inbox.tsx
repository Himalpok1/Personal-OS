import type { InboxItem } from "@personal-os/schema";
import { FLOATING_CLEARANCE } from "@/components/floating-layout";
import { canConfirmInboxItem, confirmErrorMessage } from "@/components/inbox/confirm-state";
import { useConfirmInboxItem, useInbox } from "@/queries/inbox";
import { FlatList, Pressable, SafeAreaView, Text, View } from "react-native";

const STATUS_LABEL: Record<InboxItem["status"], string> = {
  pending: "Parsing...",
  parsed: "Parsed",
  needs_confirm: "Needs confirmation",
  confirmed: "Confirmed",
  failed: "Failed",
};

function InboxRow({ item }: { item: InboxItem }) {
  const confirm = useConfirmInboxItem();
  const canConfirm = canConfirmInboxItem(item);

  return (
    <View className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
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
        {item.status === "needs_confirm" && !canConfirm ? (
          <Text className="text-xs text-amber-700 dark:text-amber-500">Can&apos;t be filed</Text>
        ) : null}
      </View>
      {confirm.isError ? (
        <Text className="mt-1 text-xs text-red-600 dark:text-red-400">
          {confirmErrorMessage(confirm.error)}
        </Text>
      ) : null}
      {item.parse_result != null ? (
        <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={2}>
          {JSON.stringify(item.parse_result)}
        </Text>
      ) : null}
    </View>
  );
}

export default function InboxScreen() {
  const { data, isLoading, isError, refetch } = useInbox();

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
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
