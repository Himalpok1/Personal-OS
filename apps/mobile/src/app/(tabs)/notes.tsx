import type { Note } from "@personal-os/schema";
import { FLOATING_CLEARANCE, FLOATING_CTA_CLEARANCE } from "@/components/floating-layout";
import { useArchiveNote, useNotes } from "@/queries/notes";
import { Link, useRouter } from "expo-router";
import { FlatList, Pressable, SafeAreaView, Text, View } from "react-native";

function NoteRow({ note }: { note: Note }) {
  const router = useRouter();
  const archive = useArchiveNote();

  return (
    <Pressable
      onPress={() => router.push(`/notes/${note.id}`)}
      className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800"
    >
      <View className="flex-1 pr-2">
        <Text className="text-base text-black dark:text-white" numberOfLines={2}>
          {note.title}
        </Text>
        <Text className="text-xs text-neutral-500" numberOfLines={1}>
          {note.body}
        </Text>
      </View>
      <Pressable
        onPress={(e) => {
          // Stop the tap from also triggering the row's onPress (navigate
          // to the note) -- both handlers are on nested Pressables, same
          // precedent as components/calendar/day-cell.tsx.
          e.stopPropagation();
          archive.mutate(note.id);
        }}
        hitSlop={8}
        className="min-h-[44px] min-w-[44px] items-center justify-center rounded bg-neutral-100 px-2 dark:bg-neutral-800"
      >
        <Text className="text-xs text-neutral-600 dark:text-neutral-300">Archive</Text>
      </Pressable>
    </Pressable>
  );
}

export default function NotesScreen() {
  const { data, isLoading, isError } = useNotes();

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      {isLoading ? (
        <Text className="p-4 text-neutral-500">Loading...</Text>
      ) : isError ? (
        <Text className="p-4 text-red-600">Couldn&apos;t load notes.</Text>
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <NoteRow note={item} />}
          contentContainerClassName={FLOATING_CLEARANCE}
          ListEmptyComponent={<Text className="p-4 text-neutral-500">No notes yet.</Text>}
        />
      )}
      <Link href="/notes/new" asChild>
        <Pressable className={`mx-4 mt-4 items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700 ${FLOATING_CTA_CLEARANCE}`}>
          <Text className="font-semibold text-white">New note</Text>
        </Pressable>
      </Link>
    </SafeAreaView>
  );
}
