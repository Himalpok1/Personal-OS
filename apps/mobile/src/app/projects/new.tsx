import { useCreateProject } from "@/queries/projects";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";

export default function NewProjectScreen() {
  const router = useRouter();
  const createProject = useCreateProject();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");

  const submit = () => {
    if (!name.trim()) return;
    createProject.mutate(
      { name: name.trim(), color },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <ScrollView className="flex-1 bg-white p-4 dark:bg-black">
      <Text className="mb-1 text-sm text-neutral-500">Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      <Text className="mb-1 text-sm text-neutral-500">Color</Text>
      <TextInput
        value={color}
        onChangeText={setColor}
        placeholder="#3b82f6"
        placeholderTextColor="#888"
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      {createProject.isError ? (
        <Text className="mb-2 text-red-600">Couldn&apos;t create that project.</Text>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={createProject.isPending || !name.trim()}
        className="items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
      >
        <Text className="font-semibold text-white">
          {createProject.isPending ? "Saving..." : "Create project"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
