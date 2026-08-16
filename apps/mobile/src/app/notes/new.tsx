import { useProjects } from "@/queries/projects";
import { useCreateNote } from "@/queries/notes";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

export default function NewNoteScreen() {
  const router = useRouter();
  const createNote = useCreateNote();
  const { data: projects } = useProjects();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(undefined);

  const submit = () => {
    if (!title.trim() || !body.trim()) return;
    createNote.mutate(
      { title: title.trim(), body: body.trim(), project_id: projectId },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <ScrollView className="flex-1 bg-white p-4 dark:bg-black">
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

      <Text className="mb-1 text-sm text-neutral-500">Project (optional)</Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {(projects ?? []).map((project) => (
          <Pressable
            key={project.id}
            onPress={() => setProjectId(projectId === project.id ? undefined : project.id)}
            className={
              projectId === project.id
                ? "rounded-full bg-blue-600 px-3 py-1"
                : "rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800"
            }
          >
            <Text className={projectId === project.id ? "text-white" : "text-black dark:text-white"}>
              {project.name}
            </Text>
          </Pressable>
        ))}
      </View>

      {createNote.isError ? (
        <Text className="mb-2 text-red-600">Couldn&apos;t create that note.</Text>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={createNote.isPending || !title.trim() || !body.trim()}
        className="items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
      >
        <Text className="font-semibold text-white">
          {createNote.isPending ? "Saving..." : "Create note"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
