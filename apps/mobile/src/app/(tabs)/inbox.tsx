import type { InboxItem } from "@personal-os/schema";
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

  return (
    <View className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <Text className="text-base text-black dark:text-white">
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
        {item.status === "needs_confirm" ? (
          <Pressable
            onPress={() => confirm.mutate({ id: item.id })}
            className="rounded bg-blue-100 px-2 py-1 dark:bg-blue-950"
            disabled={confirm.isPending}
          >
            <Text className="text-xs text-blue-700 dark:text-blue-300">
              {confirm.isPending ? "Confirming..." : "Confirm as parsed"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {item.parse_result != null ? (
        <Text className="mt-1 text-xs text-neutral-400" numberOfLines={2}>
          {JSON.stringify(item.parse_result)}
        </Text>
      ) : null}
    </View>
  );
}

export default function InboxScreen() {
  const { data, isLoading, isError } = useInbox();

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      {isLoading ? (
        <Text className="p-4 text-neutral-500">Loading...</Text>
      ) : isError ? (
        <Text className="p-4 text-red-600">Couldn&apos;t load the inbox.</Text>
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <InboxRow item={item} />}
          ListEmptyComponent={<Text className="p-4 text-neutral-500">Inbox is empty.</Text>}
        />
      )}
    </SafeAreaView>
  );
}
