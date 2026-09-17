import type { QueryClient } from "@tanstack/react-query";
import type { AcademicAssignment } from "@personal-os/schema";
import { courseLabel } from "./format";

// Resolves a linked Canvas assignment's id (tasks.canvas_assignment_id,
// Checkpoint 10.5/ADR-074) to display text, opportunistically.
//
// There is no "get one assignment by id" route: the only place an
// assignment's title and course ever reach this device is a course fetch
// (GET /academic/courses/:id or its /context sibling), which returns every
// assignment in that course at once. `rememberAcademicAssignments` writes
// each row into the SAME React Query cache every other read already uses,
// keyed by assignment id, whenever a course's assignments happen to load
// (the link picker's course step, the course detail screen); a task screen
// that already knows a link can then read the label back with a plain cache
// read -- no dedicated lookup endpoint, no second network round trip.
//
// HONEST LIMITATION, not papered over: `apps/mobile/src/queries/client.ts`
// creates a plain, non-persisted QueryClient, so this is a per-launch cache.
// A task linked in an earlier app session shows a generic placeholder (see
// task-assignment-picker.tsx's `fieldLabel`) until its course is fetched
// again this session -- opening the picker or the course screen both do
// that. Closing this gap for good needs a real lookup route; apps/api is
// out of scope for this checkpoint's mobile lane.

export interface LinkedAssignmentSummary {
  id: string;
  title: string;
  courseId: string;
  courseLabel: string;
}

/** Exported so a caller can read the cache directly with `useQuery` (see tasks/[id].tsx). */
export function assignmentLabelQueryKey(id: string) {
  return ["academic", "assignment-label", id] as const;
}

function toSummary(item: AcademicAssignment): LinkedAssignmentSummary {
  return {
    id: item.id,
    title: item.title,
    courseId: item.course_id,
    courseLabel: courseLabel(item.course_code, item.course_name),
  };
}

export function rememberAcademicAssignments(
  queryClient: QueryClient,
  assignments: readonly AcademicAssignment[],
): void {
  for (const item of assignments) {
    queryClient.setQueryData(assignmentLabelQueryKey(item.id), toSummary(item));
  }
}
