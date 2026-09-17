import type { ProjectSummaryItem } from "@personal-os/schema";
import { useProjectSummaries, useUnarchiveProject } from "@/queries/projects";
import { useRouter } from "expo-router";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { FLOATING_CLEARANCE, FLOATING_CTA_CLEARANCE } from "@/components/floating-layout";
import { projectProgress } from "@/components/projects/project-progress";
import {
  PROJECT_STALLED_PRESENTATION,
  projectDisplayStatus,
  projectStatusPresentation,
} from "@/components/projects/status-presentation";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ProgressBar,
  ScreenFrame,
  SectionHeader,
  SkeletonList,
  StatusChip,
  useTheme,
} from "@/components/ui";
import { formatShortDate } from "@/utils/local-date";

type Row =
  | { kind: "header"; key: string; title: string }
  | { kind: "empty"; key: string }
  | { kind: "project"; key: string; project: ProjectSummaryItem };

function ProjectRow({ project }: { project: ProjectSummaryItem }) {
  const router = useRouter();
  const unarchive = useUnarchiveProject();
  const { colors } = useTheme();
  const displayStatus = projectDisplayStatus(project);
  const status = projectStatusPresentation(displayStatus);
  // Done over open + done (project-progress.ts); null -- no bar -- when the
  // project has neither, so an empty project is not drawn as "0% done".
  const progress = projectProgress(project.counts);

  // The body and the Unarchive control are SIBLINGS on an inert card, not
  // nested pressables: the pre-10.3 row stopped the unarchive tap's
  // propagation by hand, and siblings need no such guard (same pattern as
  // the note rows). Behaviour is unchanged -- the body opens the project,
  // the button unarchives it.
  return (
    <Card padding="none" className="mb-3">
      <Pressable
        onPress={() => router.push(`/projects/${project.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Open project: ${project.name}`}
        hitSlop={4}
        className="p-4 active:opacity-70"
      >
        <View className="flex-row items-center gap-2">
          <View
            className="h-3 w-3 rounded-full"
            // The project's own colour is data; the fallback is the palette's
            // muted role rather than a hex of this screen's own.
            style={{ backgroundColor: project.color ?? colors["on-surface-muted"] }}
          />
          <AppText variant="body-strong" numberOfLines={1} className="flex-1">
            {project.name}
          </AppText>
          {project.stalled ? (
            <StatusChip
              label={PROJECT_STALLED_PRESENTATION.label}
              tone={PROJECT_STALLED_PRESENTATION.tone}
            />
          ) : null}
          <StatusChip label={status.label} tone={status.tone} />
        </View>
        {project.next_action ? (
          <AppText
            variant="label"
            tone="secondary"
            numberOfLines={1}
            className="mt-1.5 font-normal"
          >
            Next: {project.next_action.title}
          </AppText>
        ) : null}
        {progress ? (
          <ProgressBar
            value={progress.fraction}
            tone={displayStatus === "completed" ? "success" : "primary"}
            accessibilityLabel={progress.label}
            className="mt-2.5"
          />
        ) : null}
        <AppText variant="caption" tone="muted" className="mt-1.5">
          {project.counts.open} open · {project.counts.done} done · {project.counts.overdue} overdue
          {project.target_date ? ` · Target ${formatShortDate(project.target_date)}` : ""}
        </AppText>
      </Pressable>
      {displayStatus === "archived" ? (
        <View className="px-4 pb-4">
          <Button
            label="Unarchive"
            onPress={() => unarchive.mutate(project.id)}
            variant="outline"
            size="sm"
            icon="archive-arrow-up-outline"
            disabled={unarchive.isPending}
            accessibilityLabel={`Unarchive project: ${project.name}`}
          />
          {unarchive.isError ? (
            <AppText variant="caption" tone="danger" className="mt-1">
              Couldn&apos;t unarchive.
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

export default function ProjectsScreen() {
  const router = useRouter();
  const { data, isLoading, isError, isRefetching, refetch } = useProjectSummaries(true);
  const { colors } = useTheme();

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
    <ScreenFrame>
      {isLoading ? (
        <SkeletonList className="px-4 pt-2" />
      ) : isError ? (
        <ErrorState
          size="screen"
          message="Couldn't load projects."
          onRetry={() => void refetch()}
          retryAccessibilityLabel="Retry loading projects"
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerClassName={`${FLOATING_CLEARANCE} px-4`}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          }
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return <SectionHeader title={item.title} icon="folder-outline" />;
            }
            if (item.kind === "empty") {
              return (
                <EmptyState
                  icon="folder-outline"
                  title="No projects here yet"
                  body="A project groups its tasks, notes and events."
                />
              );
            }
            return <ProjectRow project={item.project} />;
          }}
        />
      )}
      <View className={`mx-4 mt-4 ${FLOATING_CTA_CLEARANCE}`}>
        <Button
          label="New project"
          onPress={() => router.push("/projects/new")}
          variant="primary"
          // Navigation, not an action: no haptic (components/ui/haptics.ts).
          haptic={false}
          icon="plus"
          block
          accessibilityLabel="New project"
        />
      </View>
    </ScreenFrame>
  );
}
