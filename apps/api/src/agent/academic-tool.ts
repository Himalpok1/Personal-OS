import {
  stripUnsummarizableCharacters,
  truncateAtWordBoundary,
} from "@personal-os/core/mail/provider-strings";
import type { Db } from "@personal-os/db";
import {
  GetAcademicContextOutputSchema,
  READ_TOOL_ACADEMIC_ASSIGNMENTS_MAX,
  READ_TOOL_ACADEMIC_COURSES_MAX,
  TODAY_CONTEXT_TITLE_MAX_CHARS,
  type AcademicAssignment,
  type AcademicContextAssignment,
  type GetAcademicContextOutput,
  type ReadToolInput,
} from "@personal-os/schema";
import { buildAcademicTodayResponse } from "../read-models/academic.js";

// `get_academic_context` (Checkpoint 10.9, ADR-070b) -- the ONE file in the
// gateway that may import the academic read model, and the one file only
// agent/tools.ts may import (Guard 8 (a)), reachable solely behind the
// `academic.read` grant check there. It is a PROJECTION of the current-term
// Today response the academic screens already render, computed by the same
// `buildAcademicTodayResponse` under the same one `effectiveNow`, never a
// second query against a canvas table.
//
// What is carried and what is deliberately not:
//   carried    the term, the courses the sections name (id, name, code), and
//              the union of the overdue / due-today / due-this-week
//              assignments plus the ranked priorities -- id, course, title,
//              due, points, submission state, missing/late, and the priority
//              urgency/score/reasons where the item was ranked.
//   never      `html_url`, `source_base_url` (an agent has no same-origin
//              check to make and no link to open), grades and scores
//              (ADR-068a admits them to the SCREENS, not to this exit),
//              announcements, descriptions (never stored, ADR-068) and the
//              workload/attention sections (client presentation).
//
// Titles and course names are INSTRUCTOR-authored -- third-party text in
// the ADR-054 sense -- so the section is flagged `provenance:
// "third_party"`. They are control-stripped and word-boundary truncated to
// the same title cap TodayContext uses; the gateway never interprets them.

const COURSE_CODE_MAX_CHARS = 64;

function bound(value: string | null | undefined, cap: number): string {
  return truncateAtWordBoundary(stripUnsummarizableCharacters(value) ?? "", cap) ?? "";
}

function boundOrNull(value: string | null | undefined, cap: number): string | null {
  if (value === null || value === undefined) return null;
  const bounded = bound(value, cap);
  return bounded === "" ? null : bounded;
}

interface RankedFacts {
  urgency: AcademicContextAssignment["urgency"];
  score: number;
  reasons: AcademicContextAssignment["priority_reasons"];
}

function project(
  assignment: AcademicAssignment,
  ranked: RankedFacts | undefined,
): AcademicContextAssignment {
  return {
    id: assignment.id,
    course_id: assignment.course_id,
    title: bound(assignment.title, TODAY_CONTEXT_TITLE_MAX_CHARS),
    due_at: assignment.due_at,
    points_possible: assignment.points_possible,
    submission_status: assignment.submission.status,
    missing: assignment.submission.missing,
    late: assignment.submission.late,
    urgency: ranked?.urgency ?? null,
    priority_score: ranked?.score ?? null,
    priority_reasons: ranked?.reasons ?? [],
  };
}

export async function buildAcademicContext(
  db: Db,
  input: ReadToolInput<"get_academic_context">,
  now: Date,
): Promise<GetAcademicContextOutput> {
  const today = await buildAcademicTodayResponse(db, { tz: input.tz }, { now });

  // Priority facts by assignment id: an item that appears in a bucket AND in
  // the ranking carries its urgency/score/reasons; one only in a bucket
  // (a `low`, beyond-horizon row cannot be -- but the projection does not
  // assume that) carries nulls and an empty reason list.
  const ranked = new Map<string, RankedFacts>();
  for (const item of today.priorities?.items ?? []) {
    ranked.set(item.assignment.id, {
      urgency: item.urgency,
      score: item.score,
      reasons: item.reasons,
    });
  }

  // Section order is the presentation order: most urgent first, then the
  // ranking's own remainder. Dedupe by id in that order.
  const seen = new Set<string>();
  const union: AcademicAssignment[] = [];
  const sections = [
    today.overdue.items,
    today.due_today.items,
    today.due_this_week.items,
    (today.priorities?.items ?? []).map((item) => item.assignment),
  ];
  for (const section of sections) {
    for (const assignment of section) {
      if (seen.has(assignment.id)) continue;
      seen.add(assignment.id);
      union.push(assignment);
    }
  }

  const courseIds = new Set<string>();
  const courses: GetAcademicContextOutput["courses"] = [];
  for (const assignment of union) {
    if (courseIds.has(assignment.course_id)) continue;
    courseIds.add(assignment.course_id);
    if (courses.length >= READ_TOOL_ACADEMIC_COURSES_MAX) continue;
    courses.push({
      id: assignment.course_id,
      name: bound(assignment.course_name, TODAY_CONTEXT_TITLE_MAX_CHARS),
      code: boundOrNull(assignment.course_code, COURSE_CODE_MAX_CHARS),
    });
  }

  return GetAcademicContextOutputSchema.parse({
    tz: today.tz,
    local_date: today.local_date,
    configured: today.configured,
    current_term: today.current_term
      ? { name: today.current_term.name, starts_at: today.current_term.starts_at }
      : null,
    summary: {
      overdue_total: today.summary.overdue_total,
      due_today_total: today.summary.due_today_total,
      due_this_week_total: today.summary.due_this_week_total,
      missing_total: today.summary.missing_total,
    },
    courses,
    assignments: {
      provenance: "third_party",
      items: union
        .slice(0, READ_TOOL_ACADEMIC_ASSIGNMENTS_MAX)
        .map((assignment) => project(assignment, ranked.get(assignment.id))),
      total: union.length,
    },
  } satisfies GetAcademicContextOutput);
}
