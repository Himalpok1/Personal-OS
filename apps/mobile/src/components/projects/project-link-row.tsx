import { ListRow } from "@/components/ui";

// A tappable "Project: {name} ›" row (Checkpoint 10.5): the task and event
// detail screens both already fetch project_id with the entity but never
// wired it to navigation. One small, hook-free, reused component rather than
// duplicating the same ListRow twice -- render nothing when there is no
// project to point at.

export interface ProjectLinkRowProps {
  projectId: string | null | undefined;
  projects: readonly { id: string; name: string }[] | undefined;
  onPress: () => void;
  className?: string;
}

export function ProjectLinkRow({ projectId, projects, onPress, className }: ProjectLinkRowProps) {
  if (!projectId) return null;
  // The owning project may not have loaded yet (its own query can lag the
  // task/event query it sits beside) -- a generic word beats a blank row.
  const name = projects?.find((p) => p.id === projectId)?.name ?? "Project";
  return (
    <ListRow
      testID="project-link-row"
      title={`Project: ${name}`}
      onPress={onPress}
      chevron
      accessibilityLabel={`Open project: ${name}`}
      className={className}
    />
  );
}
