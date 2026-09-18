import {
  formatInstantWithOffset,
  resolveWallClockToInstant,
  toWallClockComponents,
} from "@personal-os/core/timezone";
import {
  ACTION_REASON_MAX_CHARS,
  ENTITY_TITLE_MAX_CHARS,
  type ActionRequestCreate,
} from "@personal-os/schema";
import { formatDueLabel } from "@/components/academic/format";

// The first product moment (Checkpoint 10.8, ADR-078 §6): from an
// assignment sheet, "Plan study block" proposes a `create_calendar_event`
// and "Add a task for this" proposes a linked `create_task`. Both are PURE
// builders over the assignment record the sheet already holds -- the
// request is composed here, proposed by the sheet host, and approved (or
// cancelled) by the owner on the approval sheet. Nothing here writes, and
// `now` is always the caller's (an event handler may read the clock; render
// never does).

export const STUDY_BLOCK_MINUTES = 60;
/** The block starts at the next whole hour that is at least this far ahead. */
export const STUDY_BLOCK_LEAD_MINUTES = 15;
export const ASSIGNMENT_SOURCE_REF = "canvas_assignment";
export const ASSIGNMENT_TASK_REASON = "Track this assignment as a task";

export interface AssignmentForRequest {
  id: string;
  title: string;
  due_at: string | null;
}

/** Surrogate-safe cut to the shared title bound; an empty title gets the fallback. */
export function boundedTitle(title: string, fallback: string): string {
  const trimmed = Array.from(title.trim()).slice(0, ENTITY_TITLE_MAX_CHARS).join("").trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function boundedReason(reason: string): string {
  return Array.from(reason).slice(0, ACTION_REASON_MAX_CHARS).join("");
}

/**
 * The next whole hour in `tz` that is at least `STUDY_BLOCK_LEAD_MINUTES`
 * after `now`. Deterministic and simple on purpose: the hour is floored on
 * the zone's wall clock, then advanced by one absolute hour when the floor
 * is not itself far enough ahead -- so a study block proposed at 14:10
 * starts at 15:00, one proposed at 14:50 starts at 16:00, and one proposed
 * on the hour exactly starts one hour later. An assignment already due
 * before that instant still gets the same proposal (the owner reads the
 * due line on the sheet and decides).
 */
export function nextStudyBlockStart(now: Date, tz: string): Date {
  const earliest = new Date(now.getTime() + STUDY_BLOCK_LEAD_MINUTES * 60_000);
  const components = toWallClockComponents(earliest, tz);
  const floor = resolveWallClockToInstant({ ...components, minute: 0, second: 0 }, tz);
  if (floor.getTime() >= earliest.getTime()) return floor;
  return new Date(floor.getTime() + 60 * 60_000);
}

/** "Due Sep 22 · 11:59 PM · from your Focus Now list", bounded to the reason limit. */
export function studyBlockReason(assignment: Pick<AssignmentForRequest, "due_at">, tz: string) {
  const due =
    assignment.due_at === null
      ? "No due date"
      : `Due ${formatDueLabel(assignment.due_at, { timeZone: tz })}`;
  return boundedReason(`${due} · from your Focus Now list`);
}

export function buildStudyBlockRequest(input: {
  assignment: AssignmentForRequest;
  now: Date;
  tz: string;
}): ActionRequestCreate {
  const start = nextStudyBlockStart(input.now, input.tz);
  const end = new Date(start.getTime() + STUDY_BLOCK_MINUTES * 60_000);
  return {
    action_id: "create_calendar_event",
    input: {
      title: boundedTitle(`Study: ${input.assignment.title}`, "Study block"),
      starts_at: formatInstantWithOffset(start, input.tz),
      ends_at: formatInstantWithOffset(end, input.tz),
      timezone: input.tz,
      // No `calendar`: a link needs a target picker, which this moment does
      // not draw. The event is authored in Personal OS and stays local.
    },
    source: "focus_now",
    source_ref: ASSIGNMENT_SOURCE_REF,
    reason: studyBlockReason(input.assignment, input.tz),
  };
}

export function buildAssignmentTaskRequest(input: {
  assignment: AssignmentForRequest;
  tz: string;
}): ActionRequestCreate {
  return {
    action_id: "create_task",
    input: {
      title: boundedTitle(input.assignment.title, "Assignment"),
      ...(input.assignment.due_at === null ? {} : { due_at: input.assignment.due_at }),
      canvas_assignment_id: input.assignment.id,
      timezone: input.tz,
    },
    source: "academic",
    source_ref: ASSIGNMENT_SOURCE_REF,
    reason: ASSIGNMENT_TASK_REASON,
  };
}
