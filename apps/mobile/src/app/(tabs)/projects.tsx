import type { ProjectSummaryItem } from "@personal-os/schema";
import { useProjectSummaries, useUnarchiveProject } from "@/queries/projects";
import { Link, useRouter } from "expo-router";
import { FlatList, Pressable, SafeAreaView, Text, View } from "react-native";
import { FLOATING_CLEARANCE, FLOATING_CTA_CLEARANCE } from "@/components/floating-layout";
import { formatShortDate } from "@/utils/local-date";

type DisplayStatus = ProjectSummaryItem["status"] | "archived";

const STATUS_PILL: Record<DisplayStatus, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  paused: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  archived: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

type Row =
  | { kind: "header"; key: string; title: string }
  | { kind: "empty"; key: string }
  | { kind: "project"; key: string; project: ProjectSummaryItem };

function displayStatusOf(project: ProjectSummaryItem): DisplayStatus {
  return project.archived_at ? "archived" : project.status;
}

function ProjectRow({ project }: { project: ProjectSummaryItem }) {
  const router = useRouter();
  const unarchive = useUnarchiveProject();
  const displayStatus = displayStatusOf(project);

  return (
    <Pressable
      onPress={() => router.push(`/projects/${project.id}`)}
      className="border-b border-neutral-200 px-4 py-3 active:bg-neutral-50 dark:border-neutral-800 dark:active:bg-neutral-900"
    >
      <View className="flex-row items-center gap-2">
        <View className="h-3 w-3 rounded-full" style={{ backgroundColor: project.color ?? "#999" }} />
        <Text numberOfLines={1} className="flex-1 text-base text-black dark:text-white">
          {project.name}
        </Text>
        {project.stalled ? (
          <View className="rounded bg-amber-100 px-2 py-0.5 dark:bg-amber-900">
            <Text className="text-[10px] uppercase text-amber-700 dark:text-amber-300">
              Stalled
            </Text>
          </View>
        ) : null}
        <View className={`rounded px-2 py-0.5 ${STATUS_PILL[displayStatus]}`}>
          <Text className="text-[10px] uppercase">{displayStatus}</Text>
        </View>
      </View>
      {project.next_action ? (
        <Text numberOfLines={1} className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          Next: {project.next_action.title}
        </Text>
      ) : null}
      <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        {project.counts.open} open · {project.counts.done} done · {project.counts.overdue} overdue
        {project.target_date ? ` · Target ${formatShortDate(project.target_date)}` : ""}
      </Text>
      {displayStatus === "archived" ? (
        <>
          <Pressable
            onPress={(e) => {
              // Stop the tap from also triggering the row's onPress
              // (navigate to detail) -- both handlers are on nested
              // Pressables, same pattern as calendar/day-cell.tsx.
              e.stopPropagation();
              unarchive.mutate(project.id);
            }}
            disabled={unarchive.isPending}
            className="mt-2 min-h-[44px] min-w-[44px] items-center justify-center self-start rounded bg-neutral-100 px-3 active:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:active:bg-neutral-700"
          >
            <Text className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">
              Unarchive
            </Text>
          </Pressable>
          {unarchive.isError ? (
            <Text className="mt-1 text-xs text-red-600">Couldn&apos;t unarchive.</Text>
          ) : null}
        </>
      ) : null}
    </Pressable>
  );
}

export default function ProjectsScreen() {
  const { data, isLoading, isError, refetch } = useProjectSummaries(true);

  const sections: { title: string; projects: ProjectSummaryItem[] }[] = [
    { title: "Active", projects: [] },
    { title: "Paused", projects: [] },
    { title: "Completed", projects: [] },
    { title: "Archived", projects: [] },
  ];
  for (const project of data?.items ?? []) {
    if (project.archived_at) {
      sections[3]!.projects.push(project);
    } else if (project.status === "paused") {
      sections[1]!.projects.push(project);
    } else if (project.status === "completed") {
      sections[2]!.projects.push(project);
    } else {
      sections[0]!.projects.push(project);
    }
  }

  // Empty sections collapse; Active always renders so the screen never looks
  // broken for a first-time user.
  const rows: Row[] = [];
  for (const [index, section] of sections.entries()) {
    if (section.projects.length === 0 && index > 0) continue;
    rows.push({ kind: "header", key: `header-${section.title}`, title: section.title });
    if (section.projects.length === 0) {
      rows.push({ kind: "empty", key: `empty-${section.title}` });
    }
    for (const project of section.projects) {
      rows.push({ kind: "project", key: project.id, project });
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      {isLoading ? (
        <Text className="p-4 text-neutral-500">Loading...</Text>
      ) : isError ? (
        <View className="flex-1 items-center justify-center gap-3 p-4">
          <Text className="text-red-600">Couldn&apos;t load projects.</Text>
          <Pressable
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading projects"
            hitSlop={8}
            className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="font-semibold text-white">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerClassName={FLOATING_CLEARANCE}
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return (
                <Text className="bg-neutral-50 px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-950">
                  {item.title}
                </Text>
              );
            }
            if (item.kind === "empty") {
              return (
                <Text className="px-4 py-3 text-neutral-500 dark:text-neutral-400">
                  No projects here yet.
                </Text>
              );
            }
            return <ProjectRow project={item.project} />;
          }}
        />
      )}
      <Link href="/projects/new" asChild>
        <Pressable className={`mx-4 mt-4 items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700 ${FLOATING_CTA_CLEARANCE}`}>
          <Text className="font-semibold text-white">New project</Text>
        </Pressable>
      </Link>
    </SafeAreaView>
  );
}
