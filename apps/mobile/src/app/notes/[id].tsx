import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { useProjects } from "@/queries/projects";
import { useArchiveNote, useNote, useUpdateNote } from "@/queries/notes";
import { ApiClientError } from "@personal-os/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

export default function EditNoteScreen() {
  const keyboardHeight = useKeyboardHeight();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: note, isLoading, isError, error, refetch } = useNote(id);
  const { data: projects } = useProjects();
  const updateNote = useUpdateNote();
  const archiveNote = useArchiveNote();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!note) return;
    setTitle(note.title);
    setBody(note.body);
    setProjectId(note.project_id ?? undefined);
  }, [note]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    const status = error instanceof ApiClientError ? error.status : null;
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white px-4 dark:bg-black">
        <Text className="text-red-600">
          {status === 404 ? "This note couldn't be found." : "Couldn't load this note."}
        </Text>
        <Pressable
          onPress={() => void refetch()}
          hitSlop={8}
          className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
        >
          <Text className="font-semibold text-white">Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!note) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  const submit = () => {
    updateNote.mutate({
      id: note.id,
      body: { title: title.trim() || undefined, body: body.trim() || undefined, project_id: projectId ?? null },
    });
  };

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      // Padding lives entirely in contentContainerStyle (no
      // contentContainerClassName) because NativeWind remaps that class onto
      // this same prop -- see FLOATING_CLEARANCE_PX. The clearance keeps the
      // globally-mounted QuickAdd/PTT buttons off this form's Save/Archive
      // control; the keyboard height gives room to scroll it clear of the IME.
      // Extra room so lower controls can be scrolled clear of the IME --
      // see components/use-keyboard-height.ts for why insets alone don't do it.
      contentContainerStyle={{ padding: 16, paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight }}
      // Without this the first tap on a submit button below a focused field
      // only dismisses the keyboard instead of submitting.
      keyboardShouldPersistTaps="handled"
    >
      <Text className="mb-1 text-sm text-neutral-500">Title</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Body</Text>
      <TextInput
        value={body}
        onChangeText={setBody}
        multiline
        className="mb-4 min-h-[120px] rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Project</Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {(projects ?? []).map((project) => (
          <Pressable
            key={project.id}
            onPress={() => setProjectId(projectId === project.id ? undefined : project.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: projectId === project.id }}
            className={
              projectId === project.id
                ? "min-h-[44px] items-center justify-center rounded-full bg-blue-600 px-3 py-1"
                : "min-h-[44px] items-center justify-center rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800"
            }
          >
            <Text className={projectId === project.id ? "text-white" : "text-black dark:text-white"}>
              {project.name}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={submit}
        disabled={updateNote.isPending}
        className="mb-3 items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
      >
        <Text className="font-semibold text-white">
          {updateNote.isPending ? "Saving..." : "Save changes"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() =>
          Alert.alert(
            "Archive this note?",
            "This hides it from your lists. There's currently no way to view or restore it from the app.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Archive",
                style: "destructive",
                onPress: () => archiveNote.mutate(note.id, { onSuccess: () => router.back() }),
              },
            ],
          )
        }
        disabled={archiveNote.isPending}
        className="items-center rounded-lg bg-neutral-100 py-3 dark:bg-neutral-800"
      >
        <Text className="font-semibold text-neutral-600 dark:text-neutral-300">
          {archiveNote.isPending ? "Archiving..." : "Archive note"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
