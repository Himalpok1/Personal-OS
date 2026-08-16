import type { Project } from "@personal-os/schema";
import { useProjects } from "@/queries/projects";
import { Link, useRouter } from "expo-router";
import { FlatList, Pressable, SafeAreaView, Text, View } from "react-native";

function ProjectRow({ project }: { project: Project }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/projects/${project.id}`)}
      className="flex-row items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800"
    >
      <View
        className="h-3 w-3 rounded-full"
        style={{ backgroundColor: project.color ?? "#999" }}
      />
      <Text className="text-base text-black dark:text-white">{project.name}</Text>
    </Pressable>
  );
}

export default function ProjectsScreen() {
  const { data, isLoading, isError } = useProjects();

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      {isLoading ? (
        <Text className="p-4 text-neutral-500">Loading...</Text>
      ) : isError ? (
        <Text className="p-4 text-red-600">Couldn&apos;t load projects.</Text>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ProjectRow project={item} />}
          ListEmptyComponent={<Text className="p-4 text-neutral-500">No projects yet.</Text>}
        />
      )}
      <Link href="/projects/new" asChild>
        <Pressable className="m-4 items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700">
          <Text className="font-semibold text-white">New project</Text>
        </Pressable>
      </Link>
    </SafeAreaView>
  );
}
