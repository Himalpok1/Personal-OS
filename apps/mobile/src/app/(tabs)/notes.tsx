import type { Note } from "@personal-os/schema";
import { FLOATING_CLEARANCE, FLOATING_CTA_CLEARANCE } from "@/components/floating-layout";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  ScreenFrame,
  SkeletonList,
  useTheme,
} from "@/components/ui";
import { useArchiveNote, useNotes } from "@/queries/notes";
import { useRouter } from "expo-router";
import { FlatList, RefreshControl, View } from "react-native";

function NoteRow({ note }: { note: Note }) {
  const router = useRouter();
  const archive = useArchiveNote();

  // The row and its Archive control are SIBLINGS on an inert card, side by
  // side, not nested pressables: the pre-10.3 row stopped the archive tap's
  // propagation by hand, and siblings need no such guard (same reasoning as
  // the project rows). Behaviour is unchanged -- the row opens the note, the
  // button archives it.
  return (
    <Card padding="none" className="mb-3 flex-row items-center pr-1">
      <ListRow
        icon="note-text-outline"
        title={note.title}
        // `meta`, not `subtitle`: the body preview stays the one line it has
        // always been (a subtitle would give it two).
        meta={note.body}
        onPress={() => router.push(`/notes/${note.id}`)}
        accessibilityLabel={`Open note: ${note.title}`}
        last
        className="flex-1"
      />
      <IconButton
        icon="archive-arrow-down-outline"
        // IconButton has no `disabled`; the guard keeps the pre-10.3 rule
        // that a pending archive is never re-fired.
        onPress={() => {
          if (!archive.isPending) archive.mutate(note.id);
        }}
        accessibilityLabel={`Archive note: ${note.title}`}
        tone="on-surface-variant"
        className={archive.isPending ? "opacity-50" : ""}
      />
    </Card>
  );
}

export default function NotesScreen() {
  const router = useRouter();
  const { data, isLoading, isError, isRefetching, refetch } = useNotes();
  const { colors } = useTheme();

  return (
    <ScreenFrame>
      {isLoading ? (
        <SkeletonList className="px-4 pt-2" />
      ) : isError ? (
        <ErrorState
          size="screen"
          message="Couldn't load notes."
          onRetry={() => void refetch()}
          retryAccessibilityLabel="Retry loading notes"
        />
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <NoteRow note={item} />}
          contentContainerClassName={`${FLOATING_CLEARANCE} flex-grow px-4 pt-4`}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListEmptyComponent={
            <EmptyState
              size="screen"
              icon="note-text-outline"
              title="No notes yet"
              body="Capture a thought or write one here."
            />
          }
        />
      )}
      <View className={`mx-4 mt-4 ${FLOATING_CTA_CLEARANCE}`}>
        <Button
          label="New note"
          onPress={() => router.push("/notes/new")}
          variant="primary"
          // Navigation, not an action: no haptic (components/ui/haptics.ts).
          haptic={false}
          icon="plus"
          block
          accessibilityLabel="New note"
        />
      </View>
    </ScreenFrame>
  );
}
