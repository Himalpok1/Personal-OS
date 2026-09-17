import type { Note } from "@personal-os/schema";
import { confirmDestructive } from "@/components/confirm-destructive";
import { FLOATING_CLEARANCE, FLOATING_CTA_CLEARANCE } from "@/components/floating-layout";
import {
  AnimatedView,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  ScreenFrame,
  SkeletonList,
  SwipeableRow,
  enterFade,
  showToast,
  swipeEnabled,
  useRefreshControl,
  type SwipeAction,
} from "@/components/ui";
import { useArchiveNote, useNotes } from "@/queries/notes";
import { useRouter } from "expo-router";
import { FlatList, Platform, View } from "react-native";

// The Notes tab (Checkpoint 10.6, ADR-076 §2): a note row archives by
// swiping left on a device; on web -- where a swipe does not exist -- the
// trailing archive button stays, so the action is reachable there and from
// the note's own screen everywhere. Both routes go through the same
// `confirmDestructive` gate the detail screen has always had (the list row
// used to fire unconfirmed -- the ledger's "List-row Archive and Drop still
// fire without confirmation" entry, closed for notes here as the Tasks list
// closed it for tasks), and a landed archive says so in a toast.

const ARCHIVE_COPY = {
  title: "Archive this note?",
  message:
    "This hides it from your lists. There's currently no way to view or restore it from the app.",
  confirmLabel: "Archive",
} as const;

function NoteRow({ note }: { note: Note }) {
  const router = useRouter();
  const archive = useArchiveNote();
  // The web target keeps its visible control; a device gets the swipe.
  const showButton = !swipeEnabled(Platform.OS);

  const onArchive = () =>
    confirmDestructive({
      ...ARCHIVE_COPY,
      onConfirm: () => {
        // A pending archive is never re-fired (the pre-10.3 rule).
        if (archive.isPending) return;
        archive.mutate(note.id, {
          onSuccess: () => showToast({ message: "Note archived" }),
        });
      },
    });

  const swipeArchive: SwipeAction[] = archive.isPending
    ? []
    : [
        {
          key: "archive",
          label: "Archive",
          icon: "archive-arrow-down-outline",
          tone: "danger",
          onPress: onArchive,
        },
      ];

  return (
    <Card padding="none" className="mb-2">
      <SwipeableRow rightActions={swipeArchive}>
        <ListRow
          icon="note-text-outline"
          title={note.title}
          // `meta`, not `subtitle`: the body preview stays the one line it has
          // always been (a subtitle would give it two).
          meta={note.body}
          onPress={() => router.push(`/notes/${note.id}`)}
          accessibilityLabel={`Open note: ${note.title}`}
          trailing={
            showButton ? (
              <IconButton
                icon="archive-arrow-down-outline"
                onPress={onArchive}
                accessibilityLabel={`Archive note: ${note.title}`}
                tone="on-surface-variant"
                busy={archive.isPending}
              />
            ) : undefined
          }
          // With its own archive button inside, the row drops its button
          // role (no <button> in a <button> on web); on a device the row is
          // the plain pressable it always was.
          containsControl={showButton}
          inset
          last
          className={showButton ? "pl-4 pr-1" : "px-4"}
        />
      </SwipeableRow>
    </Card>
  );
}

export default function NotesScreen() {
  const router = useRouter();
  const { data, isLoading, isError, isRefetching, refetch } = useNotes();
  const refreshControl = useRefreshControl(isRefetching, () => void refetch());

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
          renderItem={({ item }) => (
            // The animated leaf around each row: fades in on appearance
            // (`enterFade`, not `enterRise` -- see app/tasks/index.tsx for
            // why a `withInitialValues` preset is unsafe on a web FlatList).
            <AnimatedView entering={enterFade}>
              <NoteRow note={item} />
            </AnimatedView>
          )}
          contentContainerClassName={`${FLOATING_CLEARANCE} flex-grow px-4 pt-4`}
          refreshControl={refreshControl}
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
