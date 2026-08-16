import { useNotes } from "@/queries/notes";
import { useArchiveProject, useProject, useUpdateProject } from "@/queries/projects";
import { useTasks } from "@/queries/tasks";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: project, isLoading } = useProject(id);
  const { data: tasks } = useTasks({ project_id: id });
  const { data: notes } = useNotes({ project_id: id });
  const updateProject = useUpdateProject();
  const archiveProject = useArchiveProject();

  const [name, setName] = useState("");

  useEffect(() => {
    if (project) setName(project.name);
  }, [project]);

  if (isLoading || !project) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white p-4 dark:bg-black">
      <View className="mb-4 flex-row items-center gap-2">
        <View className="h-4 w-4 rounded-full" style={{ backgroundColor: project.color ?? "#999" }} />
        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={() => {
            if (name.trim() && name.trim() !== project.name) {
              updateProject.mutate({ id: project.id, body: { name: name.trim() } });
            }
          }}
          className="flex-1 rounded-lg border border-neutral-300 p-2 text-lg font-semibold text-black dark:border-neutral-700 dark:text-white"
        />
      </View>

      <Text className="mb-2 text-sm font-semibold text-neutral-500">
        Tasks ({tasks?.total ?? 0})
      </Text>
      {(tasks?.items ?? []).map((task) => (
        <Pressable
          key={task.id}
          onPress={() => router.push(`/tasks/${task.id}`)}
          className="border-b border-neutral-200 py-2 dark:border-neutral-800"
        >
          <Text className="text-black dark:text-white">{task.title}</Text>
        </Pressable>
      ))}
      {(tasks?.items ?? []).length === 0 ? (
        <Text className="mb-4 text-neutral-400">No tasks in this project.</Text>
      ) : null}

      <Text className="mb-2 mt-4 text-sm font-semibold text-neutral-500">
        Notes ({notes?.total ?? 0})
      </Text>
      {(notes?.items ?? []).map((note) => (
        <Pressable
          key={note.id}
          onPress={() => router.push(`/notes/${note.id}`)}
          className="border-b border-neutral-200 py-2 dark:border-neutral-800"
        >
          <Text className="text-black dark:text-white">{note.title}</Text>
        </Pressable>
      ))}
      {(notes?.items ?? []).length === 0 ? (
        <Text className="mb-4 text-neutral-400">No notes in this project.</Text>
      ) : null}

      <Pressable
        onPress={() => archiveProject.mutate(project.id, { onSuccess: () => router.back() })}
        className="mt-6 items-center rounded-lg bg-neutral-100 py-3 dark:bg-neutral-800"
      >
        <Text className="font-semibold text-neutral-600 dark:text-neutral-300">
          Archive project
        </Text>
      </Pressable>
    </ScrollView>
  );
}
